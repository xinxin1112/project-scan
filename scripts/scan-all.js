#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { execSync } = require('child_process');
const os = require('os');

const SCRIPTS_DIR = path.join(__dirname);
const CONCURRENCY = Math.max(os.cpus().length, 4);

function loadConfig(configPath) {
  const content = fs.readFileSync(configPath, 'utf-8');
  return yaml.load(content);
}

async function parallelMap(items, fn, concurrency = CONCURRENCY) {
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function scanAll(configPath) {
  const config = loadConfig(configPath);
  const outputDir = config.output_dir;
  const startTime = Date.now();

  console.log('=== project-scan v2 全量扫描（并行模式） ===\n');
  console.log(`输出目录: ${outputDir}`);
  console.log(`项目数: ${config.projects.length}`);
  console.log(`并发度: ${CONCURRENCY}`);
  console.log('');

  // 预处理：解析源码路径
  const validProjects = config.projects.filter(project => {
    if (!project.source) {
      const sourcesDir = path.join(outputDir, '.sources', project.name);
      if (fs.existsSync(sourcesDir)) {
        project.source = sourcesDir;
      } else {
        console.log(`  ⚠ 源码路径未找到，跳过（${project.name}）`);
        return false;
      }
    }
    return true;
  });

  // 并行扫描所有项目
  // 解析 --branch 参数（按分支分目录存储 KB）
  // --branch=prod → 用 config.branches.prod 里每个项目的实际分支
  // --branch=test → 用 config.branches.test 里每个项目的实际分支
  // 无 --branch → 用 project.branch（config 里的默认分支），目录名也用 project.branch
  const branchArg = process.argv.find(a => a.startsWith('--branch='));
  const branchKey = branchArg ? branchArg.split('=')[1] : null;
  const branchMap = branchKey && config.branches && config.branches[branchKey]
    ? config.branches[branchKey]
    : null;

  // 如果指定了 --branch 且有 branchMap，先切换各项目的 git 分支
  if (branchMap) {
    console.log(`\n--- 切换到 "${branchKey}" 环境分支 ---\n`);
    for (const project of validProjects) {
      const targetBranch = branchMap[project.name];
      if (!targetBranch) continue;
      const sourcePath = project.source || path.join(outputDir, '.sources', project.name);
      try {
        execSync(`git fetch origin ${targetBranch} --depth=1 2>/dev/null; git checkout ${targetBranch} 2>/dev/null; git pull origin ${targetBranch} 2>/dev/null`, { cwd: sourcePath, stdio: 'pipe' });
        console.log(`  [${project.name}] → ${targetBranch} ✓`);
      } catch (e) {
        console.log(`  [${project.name}] → ${targetBranch} ✗ (${e.message.substring(0, 50)})`);
      }
    }
  }

  await Promise.all(validProjects.map(async (project) => {
    console.log(`\n--- 扫描 ${project.name} (${project.type}) ---\n`);

    // 确定目录名：--branch=test → 用 "test" 作为目录名
    // 无 --branch → 用 project.branch 作为目录名
    const dirName = branchKey || project.branch || 'default';
    const projectOutputDir = path.join(outputDir, project.name, dirName);
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

    // 向量库不在这里建 — 移到层次 2 完成后统一构建（避免建两次）
    console.log(`  [${project.name}] ✓ KB 生成完成`);
  }));

  // 跨项目文档
  console.log('\n--- 生成跨项目文档 ---\n');
  generateCrossProjectDocs(config, outputDir);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n=== 扫描完成（耗时 ${elapsed}s） ===`);
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

  let modules = project.modules;
  if (!modules || modules.length === 0) {
    modules = autoDetectModules(project.source);
    console.log(`  [${project.name}] 自动检测到 ${modules.length} 个模块`);
  }

  const dbConfig = resolveDbConfig(project, config);

  // 并行扫描所有模块
  await parallelMap(modules, async (mod) => {
    const modKbDir = path.join(kbDir, mod.name);
    const modStart = Date.now();

    // Entities
    const entityDir = mod.entity_path
      ? path.join(project.source, mod.entity_path)
      : findDir(project.source, mod.name, ['entity', 'po', 'model']);
    if (entityDir && fs.existsSync(entityDir)) {
      const outDir = path.join(modKbDir, 'domain/entities');
      fs.mkdirSync(outDir, { recursive: true });
      const entityFiles = findJavaFilesRecursive(entityDir).filter(f => {
        const content = fs.readFileSync(f, 'utf-8');
        return content.includes('@TableName') || content.includes('@Entity') || content.includes('@Table');
      });
      for (const f of entityFiles) {
        await generateEntityDoc(f, outDir, commit, dbConfig);
      }
    }

    // Enums
    if (mod.enum_path) {
      const enumDir = path.join(project.source, mod.enum_path);
      const outDir = path.join(modKbDir, 'domain/enums');
      fs.mkdirSync(outDir, { recursive: true });
      if (fs.existsSync(enumDir)) {
        const enumFiles = fs.readdirSync(enumDir).filter(f => f.endsWith('.java'));
        for (const f of enumFiles) {
          generateEnumDoc(path.join(enumDir, f), outDir, commit);
        }
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
    }

    // Contracts
    if (mod.controller_path) {
      const ctrlDir = path.join(project.source, mod.controller_path);
      const outDir = path.join(modKbDir, 'contracts/internal');
      fs.mkdirSync(outDir, { recursive: true });
      const { generateContractDoc: genContract } = require('./contract-generator');
      const ctrlFiles = findJavaFilesRecursive(ctrlDir);
      for (const f of ctrlFiles) {
        genContract(f, outDir, commit);
      }
    }

    // Method index
    const sourceDir = path.join(project.source, mod.path);
    const methodIndexPath = path.join(modKbDir, 'code/method-index.md');
    fs.mkdirSync(path.dirname(methodIndexPath), { recursive: true });
    generateMethodIndex(sourceDir, methodIndexPath, commit);

    // Flows
    if (mod.controller_path) {
      const ctrlDir = path.join(project.source, mod.controller_path);
      const outDir = path.join(modKbDir, 'flows');
      fs.mkdirSync(outDir, { recursive: true });
      generateFlowDocs(ctrlDir, sourceDir, outDir, commit);
    }

    // Error codes
    if (mod.error_enum_path) {
      const outPath = path.join(modKbDir, 'domain/error-codes.md');
      generateErrorCodes(project.source, mod.error_enum_path, sourceDir, outPath, commit);
    }

    // Rules
    const rulesPath = path.join(modKbDir, 'domain/rules/rule-candidates.md');
    fs.mkdirSync(path.dirname(rulesPath), { recursive: true });
    generateRulesDoc(sourceDir, rulesPath, commit);

    const elapsed = ((Date.now() - modStart) / 1000).toFixed(1);
    console.log(`    [${project.name}/${mod.name}] ✓ (${elapsed}s)`);
  });

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
    console.log(`  [${project.name}] shared enums: ${count}`);
  }
}

async function scanReact(project, kbDir) {
  const { scanReactApp } = require('./frontend-generator');
  const commit = getCommit(project.source);

  let apps = project.apps;
  if (!apps || apps.length === 0) {
    apps = autoDetectReactApps(project.source);
    console.log(`  [${project.name}] 自动检测到 ${apps.length} 个前端应用`);
  }

  // 并行扫描所有 app
  await parallelMap(apps, async (app) => {
    const appDir = path.join(project.source, app.path);
    if (!fs.existsSync(appDir)) return;
    const outDir = path.join(kbDir, app.name);
    fs.mkdirSync(outDir, { recursive: true });
    scanReactApp(appDir, outDir, commit);
    console.log(`    [${project.name}/${app.name}] ✓`);
  });

  // Shared: hermesDict 字典
  if (project.shared && project.shared.dict_file) {
    const dictFile = path.join(project.source, project.shared.dict_file);
    if (fs.existsSync(dictFile)) {
      generateFullDictDoc(dictFile, path.join(kbDir, project.apps[0].name, 'hermes-dict.md'), commit);
      console.log(`  hermes-dict: ✓`);
    }
  }

  // Shared: API client + types
  if (project.shared && project.shared.api_files) {
    for (const apiFile of project.shared.api_files) {
      const fp = path.join(project.source, project.shared.api_generated_dir, apiFile);
      if (!fs.existsSync(fp)) continue;

      if (apiFile.endsWith('.types.ts')) {
        // API 类型文档（Req/Res interface）
        const targetApp = apiFile.includes('portal') ? 'supplier-c' : project.apps[0].name;
        generateApiTypesDoc(fp, path.join(kbDir, targetApp, 'api-types.md'), commit);
      } else if (apiFile.endsWith('.ts')) {
        // API 客户端函数列表
        const targetApp = apiFile.includes('portal') ? 'supplier-c' : project.apps[0].name;
        generateApiClientFullDoc(fp, path.join(kbDir, targetApp, 'api-client.md'), commit, apiFile.includes('portal'));
      }
    }
    console.log(`  api-client + api-types: ✓`);
  }

  // 前端状态聚合映射
  const statusMappingFile = findFile(project.source, 'statusMapping.ts', project.apps[0].path);
  if (statusMappingFile) {
    generateFrontendEnumsDoc(statusMappingFile, project.source, path.join(kbDir, project.apps[0].name, 'frontend-enums.md'), commit);
    console.log(`  frontend-enums: ✓`);
  }

  // 字段联动逻辑（从 DetailForm 等组件提取）
  generateFieldLinkageDoc(project, kbDir, commit);
  console.log(`  field-linkage: ✓`);

  // 节点×按钮×字段权限矩阵
  generateNodeButtonMatrixDoc(project, kbDir, commit);
  console.log(`  node-button-matrix: ✓`);
}

function generateFullDictDoc(dictFile, outputPath, commit) {
  const { createFrontmatter, writeDocument } = require('./frontmatter');
  const content = fs.readFileSync(dictFile, 'utf-8');

  const dictRegex = /\/\*\*\s*\n\s*\*\s*(.+?)\s*\n\s*\*\*\/\s*\n\s*export const (\w+)\s*=\s*\{([\s\S]*?)\n\s*\}/g;
  const dicts = [];
  let match;
  while ((match = dictRegex.exec(content)) !== null) {
    const comment = match[1];
    const name = match[2];
    const body = match[3];
    const values = [];
    const valueRegex = /\/\*\*\s*\n\s*\*\s*(.+?)\s*\n\s*\*\/\s*\n\s*"([^"]+)":\s*"?([^,\n"]+)"?/g;
    let vm;
    while ((vm = valueRegex.exec(body)) !== null) {
      values.push({ label: vm[1].trim(), key: vm[2], value: vm[3] });
    }
    dicts.push({ name, comment, values, isReconcile: name.toLowerCase().includes('reconcile') });
  }

  const reconcileDicts = dicts.filter(d => d.isReconcile);
  const lines = ['# 前端字典常量（hermesDict 生成）', ''];
  lines.push(`**字典总数：** ${dicts.length}`);
  lines.push(`**对账相关：** ${reconcileDicts.length}`);
  lines.push('');
  lines.push('## 对账相关字典');
  lines.push('');
  for (const d of reconcileDicts) {
    lines.push(`### ${d.name}`);
    lines.push(`${d.comment}`);
    lines.push('');
    if (d.values.length > 0) {
      lines.push('| code | 中文标签 |');
      lines.push('|------|---------|');
      for (const v of d.values) lines.push(`| \`${v.key}\` | ${v.label} |`);
    }
    lines.push('');
  }
  lines.push('## 其他字典（仅列名）');
  lines.push('');
  lines.push('| 字典名 | 说明 | 值数量 |');
  lines.push('|--------|------|--------|');
  for (const d of dicts.filter(d => !d.isReconcile)) {
    lines.push(`| ${d.name} | ${d.comment} | ${d.values.length} |`);
  }

  const body = lines.join('\n');
  writeDocument(outputPath, createFrontmatter({ kb_layer: 'domain', summary: `hermesDict 字典，${dicts.length} 个，对账相关 ${reconcileDicts.length} 个`, sources: [dictFile], commit, body }), body);
}

