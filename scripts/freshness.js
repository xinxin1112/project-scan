#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { readState, writeState, updateFreshnessCheck } = require('./state');

const FRESHNESS_THRESHOLD_MS = 12 * 60 * 60 * 1000; // 12 小时

function checkFreshness(repoDir, options = {}) {
  const statePath = path.join(repoDir, '.scan-state.json');
  const state = readState(statePath);
  if (!state) return { fresh: true, reason: 'no state file' };

  const lastCheck = state.last_freshness_check ? new Date(state.last_freshness_check).getTime() : 0;
  const now = Date.now();
  const elapsed = now - lastCheck;

  if (elapsed < FRESHNESS_THRESHOLD_MS && !options.force) {
    return { fresh: true, reason: 'within threshold', elapsedHours: Math.round(elapsed / 3600000 * 10) / 10 };
  }

  // 超过 12h，需要检查远端
  const result = fetchAndCompare(state);

  // 只在真正执行了 fetch+compare 时才更新 freshness timer
  if (!result._skipped) {
    updateFreshnessCheck(state);
    writeState(statePath, state);
  }

  return result;
}

function fetchAndCompare(state) {
  // 获取扫描源目录（skill 下的副本）
  const scanSourceDir = findScanSource(state);
  if (!scanSourceDir) {
    return { fresh: true, reason: 'no scan source configured', _skipped: true };
  }

  // 检查是否在 feature 分支 — 使用 scanSourceDir 保持与后续 fetch/compare 一致
  const branchCheck = checkFeatureBranch(scanSourceDir);
  if (branchCheck.isFeatureBranch) {
    return { fresh: true, reason: 'feature branch - skip auto-update', branch: branchCheck.branch, _skipped: true };
  }

  // git fetch
  try {
    const mainBranch = detectMainBranch(scanSourceDir);
    execSync(`git fetch origin ${mainBranch} --quiet`, { cwd: scanSourceDir, timeout: 30000 });

    const localHead = execSync(`git rev-parse HEAD`, { cwd: scanSourceDir }).toString().trim();
    const remoteHead = execSync(`git rev-parse origin/${mainBranch}`, { cwd: scanSourceDir }).toString().trim();

    if (localHead === remoteHead) {
      return { fresh: true, reason: 'up to date', commit: localHead.slice(0, 10) };
    }

    return {
      fresh: false,
      reason: 'behind remote',
      localCommit: localHead.slice(0, 10),
      remoteCommit: remoteHead.slice(0, 10),
      mainBranch,
      scanSourceDir
    };
  } catch (e) {
    // fetch 失败 → 标记 stale 但不阻断
    return { fresh: true, reason: 'fetch failed - using existing KB', error: e.message, markStale: true };
  }
}

function checkFeatureBranch(repoDir) {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoDir }).toString().trim();
    const mainBranches = ['main', 'master', 'release_prd', 'develop'];
    const isFeatureBranch = !mainBranches.includes(branch);
    return { isFeatureBranch, branch };
  } catch (e) {
    return { isFeatureBranch: false, branch: 'unknown' };
  }
}

function detectMainBranch(dir) {
  try {
    const branches = execSync('git branch -r', { cwd: dir }).toString();
    if (branches.includes('origin/release_prd')) return 'release_prd';
    if (branches.includes('origin/main')) return 'main';
    if (branches.includes('origin/master')) return 'master';
  } catch (e) {}
  return 'main';
}

function findScanSource(state) {
  // 从 state 中找扫描源路径
  if (state.repos) {
    for (const repo of Object.values(state.repos)) {
      if (repo.path && fs.existsSync(repo.path)) return repo.path;
    }
  }
  return null;
}

function markKbStale(kbDir, reason) {
  const { parse, serialize } = require('./frontmatter');
  walkMd(kbDir, (filePath) => {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const doc = parse(content);
      if (doc.frontmatter && !doc.frontmatter.stale) {
        doc.frontmatter.stale = true;
        doc.frontmatter.stale_reason = reason;
        fs.writeFileSync(filePath, serialize(doc.frontmatter, doc.body), 'utf-8');
      }
    } catch (e) {}
  });
}

function walkMd(dir, callback) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkMd(full, callback);
    else if (entry.name.endsWith('.md')) callback(full);
  }
}

module.exports = { checkFreshness, fetchAndCompare, markKbStale, FRESHNESS_THRESHOLD_MS };

if (require.main === module) {
  const args = process.argv.slice(2);
  const repoDir = args[0] || process.cwd();
  const force = args.includes('--force');

  console.log('=== KB 新鲜度检查 ===\n');
  console.log(`仓库: ${repoDir}`);
  console.log(`阈值: 12 小时\n`);

  const result = checkFreshness(repoDir, { force });

  if (result.fresh) {
    console.log(`✓ KB 是新鲜的`);
    console.log(`  原因: ${result.reason}`);
    if (result.elapsedHours) console.log(`  距上次检查: ${result.elapsedHours} 小时`);
    if (result.commit) console.log(`  当前 commit: ${result.commit}`);
    if (result.branch) console.log(`  当前分支: ${result.branch}`);
    if (result.markStale) {
      console.log(`  ⚠ fetch 失败，KB 标记为 stale`);
      markKbStale(path.join(repoDir, 'kb'), `fetch failed: ${result.error}`);
    }
  } else {
    console.log(`✗ KB 已过期`);
    console.log(`  本地: ${result.localCommit}`);
    console.log(`  远端: ${result.remoteCommit}`);
    console.log(`  分支: ${result.mainBranch}`);
    console.log(`\n建议操作:`);
    console.log(`  cd ${result.scanSourceDir} && git pull origin ${result.mainBranch}`);
    console.log(`  然后重新运行 /project-scan update`);
  }
}
