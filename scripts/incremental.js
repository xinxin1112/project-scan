#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { parse, serialize, computeBodyHash, readDocument } = require('./frontmatter');

function findStaleDocuments(kbDir, repoDir) {
  const stale = [];
  const skipped = [];

  walkMd(kbDir, (filePath) => {
    const doc = readDocument(filePath);
    if (!doc || !doc.frontmatter) return;

    const fm = doc.frontmatter;

    // 跳过 human_edited
    if (fm.human_edited) {
      skipped.push({ file: filePath, reason: 'human_edited' });
      return;
    }

    // 跳过无 sources 的文档（手写文档如 external-systems）
    if (!fm.sources || fm.sources.length === 0) return;
    if (!fm.last_scan_commits || fm.last_scan_commits.length === 0) return;

    // 检查 sources 是否有变更
    // scan-all.js 记录的是扫描时的 repo HEAD（短 hash）
    // 这里比对：当前 repo HEAD 是否与记录的 commit 一致
    const lastCommit = fm.last_scan_commits[0]?.commit;
    if (!lastCommit) return;

    // 获取当前 repo HEAD
    let currentHead;
    try {
      currentHead = execSync('git rev-parse --short HEAD', { cwd: repoDir }).toString().trim();
    } catch (e) {
      return;
    }

    // 如果 repo HEAD 没变，所有文档都是最新的
    if (currentHead === lastCommit) return;

    // repo HEAD 变了，检查 sources 文件是否在 lastCommit..HEAD 之间有变更
    for (const source of fm.sources) {
      // source 可能是相对于 KB 文件的路径，需要解析成相对于 repoDir 的路径
      let gitRelPath;
      if (path.isAbsolute(source)) {
        gitRelPath = path.relative(repoDir, source);
      } else {
        const absSource = path.resolve(path.dirname(filePath), source);
        gitRelPath = path.relative(repoDir, absSource);
      }

      // 如果解析后的路径指向 repo 外部（以 .. 开头），跳过
      if (gitRelPath.startsWith('..')) continue;

      try {
        const changed = execSync(`git diff --name-only ${lastCommit}..HEAD -- "${gitRelPath}"`, { cwd: repoDir }).toString().trim();
        if (changed) {
          stale.push({
            kbFile: filePath,
            changedSource: source,
            lastCommit,
            currentCommit: currentHead
          });
          break;
        }
      } catch (e) {
        // git 命令失败（可能是 shallow clone），用文件级 commit 回退
        try {
          const fileCommit = execSync(`git log -1 --format=%h -- "${gitRelPath}"`, { cwd: repoDir }).toString().trim();
          if (fileCommit && fileCommit !== lastCommit) {
            stale.push({
              kbFile: filePath,
              changedSource: source,
              lastCommit,
              currentCommit: fileCommit
            });
            break;
          }
        } catch (e2) {
          // 跳过
        }
      }
    }
  });

  return { stale, skipped };
}

function detectHumanEdits(kbDir) {
  const edited = [];

  walkMd(kbDir, (filePath) => {
    const doc = readDocument(filePath);
    if (!doc || !doc.frontmatter) return;

    const fm = doc.frontmatter;
    if (fm.human_edited) return; // 已标记

    // 检查 body hash
    if (fm.last_scan_commits && fm.last_scan_commits.length > 0) {
      const storedHash = fm.last_scan_commits[0]?.body_hash;
      if (storedHash) {
        const currentHash = computeBodyHash(doc.body);
        if (currentHash !== storedHash) {
          edited.push({ file: filePath, storedHash, currentHash });
        }
      }
    }
  });

  return edited;
}

function markHumanEdited(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const doc = parse(content);
  if (!doc.frontmatter) return false;

  doc.frontmatter.human_edited = true;
  fs.writeFileSync(filePath, serialize(doc.frontmatter, doc.body), 'utf-8');
  return true;
}