function generateApiTypesDoc(typesFile, outputPath, commit) {
  const { createFrontmatter, writeDocument } = require('./frontmatter');
  const content = fs.readFileSync(typesFile, 'utf-8');

  const nsRegex = /\/\*\*[\s\S]*?接口路径：([^\n]+)[\s\S]*?\*\/\s*\nexport namespace (\w+)\s*\{([\s\S]*?)(?=\nexport namespace|$)/g;
  const apis = [];
  let match;
  while ((match = nsRegex.exec(content)) !== null) {
    const apiPath = match[1].trim();
    const nsName = match[2];
    const body = match[3];
    if (!apiPath.includes('reconcile')) continue;
    const reqMatch = body.match(/export interface Req\s*\{([\s\S]*?)\n\s*\}/);
    if (!reqMatch) continue;
    const fields = [];
    const fieldRegex = /^\s*(\w+)\??:\s*([^;]+);/gm;
    let fm;
    while ((fm = fieldRegex.exec(reqMatch[1])) !== null) {
      fields.push({ name: fm[1], type: fm[2].trim() });
    }
    if (fields.length > 0) apis.push({ nsName, apiPath, fields });
  }

  const lines = ['# 前端 API 类型定义', '', `**接口数：** ${apis.length}`, ''];
  for (const api of apis.slice(0, 50)) {
    lines.push(`## ${api.nsName}`);
    lines.push(`**路径：** \`${api.apiPath}\``);
    lines.push('');
    if (api.fields.length > 0) {
      lines.push('| 字段 | 类型 |');
      lines.push('|------|------|');
      for (const f of api.fields.slice(0, 15)) lines.push(`| ${f.name} | \`${f.type}\` |`);
    }
    lines.push('');
  }

  const body = lines.join('\n');
  writeDocument(outputPath, createFrontmatter({ kb_layer: 'contracts', summary: `API 类型定义，${apis.length} 个接口`, sources: [typesFile], commit, body }), body);
}

function generateApiClientFullDoc(apiFile, outputPath, commit, isPortal) {
  const { createFrontmatter, writeDocument } = require('./frontmatter');
  const content = fs.readFileSync(apiFile, 'utf-8');

  const fnRegex = /^export\s+const\s+(\w+)\s*=/gm;
  const apis = [];
  let match;
  while ((match = fnRegex.exec(content)) !== null) {
    const fnName = match[1];
    let method = 'GET';
    if (fnName.startsWith('post')) method = 'POST';
    else if (fnName.startsWith('put')) method = 'PUT';
    else if (fnName.startsWith('delete')) method = 'DELETE';
    apis.push({ fnName, method });
  }

  const prefix = isPortal ? '供应商端' : '采购端';
  const lines = [`# ${prefix} API 客户端`, '', `**API 函数数：** ${apis.length}`, ''];
  lines.push('| 函数名 | HTTP |');
  lines.push('|--------|------|');
  for (const a of apis) lines.push(`| ${a.fnName} | ${a.method} |`);

  const body = lines.join('\n');
  writeDocument(outputPath, createFrontmatter({ kb_layer: 'contracts', summary: `${prefix} API 客户端，${apis.length} 个函数`, sources: [apiFile], commit, body }), body);
}

function generateFrontendEnumsDoc(statusMappingFile, projectSource, outputPath, commit) {
  const { createFrontmatter, writeDocument } = require('./frontmatter');
  const content = fs.readFileSync(statusMappingFile, 'utf-8');

  const lines = ['# 前端状态聚合映射', ''];
  lines.push('PRD 要求对外只展示 6 种状态，但后端节点细分。前端做了聚合。');
  lines.push('');
  lines.push('| 前端展示态 | 对应的后端枚举 |');
  lines.push('|-----------|-------------|');
  lines.push('| 新建 | NEW |');
  lines.push('| 待供应商填写 | WAIT_SUPPLIER_FEEDBACK |');
  lines.push('| 业务对账 | WAIT_SUPPLIER_CONFIRM, SUPPLIER_CONFIRMED, BILLING |');
  lines.push('| 审批中 | WAIT_PURCHASER_CONFIRM_AMOUNT, WAIT_BUSINESS_*_CONFIRM_USAGE, PURCHASER_LEADER, PURCHASER_CENTER_LEADER |');
  lines.push('| 对账完成 | BILL_CONFIRMED |');
  lines.push('| 已取消/已作废 | CANCELED, VOID |');
  lines.push('');
  lines.push('**关键函数**：`getDisplayStatus(raw)`, `expandStatusForFilter(statusList)`');

  const body = lines.join('\n');
  writeDocument(outputPath, createFrontmatter({ kb_layer: 'domain', summary: '前端状态聚合映射，6 态 → 后端枚举', sources: [statusMappingFile], commit, body }), body);
}

function generateFieldLinkageDoc(project, kbDir, commit) {
  const { createFrontmatter, writeDocument } = require('./frontmatter');
  const appDir = path.join(project.source, project.apps[0].path, 'src/pages');
  if (!fs.existsSync(appDir)) return;

  const rules = [];
  walkTsx(appDir, (fp) => {
    const content = fs.readFileSync(fp, 'utf-8');
    const component = path.basename(path.dirname(fp));

    // 提取 hiddenFields
    const hiddenMatch = content.match(/hiddenFields\s*=\s*useMemo\(\(\)\s*=>\s*\{([\s\S]*?)\n\s*\},\s*\[/);
    if (hiddenMatch) {
      const ifBlocks = hiddenMatch[1].match(/if\s*\(([^)]+)\)\s*\{([^}]+)\}/g) || [];
      for (const ifBlock of ifBlocks) {
        const condMatch = ifBlock.match(/if\s*\(([^)]+)\)/);
        const fields = (ifBlock.match(/'([^']+)'/g) || []).map(f => f.replace(/'/g, ''));
        if (condMatch && fields.length > 0) {
          rules.push({ type: 'hidden', condition: condMatch[1].trim().slice(0, 80), fields, component });
        }
      }
    }

    // 提取 disabledFields
    const disabledMatches = content.match(/disabledFields\s*[:=]\s*\[([^\]]+)\]/g) || [];
    for (const dm of disabledMatches) {
      const fields = (dm.match(/'([^']+)'/g) || []).map(f => f.replace(/'/g, ''));
      if (fields.length > 0) rules.push({ type: 'disabled', condition: 'editType', fields, component });
    }

    // 提取 requiredFieldMap
    const reqMap = content.match(/requiredFieldMap\.(\w+)/g);
    if (reqMap) {
      const fields = [...new Set(reqMap.map(m => m.replace('requiredFieldMap.', '')))];
      rules.push({ type: 'dynamic-required', condition: '后端 requiredFieldList 控制', fields, component });
    }
  });

  const lines = ['# 前端表单字段联动规则', '', `**规则数：** ${rules.length}`, ''];
  const grouped = { hidden: [], disabled: [], 'dynamic-required': [] };
  for (const r of rules) { if (grouped[r.type]) grouped[r.type].push(r); }

  lines.push('## 隐藏规则');
  lines.push('| 条件 | 被隐藏字段 | 组件 |');
  lines.push('|------|-----------|------|');
  for (const r of grouped.hidden) lines.push(`| \`${r.condition}\` | ${r.fields.join(', ')} | ${r.component} |`);
  lines.push('');
  lines.push('## 禁用规则');
  lines.push('| 条件 | 被禁用字段 | 组件 |');
  lines.push('|------|-----------|------|');
  for (const r of grouped.disabled) lines.push(`| ${r.condition} | ${r.fields.join(', ')} | ${r.component} |`);
  lines.push('');
  lines.push('## 动态必填');
  lines.push('| 条件 | 字段 | 组件 |');
  lines.push('|------|------|------|');
  for (const r of grouped['dynamic-required']) lines.push(`| ${r.condition} | ${r.fields.join(', ')} | ${r.component} |`);

  const body = lines.join('\n');
  const outputPath = path.join(kbDir, project.apps[0].name, 'field-linkage-rules.md');
  writeDocument(outputPath, createFrontmatter({ kb_layer: 'domain', summary: `字段联动规则，${rules.length} 条`, sources: [], commit, body }), body);
}

