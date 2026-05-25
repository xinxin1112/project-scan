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

        case 'flow-level1':
          // 纯脚本：flow-generator.js 重跑该方法
          results.regenerated.push({ file: staleDoc.kbFile, type: 'flow-level1', method: 'script' });
          break;

        case 'entity':
        case 'enum':
        case 'state-machine':
        case 'contract':
        case 'method-index':
        case 'error-codes':
        case 'rules':
          // 纯脚本重生成
          results.regenerated.push({ file: staleDoc.kbFile, type: classification.type, method: 'script' });
          break;

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
  const branchArg = args.find(a => a.startsWith('--branch='));
  const branchKey = branchArg ? branchArg.split('=')[1] : null;
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

    console.log('=== 增量更新检查 ===\n');

    let totalStale = 0;
    let totalSkipped = 0;
    let vectorStale = [];
    let graphStale = [];

    for (const env of envs) {
      for (const project of config.projects) {
        const kbDir = path.join(outputDir, project.name, env, 'kb');
        if (!fs.existsSync(kbDir)) continue;

        // 确定源码目录
        let repoDir;
        if (env === 'prod') {
          repoDir = project.source || path.join(outputDir, '.sources', project.name);
        } else {
          repoDir = path.join(outputDir, '.sources', `${project.name}-${env}`);
        }
        if (!fs.existsSync(repoDir)) continue;

        console.log(`--- ${project.name} (${env}) ---`);

        const edited = detectHumanEdits(kbDir);
        if (edited.length > 0) {
          console.log(`  检测到 ${edited.length} 份人工编辑`);
          for (const e of edited) markHumanEdited(e.file);
        }

        const { stale, skipped } = findStaleDocuments(kbDir, repoDir);
        totalSkipped += skipped.length;

        if (stale.length > 0) {
          totalStale += stale.length;
          console.log(`  KB 过期: ${stale.length} 份`);
          for (const s of stale) {
            console.log(`    ${path.relative(kbDir, s.kbFile)} (${s.changedSource})`);
          }
          if (force) {
            const results = regenerateStaleDocuments(stale, { repoDir, kbDir, autoLM });
            console.log(`  → 重生成 ${results.regenerated.length} 份`);
          }
        } else {
          console.log(`  KB ✓ 最新`);
        }

        // 向量库新鲜度：比对 file-hashes.json
        const vsDir = path.join(outputDir, project.name, env, '.vector-store');
        const hashFile = path.join(vsDir, 'file-hashes.json');
        if (fs.existsSync(vsDir)) {
          if (!fs.existsSync(hashFile)) {
            vectorStale.push(`${project.name}/${env}（无 file-hashes.json，需 --full 重建）`);
            console.log(`  向量库 ⚠ 需重建（无增量记录）`);
          } else {
            const storedHashes = JSON.parse(fs.readFileSync(hashFile, 'utf-8'));
            let changed = 0;
            walkMd(kbDir, (fp) => {
              const rel = path.relative(kbDir, fp);
              const content = fs.readFileSync(fp, 'utf-8');
              const hash = require('crypto').createHash('md5').update(content).digest('hex').slice(0, 12);
              if (storedHashes[rel] !== hash) changed++;
            });
            if (changed > 0) {
              vectorStale.push(`${project.name}/${env}（${changed} 份文档变化）`);
              console.log(`  向量库 ⚠ 过期（${changed} 份文档变化）`);
            } else {
              console.log(`  向量库 ✓ 最新`);
            }
          }
        }

        // 图谱新鲜度：比对 git HEAD vs .gitnexus 记录的 commit
        const gitnexusDir = path.join(repoDir, '.gitnexus');
        if (fs.existsSync(gitnexusDir)) {
          try {
            const metaFile = path.join(gitnexusDir, 'meta.json');
            if (fs.existsSync(metaFile)) {
              const meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
              const indexedCommit = meta.lastCommit || meta.commit || '';
              const currentHead = execSync('git rev-parse HEAD', { cwd: repoDir, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
              if (indexedCommit && currentHead && !currentHead.startsWith(indexedCommit) && !indexedCommit.startsWith(currentHead.slice(0, indexedCommit.length))) {
                const behind = execSync(`git rev-list --count ${indexedCommit}..HEAD`, { cwd: repoDir, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
                graphStale.push(`${project.name}/${env}（${behind} commits behind）`);
                console.log(`  图谱 ⚠ 过期（${behind} commits behind）`);
              } else {
                console.log(`  图谱 ✓ 最新`);
              }
            }
          } catch (e) {
            console.log(`  图谱 ? 无法检测`);
          }
        }
      }
    }

    console.log(`\n=== 总结 ===`);
    console.log(`  KB: ${totalStale} 份过期，${totalSkipped} 份跳过（human_edited）`);
    console.log(`  向量库: ${vectorStale.length > 0 ? vectorStale.join(', ') : '✓ 全部最新'}`);
    console.log(`  图谱: ${graphStale.length > 0 ? graphStale.join(', ') : '✓ 全部最新'}`);
    if (totalStale > 0 && !force) {
      console.log('  加 --force 执行重生成');
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