function walkMd(dir, callback) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkMd(full, callback);
    } else if (entry.name.endsWith('.md')) {
      callback(full);
    }
  }
}

module.exports = { findStaleDocuments, detectHumanEdits, markHumanEdited, classifyStaleDoc, regenerateStaleDocuments };

/**
 * 判断过期文档的重生成策略
 * - 层次 2 flow（含"条件分支流程"heading）→ 需要 LM
 * - 层次 1 flow（仅调用链）→ flow-generator.js 纯脚本
 * - 其他文档（entity/enum/contract/method-index）→ 对应生成器纯脚本
 */
function classifyStaleDoc(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const relativePath = filePath.replace(/.*\/kb\//, '');

  if (relativePath.includes('flows/')) {
    if (content.includes('## 条件分支流程')) {
      return { type: 'flow-level2', needsLM: true };
    }
    return { type: 'flow-level1', needsLM: false };
  }
  if (relativePath.includes('domain/entities/')) return { type: 'entity', needsLM: false };
  if (relativePath.includes('domain/enums/')) return { type: 'enum', needsLM: false };
  if (relativePath.includes('domain/state-machines/')) return { type: 'state-machine', needsLM: false };
  if (relativePath.includes('domain/rules/')) return { type: 'rules', needsLM: false };
  if (relativePath.includes('domain/error-codes')) return { type: 'error-codes', needsLM: false };
  if (relativePath.includes('contracts/')) return { type: 'contract', needsLM: false };
  if (relativePath.includes('code/')) return { type: 'method-index', needsLM: false };
  return { type: 'unknown', needsLM: false };
}

/**
 * 对过期文档执行重生成
 * 返回 { regenerated, skippedLM } 统计
 */
function regenerateStaleDocuments(staleDocs, options = {}) {
  const { repoDir = process.cwd(), kbDir = 'kb', autoLM = false } = options;
  const results = { regenerated: [], skippedLM: [], errors: [] };

  for (const staleDoc of staleDocs) {
    const classification = classifyStaleDoc(staleDoc.kbFile);

    if (classification.needsLM && !autoLM) {
      // 层次 2 flow 需要 LM，但未启用自动 LM → 跳过，记录
      results.skippedLM.push({
        file: staleDoc.kbFile,
        reason: '层次 2 flow 需要 LM 重生成，使用 --auto-lm 启用或手动更新'
      });
      continue;
    }

    try {
      switch (classification.type) {
        case 'flow-level2':
          // 需要调 LM：提取代码 → 构建 prompt → 调 API → 写入
          regenerateFlowLevel2(staleDoc, repoDir);
          results.regenerated.push({ file: staleDoc.kbFile, type: 'flow-level2', method: 'LM' });
          break;

        case 'flow-level1': {
          const { generateFlowDocs } = require('./flow-generator');
          const doc = readDocument(staleDoc.kbFile);
          const sources = doc?.frontmatter?.sources || [];
          if (sources.length > 0) {
            const sourceFile = path.resolve(repoDir, sources[0]);
            if (fs.existsSync(sourceFile)) {
              generateFlowDocs(sourceFile, path.dirname(staleDoc.kbFile));
            }
          }
          results.regenerated.push({ file: staleDoc.kbFile, type: 'flow-level1', method: 'script' });
          break;
        }

        case 'entity': {
          const { generateEntityDoc } = require('./entity-generator');
          const doc = readDocument(staleDoc.kbFile);
          const sources = doc?.frontmatter?.sources || [];
          if (sources.length > 0) {
            const sourceFile = path.resolve(repoDir, sources[0]);
            if (fs.existsSync(sourceFile)) {
              generateEntityDoc(sourceFile, staleDoc.kbFile);
            }
          }
          results.regenerated.push({ file: staleDoc.kbFile, type: 'entity', method: 'script' });
          break;
        }

        case 'enum': {
          const { generateEnumDoc } = require('./enum-generator');
          const doc = readDocument(staleDoc.kbFile);
          const sources = doc?.frontmatter?.sources || [];
          if (sources.length > 0) {
            const sourceFile = path.resolve(repoDir, sources[0]);
            if (fs.existsSync(sourceFile)) {
              generateEnumDoc(sourceFile, staleDoc.kbFile);
            }
          }
          results.regenerated.push({ file: staleDoc.kbFile, type: 'enum', method: 'script' });
          break;
        }

        case 'state-machine': {
          const { generateStateMachineDoc } = require('./state-machine-generator');
          const doc = readDocument(staleDoc.kbFile);
          const sources = doc?.frontmatter?.sources || [];
          if (sources.length > 0) {
            const sourceFile = path.resolve(repoDir, sources[0]);
            if (fs.existsSync(sourceFile)) {
              generateStateMachineDoc(sourceFile, staleDoc.kbFile);
            }
          }
          results.regenerated.push({ file: staleDoc.kbFile, type: 'state-machine', method: 'script' });
          break;
        }

        case 'contract': {
          const { generateContractDoc } = require('./contract-generator');
          const doc = readDocument(staleDoc.kbFile);
          const sources = doc?.frontmatter?.sources || [];
          if (sources.length > 0) {
            const sourceFile = path.resolve(repoDir, sources[0]);
            if (fs.existsSync(sourceFile)) {
              generateContractDoc(sourceFile, staleDoc.kbFile);
            }
          }
          results.regenerated.push({ file: staleDoc.kbFile, type: 'contract', method: 'script' });
          break;
        }

        case 'method-index': {
          const { generateMethodIndex } = require('./method-index-generator');
          const doc = readDocument(staleDoc.kbFile);
          const sources = doc?.frontmatter?.sources || [];
          if (sources.length > 0) {
            const sourceFile = path.resolve(repoDir, sources[0]);
            if (fs.existsSync(sourceFile)) {
              generateMethodIndex(sourceFile, staleDoc.kbFile);
            }
          }
          results.regenerated.push({ file: staleDoc.kbFile, type: 'method-index', method: 'script' });
          break;
        }

        case 'error-codes':
        case 'rules': {
          const { generateRulesDoc } = require('./rules-generator');
          const doc = readDocument(staleDoc.kbFile);
          const sources = doc?.frontmatter?.sources || [];
          if (sources.length > 0) {
            const sourceFile = path.resolve(repoDir, sources[0]);
            if (fs.existsSync(sourceFile)) {
              generateRulesDoc(sourceFile, staleDoc.kbFile);
            }
          }
          results.regenerated.push({ file: staleDoc.kbFile, type: classification.type, method: 'script' });
          break;
        }

        default:
          results.errors.push({ file: staleDoc.kbFile, reason: '未知文档类型' });
      }
    } catch (e) {
      results.errors.push({ file: staleDoc.kbFile, reason: e.message });
    }
  }

  return results;
}

function regenerateFlowLevel2(staleDoc, repoDir) {
  // 从 flow 文档的 sources 找到 Controller 文件
  const doc = readDocument(staleDoc.kbFile);
  if (!doc || !doc.frontmatter) return;

  const controllerSource = (doc.frontmatter.sources || []).find(s => s.includes('Controller'));
  if (!controllerSource) return;

  // 从文档内容提取方法名
  const methodMatch = doc.body.match(/\*\*Controller：\*\*\s*\w+\.(\w+)/);
  if (!methodMatch) return;
  const methodName = methodMatch[1];

  // 调用 flow-level2-builder 构建 prompt
  const builderPath = path.join(__dirname, 'flow-level2-builder.js');
  const { buildPromptForMethod } = require(builderPath);

  const sourceDir = path.join(repoDir, 'app/pur-reconcile/src/main/java');
  const enumDir = path.join(repoDir, 'app/pur-common/src/main/java/com/bilibili/purchase/common/enums');
  const controllerFile = path.join(repoDir, controllerSource);

  const prompt = buildPromptForMethod(controllerFile, methodName, sourceDir, enumDir);
  if (!prompt) return;

  // 保存 prompt 供 LM 调用（实际调 API 的逻辑在这里扩展）
  const promptDir = path.join(__dirname, '../.scratch/prompts/pending');
  if (!fs.existsSync(promptDir)) fs.mkdirSync(promptDir, { recursive: true });
  fs.writeFileSync(
    path.join(promptDir, `${methodName}.txt`),
    `SYSTEM:\n${prompt.system}\n\nUSER:\n${prompt.user}`
  );

  console.log(`    → 层次 2 prompt 已生成: .scratch/prompts/pending/${methodName}.txt`);
  console.log(`      需要调 LM API 生成文档（或手动用 Claude 分析）`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const autoLM = args.includes('--auto-lm');
  const update = args.includes('--update');
  const branchArg = args.find(a => a.startsWith('--branch='));
  const branchKey = branchArg ? branchArg.split('=')[1] : null;
  const projectArg = args.find(a => a.startsWith('--project='));
  const projectFilter = projectArg ? projectArg.split('=')[1] : null;
  const positionalArgs = args.filter(a => !a.startsWith('--'));

  // 判断第一个参数是 config 文件还是 kb 目录
  const firstArg = positionalArgs[0];
  const isConfigMode = firstArg && firstArg.endsWith('.yaml');

  if (isConfigMode) {
    // 新模式：读 scan-config.yaml，遍历所有项目
    const yaml = require('js-yaml');
    const config = yaml.load(fs.readFileSync(firstArg, 'utf-8'));
    const outputDir = config.output_dir;
    const envs = branchKey ? [branchKey] : Object.keys(config.branches || { prod: {} });

    console.log('=== 新鲜度检查 ===\n');

    const staleProjects = [];
    const freshProjects = [];

    for (const env of envs) {
      for (const project of config.projects) {
        if (projectFilter && project.name !== projectFilter) continue;
        // 确定源码目录
        let repoDir;
        if (env === 'prod') {
          repoDir = project.source || path.join(outputDir, '.sources', project.name);
        } else {
          repoDir = path.join(outputDir, '.sources', `${project.name}-${env}`);
        }
        if (!fs.existsSync(repoDir)) {
          console.log(`  [skip] ${project.name}-${env}: worktree 不存在`);
          continue;
        }

        // 唯一信号：commitsBehind（本地 HEAD vs config 指定分支的远程 HEAD）
        // 该分支来自 scan-config.yaml 的 branches[env][project.name]
        const targetBranch = (config.branches && config.branches[env] && config.branches[env][project.name]) || null;
        let commitsBehind = 0;
        try {
          // 真实 fetch 指定分支（不能用 --dry-run，dry-run 不更新 FETCH_HEAD 会导致误判"最新"）
          if (targetBranch) {
            execSync(`git fetch origin ${targetBranch}`, { cwd: repoDir, stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 });
          } else {
            execSync('git fetch', { cwd: repoDir, stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 });
          }

          // 比对本地 HEAD vs 刚 fetch 到的远程分支（FETCH_HEAD 现在是最新的）
          const localHead = execSync('git rev-parse HEAD', { cwd: repoDir, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
          const remoteRef = targetBranch ? `origin/${targetBranch}` : 'FETCH_HEAD';
          const remoteHead = execSync(`git rev-parse ${remoteRef}`, { cwd: repoDir, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();

          if (localHead !== remoteHead) {
            commitsBehind = parseInt(execSync(`git rev-list --count ${localHead}..${remoteRef}`, { cwd: repoDir, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim()) || 0;
          }
        } catch (e) {
          // fetch 失败（网络/shallow clone），回退到本地 .gitnexus 检测
          try {
            const metaFile = path.join(repoDir, '.gitnexus', 'meta.json');
            if (fs.existsSync(metaFile)) {
              const meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
              const indexedCommit = meta.lastCommit || meta.commit || '';
              const currentHead = execSync('git rev-parse HEAD', { cwd: repoDir, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
              if (indexedCommit && !currentHead.startsWith(indexedCommit.slice(0, 7))) {
                commitsBehind = parseInt(execSync(`git rev-list --count ${indexedCommit}..HEAD`, { cwd: repoDir, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim()) || 0;
              }
            }
          } catch (e2) {}
        }

        const label = `${project.name} (${env})`;
        if (commitsBehind > 0) {
          staleProjects.push({ label, commitsBehind, repoDir, project, env, targetBranch });
          console.log(`  ⚠ ${label}: ${commitsBehind} commits behind`);
        } else {
          freshProjects.push(label);
          console.log(`  ✓ ${label}: 最新`);
        }
      }
    }

    console.log(`\n=== 总结 ===`);
    if (staleProjects.length === 0) {
      console.log('  ✓ 全部最新，无需更新');
    } else {
      console.log(`  ${staleProjects.length} 个项目需要更新：`);
      for (const p of staleProjects) {
        console.log(`    ${p.label} — ${p.commitsBehind} commits`);
      }

      if (update) {
        // --update 模式：自动执行全流程
        console.log(`\n=== 开始自动更新 ===\n`);
        const scriptDir = __dirname;
        let graphNeedsRestart = false;
        let hasFailures = false;

        for (const p of staleProjects) {
          console.log(`--- 更新 ${p.label} ---`);

          // 1. git pull（必须拉检测到的 targetBranch，否则 HEAD 不前进→死循环）
          try {
            console.log('  1. git pull...');
            const pullCmd = p.targetBranch
              ? `git pull origin ${p.targetBranch}`
              : 'git pull';
            execSync(pullCmd, { cwd: p.repoDir, stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 });
            console.log('     ✓');
          } catch (e) {
            console.log(`     ✗ pull 失败: ${e.message.split('\n')[0]}`);
            hasFailures = true;
            continue; // 跳过这个项目
          }

          // 2. scan-all.js（只扫该项目）
          try {
            console.log(`  2. scan-all.js --project=${p.project.name} --branch=${p.env}...`);
            const scanResult = execSync(
              `node ${path.join(scriptDir, 'scan-all.js')} ${firstArg} --project=${p.project.name} --branch=${p.env}`,
              { cwd: scriptDir, stdio: ['pipe', 'pipe', 'pipe'], timeout: 300000, maxBuffer: 64 * 1024 * 1024 }
            ).toString();
            const newDocsMatch = scanResult.match(/(\d+) 份文档/);
            const newDocs = newDocsMatch ? newDocsMatch[1] : '?';
            console.log(`     ✓ (${newDocs} 份新文档)`);
          } catch (e) {
            console.log(`     ✗ scan 失败: ${e.message.split('\n')[0]}`);
            hasFailures = true;
            continue;
          }

          // 2.5 层次 2 增量检测
          try {
            const kbDir = path.join(outputDir, p.project.name, p.env, 'kb');
            const level2Candidates = [];
            if (fs.existsSync(kbDir)) {
              for (const mod of fs.readdirSync(kbDir, { withFileTypes: true })) {
                if (!mod.isDirectory()) continue;
                const flowDir = path.join(kbDir, mod.name, 'flows');
                if (!fs.existsSync(flowDir)) continue;
                for (const f of fs.readdirSync(flowDir)) {
                  if (!f.endsWith('.md')) continue;
                  const fp = path.join(flowDir, f);
                  const content = fs.readFileSync(fp, 'utf-8');
                  // 满足层次 2 条件：有"调用服务数"（是 flow）但没有"条件分支流程"（还是层次 1）
                  // 且调用服务数 >= 2 或有状态变更
                  const svcMatch = content.match(/调用服务数[：:]\s*(\d+)/);
                  const hasStatusChange = content.includes('触发状态变更：** 是');
                  const svcCount = svcMatch ? parseInt(svcMatch[1]) : 0;
                  if ((svcCount >= 2 || hasStatusChange) && !content.includes('## 条件分支流程')) {
                    level2Candidates.push({ file: fp, module: mod.name, name: f });
                  }
                }
              }
            }
            if (level2Candidates.length > 0) {
              if (autoLM) {
                console.log(`  2.5 层次 2: 升级 ${level2Candidates.length} 份 flow...`);
                // 执行层次 2 生成
                try {
                  const { buildPromptForMethod } = require('./flow-level2-builder');
                  for (const candidate of level2Candidates) {
                    // 从 flow 文档的 frontmatter 读取 Controller 信息
                    const { parse } = require('./frontmatter');
                    const doc = parse(fs.readFileSync(candidate.file, 'utf-8'));
                    if (!doc.frontmatter || !doc.frontmatter.sources || doc.frontmatter.sources.length === 0) continue;
                    const sourceFile = path.resolve(path.dirname(candidate.file), doc.frontmatter.sources[0]);
                    if (!fs.existsSync(sourceFile)) continue;

                    // 提取方法名（从文件名推断，kebab-to-camelCase）
                    const methodName = candidate.name.replace('.md', '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());

                    // 写 prompt 到 pending 目录（由用户或自动化工具执行 LLM 调用）
                    const promptDir = path.join(outputDir, '.scratch', 'prompts', 'pending');
                    fs.mkdirSync(promptDir, { recursive: true });
                    const promptFile = path.join(promptDir, `${p.project.name}-${candidate.module}-${candidate.name}.json`);
                    fs.writeFileSync(promptFile, JSON.stringify({
                      project: p.project.name,
                      module: candidate.module,
                      flow: candidate.name,
                      sourceFile,
                      methodName,
                      kbFile: candidate.file
                    }, null, 2));
                  }
                  console.log(`     ✓ ${level2Candidates.length} 份 prompt 已生成`);
                } catch (e) {
                  console.log(`     ✗ 层次 2 失败: ${e.message}`);
                }
              } else {
                console.log(`  2.5 层次 2: ${level2Candidates.length} 份 flow 可升级（加 --auto-lm 执行）`);
              }
            }
          } catch (e) {}

          // 3. kb-vector-index.js（增量）
          try {
            const kbDir = path.join(outputDir, p.project.name, p.env, 'kb');
            if (fs.existsSync(kbDir)) {
              console.log('  3. 向量库增量更新...');
              execSync(
                `node ${path.join(scriptDir, 'kb-vector-index.js')} ${kbDir}`,
                { cwd: scriptDir, stdio: ['pipe', 'pipe', 'pipe'], timeout: 300000, maxBuffer: 64 * 1024 * 1024 }
              );
              console.log('     ✓');
            }
          } catch (e) {
            console.log(`     ✗ 向量库失败: ${e.message.split('\n')[0]}`);
            hasFailures = true;
          }

          // 4. gitnexus analyze（增量）
          try {
            console.log('  4. 图谱增量更新...');
            if (!graphNeedsRestart) {
              // 第一次更新图谱时停掉 gitnexus 进程
              try { execSync('pkill -f "gitnexus serve" 2>/dev/null', { stdio: 'pipe' }); } catch (e) {}
              try { execSync('pkill -f "gitnexus mcp" 2>/dev/null', { stdio: 'pipe' }); } catch (e) {}
              graphNeedsRestart = true;
              // 等进程释放锁
              execSync('sleep 1');
            }
            // 注册名必须与 graph-index.js 一致：test 等非 prod 分支加环境后缀，
            // 否则 worktree 会和 prod 撞名（GitNexus 按 --name 注册，缺省则按路径，两处不一致会互相覆盖）
            const registryName = p.env && p.env !== 'prod'
              ? `${p.project.name}-${p.env}`
              : p.project.name;
            execSync(
              `gitnexus analyze "${p.repoDir}" --index-only --allow-duplicate-name --name "${registryName}"`,
              { stdio: ['pipe', 'pipe', 'pipe'], timeout: 600000 } // 大仓增量重建可能超 5 分钟，与 graph-index.js 对齐 10 分钟
            );
            console.log(`     ✓ (${registryName})`);
          } catch (e) {
            console.log(`     ✗ 图谱失败: ${e.message.split('\n')[0]}`);
            hasFailures = true;
          }
        }

        // 重启 gitnexus mcp
        if (graphNeedsRestart) {
          try {
            execSync('nohup gitnexus mcp > /dev/null 2>&1 &', { stdio: 'pipe' });
            console.log('\n  GitNexus MCP 已重启');
          } catch (e) {}
        }

        console.log(`\n=== 更新完成 ===`);
        if (hasFailures) {
          console.log('  ⚠ 部分步骤失败，详见上方 ✗ 标记');
          process.exit(1);
        }
      } else {
        console.log(`\n  更新命令：`);
        console.log(`    node scripts/incremental.js ${firstArg} --branch=${envs[0]} --update`);
      }
    }
  } else {
    // 旧模式：直接传 kbDir repoDir
    const kbDir = positionalArgs[0] || 'kb';
    const repoDir = positionalArgs[1] || process.cwd();

    console.log('=== 增量更新检查 ===\n');

  // 1. 检测人工编辑
  const edited = detectHumanEdits(kbDir);
  if (edited.length > 0) {
    console.log(`检测到 ${edited.length} 份人工编辑的文档：`);
    for (const e of edited) {
      console.log(`  ${path.relative(kbDir, e.file)}`);
      markHumanEdited(e.file);
    }
    console.log('  → 已标记 human_edited: true，后续 update 将跳过\n');
  }

  // 2. 查找过期文档
  const { stale, skipped } = findStaleDocuments(kbDir, repoDir);

  if (skipped.length > 0) {
    console.log(`跳过 ${skipped.length} 份人工编辑的文档`);
  }

  if (stale.length > 0) {
    // 3. 分类过期文档
    const level1 = [];
    const level2 = [];
    for (const s of stale) {
      const cls = classifyStaleDoc(s.kbFile);
      if (cls.needsLM) {
        level2.push(s);
      } else {
        level1.push(s);
      }
    }

    console.log(`\n发现 ${stale.length} 份过期文档：`);
    console.log(`  纯脚本可重生成: ${level1.length} 份`);
    console.log(`  需要 LM 重生成: ${level2.length} 份（层次 2 flow）`);

    // 4. 执行重生成
    if (force || level1.length > 0 || (autoLM && level2.length > 0)) {
      console.log('\n正在重生成...\n');
      const results = regenerateStaleDocuments(stale, { repoDir, kbDir, autoLM });

      if (results.regenerated.length > 0) {
        console.log(`✓ 已重生成 ${results.regenerated.length} 份：`);
        for (const r of results.regenerated) {
          console.log(`  [${r.method}] ${path.relative(kbDir, r.file)}`);
        }
      }
      if (results.skippedLM.length > 0) {
        console.log(`\n⏸ 跳过 ${results.skippedLM.length} 份（需要 LM）：`);
        for (const s of results.skippedLM) {
          console.log(`  ${path.relative(kbDir, s.file)}`);
        }
        console.log('\n  使用 --auto-lm 启用自动 LM 重生成');
        console.log('  或手动运行: node scripts/flow-level2-builder.js <controller> <method>');
      }
      if (results.errors.length > 0) {
        console.log(`\n✗ 失败 ${results.errors.length} 份：`);
        for (const e of results.errors) {
          console.log(`  ${path.relative(kbDir, e.file)}: ${e.reason}`);
        }
      }
    } else {
      console.log('\n运行以下命令重新生成：');
      console.log('  node scripts/incremental.js kb . --force          # 纯脚本部分');
      console.log('  node scripts/incremental.js kb . --force --auto-lm  # 含 LM 部分');
    }
  } else {
    console.log('\n✓ 所有文档均为最新');
  }
  } // end of旧模式 else block
}