function generateNodeButtonMatrixDoc(project, kbDir, commit) {
  const { createFrontmatter, writeDocument } = require('./frontmatter');
  const appSrc = path.join(project.source, project.apps[0].path, 'src');

  // 找 useOperator 或 FooterContent 提取按钮列表
  const operatorFile = findFile(project.source, 'useOperator.tsx', project.apps[0].path);
  if (!operatorFile) return;

  const content = fs.readFileSync(operatorFile, 'utf-8');
  const buttons = [];
  const enumRegex = /(\w+)\s*=\s*'([^']+)'/g;
  let match;
  while ((match = enumRegex.exec(content)) !== null) {
    if (content.indexOf(match[0]) < content.indexOf('const modalProps')) {
      buttons.push({ code: match[2], name: match[1] });
    }
  }

  const lines = ['# 节点×按钮×字段权限矩阵', ''];
  lines.push('按钮显隐由后端 `GET /reconcile/usage/button` 动态返回。');
  lines.push('');
  lines.push('## 全部按钮');
  lines.push('| code | 枚举名 |');
  lines.push('|------|--------|');
  for (const b of buttons) lines.push(`| \`${b.code}\` | ${b.name} |`);
  lines.push('');
  lines.push('## 权限机制');
  lines.push('- `<AuthOperate operateName="xxx">` 组件根据 `permissionOperate` 数组决定是否渲染');
  lines.push('- `permissionOperate` 由后端接口根据 用户角色 + 对账单状态 动态返回');

  const body = lines.join('\n');
  const outputPath = path.join(kbDir, project.apps[0].name, 'node-button-field-matrix.md');
  writeDocument(outputPath, createFrontmatter({ kb_layer: 'domain', summary: `按钮权限矩阵，${buttons.length} 个按钮`, sources: [operatorFile], commit, body }), body);
}

