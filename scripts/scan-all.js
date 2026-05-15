#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { execSync } = require('child_process');

const SCRIPTS_DIR = path.join(__dirname);

function loadConfig(configPath) {
  const content = fs.readFileSync(configPath, 'utf-8');
  return yaml.load(content);
}

async function scanAll(configPath) {
  const config = loadConfig(configPath);
  const outputDir = config.output_dir;

  console.log('=== project-scan v2 全量扫描 ===\n');
  console.log(`输出目录: ${outputDir}`);
  console.log(`项目数: ${config.projects.length}`);
  console.log('');

  for (const project of config.projects) {
    console.log(`\n--- 扫描 ${project.name} (${project.type}) ---\n`);

    const projectOutputDir = path.join(outputDir, project.name);
    const kbDir = path.join(projectOutputDir, 'kb');
    fs.mkdirSync(kbDir, { recursive: true });

    switch (project.type) {
      case 'java-spring':
        if (project.role === 'gateway') {
          await scanGateway(project, kbDir);
        } else {
          await scanJavaSpring(project, kbDir, config);
        }
        break;
      case 'react':
        await scanReact(project, kbDir);
        break;
      default:
        console.log(`  ⚠ 未知项目类型: ${project.type}`);
    }

    // 建向量库
    console.log(`  建向量库...`);
    const vectorStoreDir = path.join(projectOutputDir, '.vector-store');
    const { indexKb } = require('./kb-vector-index');
    await indexKb(kbDir, vectorStoreDir);
  }

  // 跨项目文档
  console.log('\n--- 生成跨项目文档 ---\n');
  generateCrossProjectDocs(config, outputDir);

  console.log('\n=== 扫描完成 ===');
  printSummary(config, outputDir);
}

async function scanJavaSpring(project, kbDir, config) {
  const { generateEntityDoc } = require('./entity-generator');
  const { generateEnumDoc } = require('./enum-generator');
  const { generateStateMachineDoc } = require('./state-machine-generator');
  const { generateMethodIndex } = require('./method-index-generator');
  const { generateFlowDocs } = require('./flow-generator');
  const { generateContractDoc } = require('./contract-generator');
  const { findRuleCandidates, generateRulesDoc } = require('./rules-generator');

  const commit = getCommit(project.source);

  for (const mod of project.modules) {
    const modKbDir = path.join(kbDir, mod.name);
    console.log(`  模块: ${mod.name}`);

    // Entities
    if (mod.entity_path) {
      const entityDir = path.join(project.source, mod.entity_path);
      const outDir = path.join(modKbDir, 'domain/entities');
      fs.mkdirSync(outDir, { recursive: true });
      const entityFiles = fs.readdirSync(entityDir).filter(f => f.endsWith('.java'));
      let count = 0;
      const dbConfig = project.db ? {
        host: project.db.host,
        port: project.db.port,
        user: project.db.username,
        password: process.env[project.db.password_env],
        database: project.db.database
      } : null;
      for (const f of entityFiles) {
        const result = await generateEntityDoc(path.join(entityDir, f), outDir, commit, dbConfig);
        if (result) count++;
      }
      console.log(`    entities: ${count}`);
    }

    // Enums (module)
    if (mod.enum_path) {
      const enumDir = path.join(project.source, mod.enum_path);
      const outDir = path.join(modKbDir, 'domain/enums');
      fs.mkdirSync(outDir, { recursive: true });
      if (fs.existsSync(enumDir)) {
        const enumFiles = fs.readdirSync(enumDir).filter(f => f.endsWith('.java'));
        let count = 0;
        for (const f of enumFiles) {
          const result = generateEnumDoc(path.join(enumDir, f), outDir, commit);
          if (result) count++;
        }
        console.log(`    enums: ${count}`);
      }
    }

    // State machines
    if (mod.status_enums) {
      const outDir = path.join(modKbDir, 'domain/state-machines');
      fs.mkdirSync(outDir, { recursive: true });
      for (const se of mod.status_enums) {
        const enumFile = path.join(project.source, se.file);
        const sourceDir = path.join(project.source, mod.path);
        generateStateMachineDoc(se.name, sourceDir, enumFile, outDir, commit);
      }
      console.log(`    state-machines: ${mod.status_enums.length}`);
    }

    // Contracts
    if (mod.controller_path) {
      const ctrlDir = path.join(project.source, mod.controller_path);
      const outDir = path.join(modKbDir, 'contracts/internal');
      fs.mkdirSync(outDir, { recursive: true });
      const { parseControllerFile, generateContractDoc: genContract } = require('./contract-generator');
      const ctrlFiles = findJavaFilesRecursive(ctrlDir);
      let count = 0;
      for (const f of ctrlFiles) {
        const result = genContract(f, outDir, commit);
        if (result) count++;
      }
      console.log(`    contracts: ${count}`);
    }

    // Method index
    const sourceDir = path.join(project.source, mod.path);
    const methodIndexPath = path.join(modKbDir, 'code/method-index.md');
    fs.mkdirSync(path.dirname(methodIndexPath), { recursive: true });
    generateMethodIndex(sourceDir, methodIndexPath, commit);
    console.log(`    method-index: ✓`);

    // Flows
    if (mod.controller_path) {
      const ctrlDir = path.join(project.source, mod.controller_path);
      const outDir = path.join(modKbDir, 'flows');
      fs.mkdirSync(outDir, { recursive: true });
      const result = generateFlowDocs(ctrlDir, sourceDir, outDir, commit);
      console.log(`    flows: ${result.flowCount}`);
    }

    // Error codes
    if (mod.error_enum_path) {
      const outPath = path.join(modKbDir, 'domain/error-codes.md');
      generateErrorCodes(project.source, mod.error_enum_path, sourceDir, outPath, commit);
      console.log(`    error-codes: ✓`);
    }

    // Rules
    const rulesPath = path.join(modKbDir, 'domain/rules/rule-candidates.md');
    fs.mkdirSync(path.dirname(rulesPath), { recursive: true });
    generateRulesDoc(sourceDir, rulesPath, commit);
    console.log(`    rules: ✓`);
  }

  // Shared enums
  if (project.shared_enum_path) {
    const sharedDir = path.join(kbDir, 'shared/domain/enums');
    fs.mkdirSync(sharedDir, { recursive: true });
    const enumBaseDir = path.join(project.source, project.shared_enum_path);
    let count = 0;
    walkJava(enumBaseDir, (fp) => {
      const result = require('./enum-generator').generateEnumDoc(fp, sharedDir, commit);
      if (result) count++;
    });
    console.log(`  shared enums: ${count}`);
  }

  // Navigation
  const { generateModuleClaude, generateIndex } = require('./navigation-generator');
  // 生成每个模块的 CLAUDE.md 和 INDEX.md 在最后统一做
}

