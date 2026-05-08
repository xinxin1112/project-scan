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

  for (const source of state.sources || []) {
    if (source.type === 'backend' || source.type === 'frontend') {
      const sourcePath = source.path;
      if (!fs.existsSync(sourcePath)) {
        log(`WARN: source path not found: ${sourcePath}`);
        continue;
      }

      const branch = source.mainBranch || 'main';
      run(`git -C "${sourcePath}" fetch origin ${branch} --quiet`);

      if (source.type === 'backend' && source.modules) {
        for (const mod of source.modules) {
          const savedCommit = source.commits && source.commits[mod];
          if (!savedCommit) continue;

          const latestCommit = run(`git -C "${sourcePath}" log -1 --format=%H origin/${branch} -- ${mod}`);
          if (latestCommit && latestCommit !== savedCommit) {
            staleModules.push({ source, module: mod, savedCommit, latestCommit, branch });
            log(`STALE: backend/${mod} (${savedCommit.slice(0,7)} → ${latestCommit.slice(0,7)})`);
          }
        }
      } else if (source.type === 'frontend') {
        const savedCommit = source.commit;
        if (!savedCommit) continue;

        const paths = (source.scannedPaths || []).join(' ');
        const latestCommit = run(`git -C "${sourcePath}" log -1 --format=%H origin/${branch} -- ${paths}`);
        if (latestCommit && latestCommit !== savedCommit) {
          staleModules.push({ source, module: 'frontend', savedCommit, latestCommit, branch });
          log(`STALE: frontend (${savedCommit.slice(0,7)} → ${latestCommit.slice(0,7)})`);
        }
      }
    } else if (source.type === 'document') {
      if (!fs.existsSync(source.path)) continue;
      const stat = fs.statSync(source.path);
      const currentMtime = stat.mtime.toISOString();
      const currentSize = stat.size;
      if (source.mtime !== currentMtime || source.size !== currentSize) {
        staleModules.push({ source, module: 'document' });
        log(`STALE: document ${path.basename(source.path)} (modified)`);
      }
    }
  }

  if (staleModules.length === 0) {
    log('All modules up to date. No update needed.');
    process.exit(0);
  }

  log(`Found ${staleModules.length} stale module(s). Running incremental update...`);

  // Collect changed files for each stale backend/frontend module
  const changedFiles = [];
  for (const stale of staleModules) {
    if (stale.savedCommit && stale.latestCommit) {
      const diff = run(`git -C "${stale.source.path}" diff ${stale.savedCommit}..${stale.latestCommit} --name-only`);
      if (diff) {
        changedFiles.push(...diff.split('\n').filter(Boolean));
      }
    }
  }

  // Write changed files list
  const changedFilePath = path.join(absDir, '.changed-files.tmp');
  fs.writeFileSync(changedFilePath, changedFiles.join('\n'));

  // Update vector store if it exists
  const vectorStorePath = path.join(absDir, '.vector-store');
  if (fs.existsSync(vectorStorePath) && changedFiles.length > 0) {
    log('Updating vector index...');
    const pluginRoot = path.resolve(__dirname, '..');
    const indexScript = path.join(pluginRoot, 'scripts', 'vector-index.js');
    const result = run(`node "${indexScript}" index "${absDir}" --incremental --changed="${changedFilePath}"`, { timeout: 300000 });
    if (result) log(`Vector update: ${result.split('\n').pop()}`);
    else log('Vector update: completed (or no output)');
  }

  // Update scan-state commits
  for (const stale of staleModules) {
    if (stale.source.type === 'backend' && stale.latestCommit) {
      if (!stale.source.commits) stale.source.commits = {};
      stale.source.commits[stale.module] = stale.latestCommit;
    } else if (stale.source.type === 'frontend' && stale.latestCommit) {
      stale.source.commit = stale.latestCommit;
    } else if (stale.source.type === 'document') {
      const stat = fs.statSync(stale.source.path);
      stale.source.mtime = stat.mtime.toISOString();
      stale.source.size = stat.size;
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