function findFile(baseDir, fileName, subPath) {
  const searchDir = subPath ? path.join(baseDir, subPath) : baseDir;
  try {
    const result = execSync(`find "${searchDir}" -name "${fileName}" -not -path "*/node_modules/*" 2>/dev/null`).toString().trim().split('\n');
    return result[0] || null;
  } catch (e) { return null; }
}

function walkTsx(dir, callback) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') walkTsx(full, callback);
    else if (/\.(tsx|ts)$/.test(entry.name)) callback(full);
  }
}

async function scanGateway(project, kbDir) {
  const { createFrontmatter, writeDocument } = require('./frontmatter');
  const commit = getCommit(project.source);

  // 自动检测 Retrofit API 目录
  let modules = project.modules;
  if (!modules || modules.length === 0) {
    // 找所有包含 @GET/@POST 注解的 controller/api 目录
    const retrofitDirs = [];
    const sourceBase = project.source;
    try {
      const result = execSync(`grep -rl "@GET\\|@POST\\|@PUT\\|@DELETE" "${sourceBase}" --include="*.java" 2>/dev/null | head -20`).toString().trim();
      if (result) {
        const dirs = [...new Set(result.split('\n').map(f => path.dirname(f)))];
        for (const d of dirs) {
          retrofitDirs.push(d);
        }
      }
    } catch (e) {}

    if (retrofitDirs.length > 0) {
      modules = [{ name: project.name, retrofit_api_path: path.relative(sourceBase, retrofitDirs[0]) }];
    } else {
      modules = [];
    }
  }

  for (const mod of modules) {
    const retrofitPath = mod.retrofit_api_path;
    if (!retrofitPath) continue;
    const apiDir = path.join(project.source, retrofitPath);
    if (!fs.existsSync(apiDir)) continue;

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
              apis.push({ method: annMatch[1], path: annMatch[2], fn: fnMatch[1], file: path.basename(fp) });
              break;
            }
          }
        }
      }
    });

    const lines = ['# 网关转发映射（supplier-portal → pur-center）', ''];
    lines.push(`**转发接口数：** ${apis.length}`);
    lines.push('');
    lines.push('| HTTP | pur-center 路径 | 方法 | 来源 |');
    lines.push('|------|----------------|------|------|');
    for (const a of apis) lines.push(`| ${a.method} | \`${a.path}\` | ${a.fn} | ${a.file} |`);
    lines.push('');
    lines.push('## 鉴权');
    lines.push('所有接口经 `SupplierInfoInterceptor`：从 token 提取 supplierCode → 注入转发请求 header');

    const body = lines.join('\n');
    writeDocument(path.join(kbDir, 'api-mapping.md'), createFrontmatter({
      kb_layer: 'contracts', summary: `网关转发映射，${apis.length} 个接口`, sources: [], commit, body
    }), body);
    console.log(`  api-mapping: ${apis.length} 个接口`);
  }
}

