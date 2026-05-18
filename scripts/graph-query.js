#!/usr/bin/env node
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');

/**
 * GitNexus 图谱查询脚本
 * 用法：
 *   node graph-query.js impact <target> [--direction=upstream|downstream] [--depth=3]
 *   node graph-query.js context <symbol>
 *   node graph-query.js query <search>
 *   node graph-query.js detect-changes
 */

function runInRepo(sourcePath, args) {
  const cmd = `npx gitnexus ${args.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')} 2>/dev/null`;
  try {
    const stdout = execSync(cmd, {
      cwd: sourcePath,
      timeout: 60000,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024
    });
    return JSON.parse(stdout.trim());
  } catch (e) {
    const stdout = (e.stdout || '').toString().trim();
    if (stdout) {
      try { return JSON.parse(stdout); } catch (e2) {}
    }
    return { error: (e.message || '').substring(0, 200) };
  }
}

function findSourcePath(configPath, projectName) {
  const config = yaml.load(fs.readFileSync(configPath, 'utf-8'));
  const project = projectName
    ? config.projects.find(p => p.name === projectName)
    : config.projects.find(p => p.type === 'java-spring' && p.role !== 'gateway');

  if (!project) {
    console.error(`项目 "${projectName || 'default backend'}" 未找到`);
    process.exit(1);
  }

  return project.source || path.join(config.output_dir, '.sources', project.name);
}

function impact(sourcePath, target, options = {}) {
  const direction = options.direction || 'upstream';
  const depth = options.depth || 1; // 默认 depth 1，GitNexus 输出 > 64KB 时会截断
  const args = ['impact', target, '-d', direction, '--depth', String(depth)];
  if (options.includeTests) args.push('--include-tests');
  return runInRepo(sourcePath, args);
}

function context(sourcePath, symbol) {
  return runInRepo(sourcePath, ['context', symbol]);
}

function query(sourcePath, search) {
  return runInRepo(sourcePath, ['query', search]);
}

function detectChanges(sourcePath) {
  return runInRepo(sourcePath, ['detect-changes']);
}

function formatImpactResult(result) {
  if (result.error) {
    console.log(`❌ ${result.error}`);
    return;
  }

  if (result.status === 'ambiguous') {
    console.log(`⚠ ${result.message}`);
    if (result.candidates) {
      console.log('\n可能的匹配：');
      for (const c of result.candidates.slice(0, 10)) {
        console.log(`  - ${c.name} (${c.kind}) — ${c.filePath}:${c.line}`);
      }
    }
    return;
  }

  console.log(`\n目标: ${result.target?.name || result.target?.id}`);
  console.log(`方向: ${result.direction}`);
  console.log(`风险: ${result.risk}`);
  console.log(`影响数: ${result.impactedCount}`);

  if (result.summary) {
    console.log(`  直接影响: ${result.summary.direct}`);
    console.log(`  受影响流程: ${result.summary.processes_affected}`);
    console.log(`  受影响模块: ${result.summary.modules_affected}`);
  }

  if (result.affected_processes && result.affected_processes.length > 0) {
    console.log('\n受影响的执行流程：');
    for (const p of result.affected_processes.slice(0, 10)) {
      console.log(`  - ${p.name} (${p.filePath}) — 影响步骤 ${p.earliest_broken_step}`);
    }
  }

  if (result.affected_modules && result.affected_modules.length > 0) {
    console.log('\n受影响的模块：');
    for (const m of result.affected_modules) {
      const name = typeof m === 'string' ? m : (m.name || m.module || JSON.stringify(m));
      console.log(`  - ${name}`);
    }
  }
}

// CLI
const args = process.argv.slice(2);
const command = args[0];

// 查找 scan-config.yaml：环境变量 > 参数 > 当前目录 > 默认位置
const configArgIdx = args.findIndex(a => a.startsWith('--config='));
const configPath = process.env.SCAN_CONFIG
  || (configArgIdx >= 0 ? args[configArgIdx].split('=')[1] : null)
  || (fs.existsSync(path.join(process.cwd(), 'scan-config.yaml')) ? path.join(process.cwd(), 'scan-config.yaml') : null)
  || '/Users/a6667/bilibili/project-scan/scan-config.yaml';

const projectName = args.find(a => a.startsWith('--project='))?.split('=')[1];

if (!command) {
  console.log('用法:');
  console.log('  node graph-query.js impact <target> [--direction=upstream|downstream] [--depth=3] [--project=X]');
  console.log('  node graph-query.js context <symbol> [--project=X]');
  console.log('  node graph-query.js query <search> [--project=X]');
  console.log('  node graph-query.js detect-changes [--project=X]');
  process.exit(0);
}

const sourcePath = findSourcePath(configPath, projectName);

switch (command) {
  case 'impact': {
    const target = args[1];
    if (!target) { console.error('需要 target 参数'); process.exit(1); }
    const direction = args.find(a => a.startsWith('--direction='))?.split('=')[1];
    const depth = args.find(a => a.startsWith('--depth='))?.split('=')[1];
    const result = impact(sourcePath, target, { direction, depth: depth ? parseInt(depth) : undefined });
    formatImpactResult(result);
    break;
  }
  case 'context': {
    const symbol = args[1];
    if (!symbol) { console.error('需要 symbol 参数'); process.exit(1); }
    const result = context(sourcePath, symbol);
    console.log(JSON.stringify(result, null, 2));
    break;
  }
  case 'query': {
    const search = args[1];
    if (!search) { console.error('需要 search 参数'); process.exit(1); }
    const result = query(sourcePath, search);
    console.log(JSON.stringify(result, null, 2));
    break;
  }
  case 'detect-changes': {
    const result = detectChanges(sourcePath);
    console.log(JSON.stringify(result, null, 2));
    break;
  }
  default:
    console.error(`未知命令: ${command}`);
    process.exit(1);
}
