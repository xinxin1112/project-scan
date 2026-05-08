#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const knowledgeBaseDir = process.argv[2];
if (!knowledgeBaseDir) {
  console.error('Usage: auto-update.js <knowledge-base-dir>');
  process.exit(1);
}

const absDir = path.resolve(knowledgeBaseDir);
const scanStatePath = path.join(absDir, '.scan-state.json');
const logPath = path.join(absDir, '.update.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  fs.appendFileSync(logPath, line + '\n');
}

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 60000, ...opts }).trim();
  } catch (e) {
    return null;
  }
}

async function main() {
  if (!fs.existsSync(scanStatePath)) {
    log('ERROR: .scan-state.json not found. Skipping.');
    process.exit(0);
  }

  const state = JSON.parse(fs.readFileSync(scanStatePath, 'utf-8'));
  const staleModules = [];

  log('Starting freshness check...');

  // New format: root-level with repos + modules
  if (state.repos && state.modules) {
    for (const [modName, mod] of Object.entries(state.modules)) {
      for (const source of mod.sources || []) {
        const repo = state.repos[source.repo];
        if (!repo) continue;

        const repoPath = path.resolve(absDir, repo.path);
        if (!fs.existsSync(repoPath)) {
          log(`WARN: repo path not found: ${repoPath}`);
          continue;
        }

        const branch = repo.branch || 'main';
        run(`git -C "${repoPath}" fetch origin ${branch} --quiet`);

        const savedCommit = mod.commits && mod.commits[source.name];
        if (!savedCommit) continue;

        const subpath = source.subpath || '';
        const latestCommit = run(`git -C "${repoPath}" log -1 --format=%H origin/${branch} -- ${subpath}`);
        if (latestCommit && latestCommit !== savedCommit) {
          staleModules.push({ modName, source, repo, repoPath, savedCommit, latestCommit, branch, subpath });
          log(`STALE: ${modName}/${source.name} (${savedCommit.slice(0,7)} → ${latestCommit.slice(0,7)})`);
        }
      }
    }
  }
  // Legacy format: sources[] at module level
  else if (state.sources) {
    for (const source of state.sources) {
      if (source.type === 'backend' || source.type === 'frontend') {
        const sourcePath = path.resolve(absDir, source.path || '');
        if (!fs.existsSync(sourcePath)) {
          log(`WARN: source path not found: ${sourcePath}`);
          continue;
        }

        const branch = source.branch || source.mainBranch || 'main';
        run(`git -C "${sourcePath}" fetch origin ${branch} --quiet`);

        const savedCommit = source.commit || (source.commits && source.commits[source.name]);
        if (!savedCommit) continue;

        const latestCommit = run(`git -C "${sourcePath}" log -1 --format=%H origin/${branch}`);
        if (latestCommit && latestCommit !== savedCommit) {
          staleModules.push({ source, repoPath: sourcePath, savedCommit, latestCommit, branch, subpath: '' });
          log(`STALE: ${source.name} (${savedCommit.slice(0,7)} → ${latestCommit.slice(0,7)})`);
        }
      }
    }
  }

  if (staleModules.length === 0) {
    log('All modules up to date. No update needed.');
    process.exit(0);
  }

  log(`Found ${staleModules.length} stale module(s). Running incremental update...`);

  // Collect changed files for each stale module
  const changedFiles = [];
  for (const stale of staleModules) {
    if (stale.savedCommit && stale.latestCommit && stale.repoPath) {
      const subpathFilter = stale.subpath ? ` -- ${stale.subpath}` : '';
      const diff = run(`git -C "${stale.repoPath}" diff ${stale.savedCommit}..${stale.latestCommit} --name-only${subpathFilter}`);
      if (diff) {
        changedFiles.push(...diff.split('\n').filter(Boolean));
      }
    }
  }

  // Write changed files list
  const changedFilePath = path.join(absDir, '.changed-files.tmp');
  fs.writeFileSync(changedFilePath, changedFiles.join('\n'));

  // Update vector stores for affected modules
  const pluginRoot = path.resolve(__dirname, '..');
  const indexScript = path.join(pluginRoot, 'scripts', 'vector-index.js');

  const affectedModules = new Set(staleModules.map(s => s.modName).filter(Boolean));
  for (const modName of affectedModules) {
    const modVectorStore = path.join(absDir, modName, '.vector-store');
    if (fs.existsSync(modVectorStore) && changedFiles.length > 0) {
      log(`Updating vector index for ${modName}...`);
      const modDir = path.join(absDir, modName);
      const result = run(`node "${indexScript}" index "${modDir}" --incremental --changed="${changedFilePath}"`, { timeout: 300000 });
      if (result) log(`Vector update (${modName}): ${result.split('\n').pop()}`);
    }
  }

  // Fallback: check root-level .vector-store (legacy)
  const rootVectorStore = path.join(absDir, '.vector-store');
  if (fs.existsSync(rootVectorStore) && changedFiles.length > 0 && affectedModules.size === 0) {
    log('Updating root vector index...');
    const result = run(`node "${indexScript}" index "${absDir}" --incremental --changed="${changedFilePath}"`, { timeout: 300000 });
    if (result) log(`Vector update: ${result.split('\n').pop()}`);
  }

  // Update scan-state commits
  for (const stale of staleModules) {
    if (stale.modName && state.modules && state.modules[stale.modName]) {
      // New format
      const mod = state.modules[stale.modName];
      if (!mod.commits) mod.commits = {};
      mod.commits[stale.source.name] = stale.latestCommit;
    } else if (stale.source) {
      // Legacy format
      if (stale.source.commits) {
        stale.source.commits[stale.source.name] = stale.latestCommit;
      } else {
        stale.source.commit = stale.latestCommit;
      }
    }
  }

  state.lastScan = new Date().toISOString().split('T')[0];
  fs.writeFileSync(scanStatePath, JSON.stringify(state, null, 2));

  // Cleanup
  if (fs.existsSync(changedFilePath)) fs.unlinkSync(changedFilePath);

  log(`Update complete. ${staleModules.length} module(s) updated.`);
}

main().catch(e => {
  log(`ERROR: ${e.message}`);
  process.exit(1);
});