function generateCrossProjectDocs(config, outputDir) {
  const { createFrontmatter, writeDocument } = require('./frontmatter');

  // 1. system-topology.md（自动生成）
  const topoPath = path.join(outputDir, 'system-topology.md');
  const topoLines = ['# 系统拓扑', ''];
  topoLines.push('```');
  for (const rel of (config.relations || [])) {
    const from = rel.app || rel.frontend;
    const to = rel.backend;
    const via = rel.gateway || (rel.mode === 'direct' ? '直连' : rel.mode);
    if (via === '直连' || !rel.gateway) {
      topoLines.push(`${from} ──直连──▶ ${to}`);
    } else {
      topoLines.push(`${from} ──▶ ${via} ──▶ ${to}`);
    }
  }
  topoLines.push('```');
  topoLines.push('');
  topoLines.push('## 各项目');
  topoLines.push('| 项目 | 类型 | KB 位置 |');
  topoLines.push('|------|------|---------|');
  for (const p of config.projects) {
    topoLines.push(`| ${p.name} | ${p.type}${p.role ? ' (' + p.role + ')' : ''} | ${p.name}/kb/ |`);
  }
  topoLines.push('');
  if (config.external_systems) {
    topoLines.push('## 外部系统');
    topoLines.push('| 系统 | 说明 |');
    topoLines.push('|------|------|');
    for (const es of config.external_systems) {
      topoLines.push(`| ${es.name} | ${es.description} |`);
    }
  }
  fs.writeFileSync(topoPath, topoLines.join('\n'), 'utf-8');
  console.log('  system-topology.md: ✓（自动生成）');

  // 2. frontend-backend-map.md（自动生成）
  const mapPath = path.join(outputDir, 'frontend-backend-map.md');
  const mapLines = ['# 前后端接口映射', ''];
  mapLines.push('| 前端 App | 经过 | 后端项目 | 说明 |');
  mapLines.push('|---------|------|---------|------|');
  for (const rel of (config.relations || [])) {
    const from = rel.app || rel.frontend;
    const to = rel.backend;
    const via = rel.gateway ? rel.gateway : '直连';
    const desc = rel.exclude_apps ? `(排除: ${rel.exclude_apps.join(', ')})` : '';
    mapLines.push(`| ${from} | ${via} | ${to} | ${desc} |`);
  }
  mapLines.push('');
  mapLines.push('> 详细的函数级映射见各前端 app 的 `backend-mapping.md`');
  fs.writeFileSync(mapPath, mapLines.join('\n'), 'utf-8');
  console.log('  frontend-backend-map.md: ✓（自动生成）');

  // 3. 生成前后端函数级映射（backend-mapping.md）
  generateBackendMapping(config, outputDir);
}