async function scanReact(project, kbDir) {
  const { scanReactApp } = require('./frontend-generator');
  const commit = getCommit(project.source);

  for (const app of project.apps) {
    const appDir = path.join(project.source, app.path);
    const outDir = path.join(kbDir, app.name);
    fs.mkdirSync(outDir, { recursive: true });
    console.log(`  app: ${app.name} (${app.role})`);
    scanReactApp(appDir, outDir, commit);
  }

  // Shared: dict + API types
  if (project.shared) {
    if (project.shared.dict_file) {
      const dictFile = path.join(project.source, project.shared.dict_file);
      if (fs.existsSync(dictFile)) {
        generateDictDoc(dictFile, path.join(kbDir, project.apps[0].name, 'hermes-dict.md'), commit);
        console.log(`  hermes-dict: ✓`);
      }
    }
    if (project.shared.api_files) {
      for (const apiFile of project.shared.api_files) {
        const fp = path.join(project.source, project.shared.api_generated_dir, apiFile);
        if (fs.existsSync(fp) && apiFile.endsWith('.ts') && !apiFile.includes('.types.')) {
          generateApiClientDoc(fp, kbDir, project.apps, commit);
        }
      }
      console.log(`  api-client: ✓`);
    }
  }
}

async function scanGateway(project, kbDir) {
  const commit = getCommit(project.source);
  for (const mod of project.modules) {
    if (mod.retrofit_api_path) {
      generateRetrofitMapping(project.source, mod, kbDir, commit);
      console.log(`  api-mapping: ✓`);
    }
  }
}

function generateCrossProjectDocs(config, outputDir) {
  // system-topology.md 和 frontend-backend-map.md 已经手写了
  // 这里只检查它们是否存在，不覆盖
  const topoPath = path.join(outputDir, 'system-topology.md');
  const mapPath = path.join(outputDir, 'frontend-backend-map.md');
  if (fs.existsSync(topoPath)) console.log('  system-topology.md: 已存在（保留）');
  else console.log('  system-topology.md: ⚠ 不存在，需手动创建');
  if (fs.existsSync(mapPath)) console.log('  frontend-backend-map.md: 已存在（保留）');
  else console.log('  frontend-backend-map.md: ⚠ 不存在，需手动创建');
}

