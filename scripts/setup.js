#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { readState, writeState, createState, isV1 } = require('./state');

const KB_START_MARKER = '<!-- KB START -->';
const KB_END_MARKER = '<!-- KB END -->';

function migrateV1(repoDir) {
  const aiDir = path.join(repoDir, 'ai');
  if (!fs.existsSync(aiDir)) return { migrated: false, reason: 'no ai/ directory' };

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupDir = path.join(repoDir, `ai.v1-backup-${timestamp}`);

  fs.renameSync(aiDir, backupDir);
  console.log(`✓ 旧版 ai/ 已备份到 ${path.basename(backupDir)}`);

  // 删除旧 .scan-state.json
  const oldState = path.join(repoDir, '.scan-state.json');
  if (fs.existsSync(oldState)) {
    const state = JSON.parse(fs.readFileSync(oldState, 'utf-8'));
    if (isV1(state)) {
      fs.unlinkSync(oldState);
      console.log('✓ 旧版 .scan-state.json 已删除');
    }
  }

  // 确保 .gitignore 包含备份目录
  ensureGitignore(repoDir, 'ai.v1-backup-*');

  return { migrated: true, backupDir };
}

function ensureGitignore(repoDir, pattern) {
  const gitignorePath = path.join(repoDir, '.gitignore');
  let content = '';
  if (fs.existsSync(gitignorePath)) {
    content = fs.readFileSync(gitignorePath, 'utf-8');
  }
  if (!content.includes(pattern)) {
    const addition = `\n# project-scan v1 backup\n${pattern}\n`;
    fs.appendFileSync(gitignorePath, addition);
    console.log(`✓ .gitignore 已添加 ${pattern}`);
  }
}

function patchClaudeMd(repoDir, options = {}) {
  const claudeMdPath = path.join(repoDir, 'CLAUDE.md');
  const noInstruction = options.noInstructionInjection || false;

  let content = '';
  if (fs.existsSync(claudeMdPath)) {
    content = fs.readFileSync(claudeMdPath, 'utf-8');
  }

  // 移除旧的 KB 块（如果存在）
  const startIdx = content.indexOf(KB_START_MARKER);
  const endIdx = content.indexOf(KB_END_MARKER);
  if (startIdx !== -1 && endIdx !== -1) {
    content = content.slice(0, startIdx) + content.slice(endIdx + KB_END_MARKER.length);
    content = content.trimEnd();
  }

  // 构建新的 KB 块
  const kbBlock = buildKbBlock(noInstruction);

  // 追加到末尾
  content = content.trimEnd() + '\n\n' + kbBlock + '\n';

  fs.writeFileSync(claudeMdPath, content, 'utf-8');
  console.log(`✓ CLAUDE.md 已追加 KB 块${noInstruction ? '（无行为指令）' : ''}`);
}

function buildKbBlock(noInstruction) {
  const lines = [KB_START_MARKER, ''];
  lines.push('## Knowledge Base');
  lines.push('');
  lines.push('本项目有结构化知识库，由 project-scan v2 生成。');
  lines.push('');
  lines.push('- **全局索引：** [kb/INDEX.md](./kb/INDEX.md)');
  lines.push('- **模块入口：** [kb/pur-reconcile/CLAUDE.md](./kb/pur-reconcile/CLAUDE.md)');
  lines.push('- **外部系统：** [kb/external-systems/](./kb/external-systems/)');
  lines.push('');

  if (!noInstruction) {
    lines.push('### Consumer Agent 行为指令');
    lines.push('');
    lines.push('当你引用 `kb/` 目录下的内容回答问题时：');
    lines.push('1. 在回答末尾附加 `(KB version: <commit>, last update: <time>)`（从文档 frontmatter 的 `last_scan_commits` 中获取）');
    lines.push('2. 如果文档 frontmatter 有 `stale: true`，在回答开头加警告：「此回答基于可能过期的知识库，请对照最新代码验证」');
    lines.push('3. 优先从 flows/ 层入手理解业务流程，再按需跳转到 domain/contracts/code');
    lines.push('');
  }

  lines.push(KB_END_MARKER);
  return lines.join('\n');
}

function ensureScanState(repoDir) {
  const statePath = path.join(repoDir, '.scan-state.json');
  let state = readState(statePath);

  if (!state || isV1(state)) {
    state = createState({ devRepoPath: repoDir });
    writeState(statePath, state);
    console.log('✓ .scan-state.json v2 已创建');
  }

  // 确保 .scan-state.json 被 gitignore
  ensureGitignore(repoDir, '.scan-state.json');

  return state;
}

module.exports = { migrateV1, patchClaudeMd, ensureScanState, ensureGitignore };

if (require.main === module) {
  const args = process.argv.slice(2);
  const repoDir = args[0] || process.cwd();
  const noInstruction = args.includes('--no-instruction-injection');

  console.log(`\n=== project-scan v2 初始化 ===\n`);
  console.log(`目标仓库: ${repoDir}\n`);

  // 1. 迁移 v1
  const migration = migrateV1(repoDir);
  if (migration.migrated) {
    console.log(`  备份位置: ${migration.backupDir}`);
    console.log(`  v2 跑通后可手动删除: rm -rf ${path.basename(migration.backupDir)}\n`);
  }

  // 2. 确保 .scan-state.json
  ensureScanState(repoDir);

  // 3. 补丁 CLAUDE.md
  patchClaudeMd(repoDir, { noInstructionInjection: noInstruction });

  console.log('\n✓ 初始化完成');
}