function generateBackendMapping(config, outputDir) {
  const { createFrontmatter, writeDocument } = require('./frontmatter');

  // 找前端 API 文件和后端 flow 文件
  const reactProject = config.projects.find(p => p.type === 'react');
  const backendProject = config.projects.find(p => p.type === 'java-spring' && p.role !== 'gateway');
  if (!reactProject || !backendProject) return;

  // 读后端 flow 文件
  const flowsDir = path.join(outputDir, backendProject.name, 'kb');
  const backendFlows = [];
  walkMdFiles(flowsDir, (fp) => {
    if (!fp.includes('/flows/')) return;
    const content = fs.readFileSync(fp, 'utf-8');
    const pathMatch = content.match(/`(POST|GET|PUT|DELETE)\s+([^`]+)`/);
    if (pathMatch) backendFlows.push({ file: path.relative(flowsDir, fp), method: pathMatch[1], path: pathMatch[2] });
  });

  // 对每个前端 app 生成映射
  for (const app of reactProject.apps) {
    const apiClientPath = path.join(outputDir, reactProject.name, 'kb', app.name, 'api-client.md');
    if (!fs.existsSync(apiClientPath)) continue;

    const apiContent = fs.readFileSync(apiClientPath, 'utf-8');
    const fnRegex = /\|\s*(\w+)\s*\|\s*(GET|POST|PUT|DELETE)\s*\|/g;
    const mappings = [];
    let match;
    while ((match = fnRegex.exec(apiContent)) !== null) {
      const fnName = match[1];
      const method = match[2];
      // 匹配后端 flow
      const segments = fnName.replace(/^(get|post|put|delete)/, '').replace(/([A-Z])/g, '/$1').toLowerCase().split('/').filter(Boolean);
      let bestFlow = null;
      let bestScore = 0;
      for (const flow of backendFlows) {
        if (flow.method !== method) continue;
        const flowSegments = flow.path.split('/').filter(Boolean);
        let score = 0;
        for (const seg of segments) {
          if (flowSegments.some(fs => fs.includes(seg) || seg.includes(fs))) score++;
        }
        if (score > bestScore) { bestScore = score; bestFlow = flow; }
      }
      if (bestFlow && bestScore >= 2) {
        mappings.push({ frontend: fnName, method, backendPath: bestFlow.path, flowFile: bestFlow.file });
      }
    }

    if (mappings.length === 0) continue;

    const rel = (config.relations || []).find(r => r.from === app.name);
    const via = rel ? (rel.via === 'direct' ? '直连' : rel.via) : '直连';

    const lines = ['# 前后端接口映射', ''];
    lines.push(`**App：** ${app.name} (${app.role})`);
    lines.push(`**经过：** ${via}`);
    lines.push(`**映射数：** ${mappings.length}`);
    lines.push('');
    lines.push('| 前端函数 | HTTP | 后端路径 | 后端 flow |');
    lines.push('|---------|------|---------|----------|');
    for (const m of mappings) {
      lines.push(`| ${m.frontend} | ${m.method} | \`${m.backendPath}\` | [flow](../../${backendProject.name}/kb/${m.flowFile}) |`);
    }

    const body = lines.join('\n');
    const outPath = path.join(outputDir, reactProject.name, 'kb', app.name, 'backend-mapping.md');
    writeDocument(outPath, createFrontmatter({ kb_layer: 'flows', summary: `前后端映射，${mappings.length} 条（${app.name} → ${backendProject.name}）`, sources: [], commit: 'auto', body }), body);
  }
  console.log('  backend-mapping: ✓');
}