function generateErrorCodes(projectSource, errorEnumPath, sourceDir, outputPath, commit) {
  // 复用之前的逻辑（从 error enum + Asserts.check 提取）
  const { createFrontmatter, writeDocument } = require('./frontmatter');
  const errorEnumDir = path.join(projectSource, errorEnumPath);
  if (!fs.existsSync(errorEnumDir)) return;

  const errors = [];
  for (const f of fs.readdirSync(errorEnumDir).filter(f => f.endsWith('.java'))) {
    const content = fs.readFileSync(path.join(errorEnumDir, f), 'utf-8');
    const regex = /(\w+)\s*\(\s*(\d+)\s*,\s*"([^"]+)"\s*\)/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      errors.push({ code: match[1], num: match[2], message: match[3] });
    }
  }

  const throwSites = [];
  walkJava(sourceDir, (fp) => {
    const content = fs.readFileSync(fp, 'utf-8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const assertMatch = lines[i].match(/Asserts\.check\w*\([^,]+,\s*(\w+)\.(\w+)\)/);
      if (assertMatch) {
        const condition = (lines[i].match(/Asserts\.check\w*\(\s*([^,]+),/) || [])[1] || '';
        throwSites.push({ errorCode: assertMatch[2], file: path.basename(fp, '.java'), line: i + 1, condition: condition.trim().slice(0, 80) });
      }
    }
  });

  const body = `# 异常码索引\n\n**异常码数：** ${errors.length}\n**抛出点数：** ${throwSites.length}\n`;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  writeDocument(outputPath, createFrontmatter({ kb_layer: 'domain', summary: `异常码索引，${errors.length} 码，${throwSites.length} 抛出点`, sources: [], commit, body }), body);
}

function generateDictDoc(dictFile, outputPath, commit) {
  // 简化版：直接复制已有逻辑
  const { createFrontmatter, writeDocument } = require('./frontmatter');
  const content = fs.readFileSync(dictFile, 'utf-8');
  const dictCount = (content.match(/export const/g) || []).length;
  const body = `# 前端字典常量\n\n来自 hermesDict 生成，共 ${dictCount} 个字典。\n`;
  writeDocument(outputPath, createFrontmatter({ kb_layer: 'domain', summary: `hermesDict 字典，${dictCount} 个`, sources: [dictFile], commit, body }), body);
}

function generateApiClientDoc(apiFile, kbDir, apps, commit) {
  // 简化版
}

function generateRetrofitMapping(projectSource, mod, kbDir, commit) {
  // 简化版：复用之前的逻辑
  const { createFrontmatter, writeDocument } = require('./frontmatter');
  const apiDir = path.join(projectSource, mod.retrofit_api_path);
  if (!fs.existsSync(apiDir)) return;

  const apis = [];
  walkJava(apiDir, (fp) => {
    const content = fs.readFileSync(fp, 'utf-8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const annMatch = lines[i].trim().match(/^@(GET|POST|PUT|DELETE)\("([^"]+)"\)/);
      if (annMatch) {
        for (let j = i + 1; j < Math.min(lines.length, i + 3); j++) {
          const fnMatch = lines[j].match(/(\w+)\s*\(/);
          if (fnMatch && !fnMatch[1].startsWith('@')) {
            apis.push({ method: annMatch[1], path: annMatch[2], fn: fnMatch[1] });
            break;
          }
        }
      }
    }
  });

  const body = `# 网关转发映射\n\n转发接口数：${apis.length}\n`;
  const outputPath = path.join(kbDir, 'api-mapping.md');
  writeDocument(outputPath, createFrontmatter({ kb_layer: 'contracts', summary: `网关转发，${apis.length} 个接口`, sources: [], commit, body }), body);
}

function getCommit(sourceDir) {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: sourceDir }).toString().trim();
  } catch (e) {
    return 'unknown';
  }
}

function findJavaFilesRecursive(dir) {
  const results = [];
  function walk(d) {
    if (!fs.existsSync(d)) return;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.java')) results.push(full);
    }
  }
  walk(dir);
  return results;
}

function walkJava(dir, callback) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !['test', 'target', 'build'].includes(entry.name)) walkJava(full, callback);
    else if (entry.name.endsWith('.java')) callback(full);
  }
}

function printSummary(config, outputDir) {
  console.log('\n--- 总结 ---');
  for (const project of config.projects) {
    const kbDir = path.join(outputDir, project.name, 'kb');
    const count = fs.existsSync(kbDir) ? countMdFiles(kbDir) : 0;
    console.log(`  ${project.name}: ${count} 份文档`);
  }
}

function countMdFiles(dir) {
  let count = 0;
  function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) count++;
    }
  }
  walk(dir);
  return count;
}

module.exports = { scanAll, loadConfig };

if (require.main === module) {
  const args = process.argv.slice(2);
  const configPath = args[0] || '/Users/a6667/bilibili/project-scan/scan-config.yaml';

  if (!fs.existsSync(configPath)) {
    console.error(`配置文件不存在: ${configPath}`);
    console.error('请先运行 /project-scan setup 生成配置');
    process.exit(1);
  }

  scanAll(configPath).catch(e => {
    console.error('扫描失败:', e.message);
    process.exit(1);
  });
}