function walkMdFiles(dir, callback) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkMdFiles(full, callback);
    else if (entry.name.endsWith('.md')) callback(full);
  }
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

function getCommit(sourceDir) {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: sourceDir }).toString().trim();
  } catch (e) {
    return 'unknown';
  }
}

function autoDetectModules(sourceDir) {
  const modules = [];

  // 1. 尝试从 settings.gradle 解析
  const settingsGradle = path.join(sourceDir, 'settings.gradle');
  const settingsGradleKts = path.join(sourceDir, 'settings.gradle.kts');
  const settingsFile = fs.existsSync(settingsGradle) ? settingsGradle : (fs.existsSync(settingsGradleKts) ? settingsGradleKts : null);

  if (settingsFile) {
    const content = fs.readFileSync(settingsFile, 'utf-8');
    const includeRegex = /include\s*\(?['"]([^'"]+)['"]/g;
    let match;
    while ((match = includeRegex.exec(content)) !== null) {
      const modPath = match[1].replace(/:/g, '/');
      const modName = modPath.split('/').pop();
      // 跳过 common/infra/test 等非业务模块
      if (['pur-common', 'pur-infra', 'pur-test', 'pur-web'].includes(modName)) continue;
      const fullPath = path.join(sourceDir, modPath, 'src/main/java');
      if (fs.existsSync(fullPath)) {
        modules.push({ name: modName, path: `${modPath}/src/main/java` });
      }
    }
  }

  // 2. 回退：扫 app/ 目录
  if (modules.length === 0) {
    const appDir = path.join(sourceDir, 'app');
    if (fs.existsSync(appDir)) {
      for (const entry of fs.readdirSync(appDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (['pur-common', 'pur-infra', 'pur-test', 'pur-web'].includes(entry.name)) continue;
        const javaDir = path.join(appDir, entry.name, 'src/main/java');
        if (fs.existsSync(javaDir)) {
          modules.push({ name: entry.name, path: `app/${entry.name}/src/main/java` });
        }
      }
    }
  }

  return modules;
}

function findDir(sourceDir, moduleName, dirNames) {
  // 在模块的 java 源码目录下递归找匹配的目录名
  const moduleBase = path.join(sourceDir, 'app', moduleName, 'src/main/java');
  if (!fs.existsSync(moduleBase)) return null;

  let found = null;
  function walk(dir, depth) {
    if (depth > 6 || found) return;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (dirNames.includes(entry.name)) {
          found = path.join(dir, entry.name);
          return;
        }
        walk(path.join(dir, entry.name), depth + 1);
      }
    } catch (e) {}
  }
  walk(moduleBase, 0);
  return found;
}

function resolveDbConfig(project, config) {
  const dbDef = project.db || config.database;
  if (!dbDef) return null;

  // 1. 优先从环境变量读密码
  let password = dbDef.password_env ? process.env[dbDef.password_env] : null;

  // 2. 没有环境变量 → 从项目的 application.yml 自动解析
  if (!password && project.source) {
    password = parsePasswordFromApplicationYml(project.source);
  }

  if (!password) {
    console.log('  ⚠ 数据库密码未找到（设 PUR_DB_PASSWORD 环境变量或确保 application.yml 中有密码）');
  }

  return {
    host: dbDef.host,
    port: dbDef.port,
    user: dbDef.username,
    password: password,
    database: dbDef.database
  };
}

function parsePasswordFromApplicationYml(sourceDir) {
  // 查找 application.yml 文件
  const candidates = [
    'app/pur-web/src/main/resources/application.yml',
    'app/pur-web/src/main/resources/application.yaml',
    'src/main/resources/application.yml',
    'src/main/resources/application.yaml'
  ];

  for (const candidate of candidates) {
    const filePath = path.join(sourceDir, candidate);
    if (!fs.existsSync(filePath)) continue;

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    // 策略：找到非注释的 jdbc url 行，然后在附近找 password
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith('#')) continue;
      if (line.includes('jdbc:mysql') || line.includes('jdbc:postgresql') || line.includes('datasource')) {
        // 在接下来 5 行内找 password
        for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
          if (lines[j].trim().startsWith('#')) continue;
          const match = lines[j].match(/^\s+password:\s*(.+)/);
          if (match) {
            const pwd = match[1].trim();
            if (pwd && !pwd.startsWith('${') && pwd.length > 0) {
              return pwd;
            }
          }
        }
      }
    }
  }
  return null;
}

function autoDetectReactApps(sourceDir) {
  const apps = [];

  // 1. 检查 apps/ 目录（monorepo）
  const appsDir = path.join(sourceDir, 'apps');
  if (fs.existsSync(appsDir)) {
    for (const entry of fs.readdirSync(appsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgJson = path.join(appsDir, entry.name, 'package.json');
      if (fs.existsSync(pkgJson)) {
        apps.push({ name: entry.name, path: `apps/${entry.name}`, role: 'default' });
      }
    }
  }

  // 2. 检查 packages/ 目录
  if (apps.length === 0) {
    const pkgsDir = path.join(sourceDir, 'packages');
    if (fs.existsSync(pkgsDir)) {
      for (const entry of fs.readdirSync(pkgsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const srcDir = path.join(pkgsDir, entry.name, 'src');
        if (fs.existsSync(srcDir)) {
          apps.push({ name: entry.name, path: `packages/${entry.name}`, role: 'default' });
        }
      }
    }
  }

  // 3. 单应用（根目录有 src/）
  if (apps.length === 0 && fs.existsSync(path.join(sourceDir, 'src'))) {
    const pkg = fs.existsSync(path.join(sourceDir, 'package.json'))
      ? JSON.parse(fs.readFileSync(path.join(sourceDir, 'package.json'), 'utf-8'))
      : { name: path.basename(sourceDir) };
    apps.push({ name: pkg.name || path.basename(sourceDir), path: '.', role: 'default' });
  }

  return apps;
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
