#!/usr/bin/env node
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');

/**
 * GitNexus 图谱索引脚本
 * 用法：node graph-index.js <config-path> [--project=X]
 */

function loadConfig(configPath) {
  return yaml.load(fs.readFileSync(configPath, 'utf-8'));
}

function indexProject(projectName, sourcePath) {
  console.log(`  [${projectName}] 索引中...`);
  const start = Date.now();

  try {
    const result = execSync(`npx gitnexus analyze "${sourcePath}"`, {
      timeout: 600000, // 10 分钟超时
      stdio: ['pipe', 'pipe', 'pipe']
    }).toString();

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    // 解析输出中的统计信息
    const statsMatch = result.match(/(\d[\d,]+)\s*nodes.*?(\d[\d,]+)\s*edges.*?(\d[\d,]+)\s*clusters.*?(\d[\d,]+)\s*flows/);
    if (statsMatch) {
      console.log(`  [${projectName}] ✓ (${elapsed}s) — ${statsMatch[1]} nodes, ${statsMatch[2]} edges, ${statsMatch[3]} clusters, ${statsMatch[4]} flows`);
    } else {
      console.log(`  [${projectName}] ✓ (${elapsed}s)`);
    }
    return true;
  } catch (e) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.error(`  [${projectName}] ✗ (${elapsed}s) — ${e.message}`);
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const configPath = args.find(a => !a.startsWith('--'));
  const projectFilter = args.find(a => a.startsWith('--project='))?.split('=')[1];

  if (!configPath) {
    console.error('用法: node graph-index.js <scan-config.yaml> [--project=X]');
    process.exit(1);
  }

  const config = loadConfig(configPath);
  const outputDir = config.output_dir;

  console.log('=== GitNexus 图谱索引 ===\n');

  const projects = projectFilter
    ? config.projects.filter(p => p.name === projectFilter)
    : config.projects;

  const startTime = Date.now();
  let success = 0;
  let failed = 0;

  for (const project of projects) {
    const sourcePath = project.source || path.join(outputDir, '.sources', project.name);
    if (!fs.existsSync(sourcePath)) {
      console.log(`  [${project.name}] ⚠ 源码路径不存在，跳过`);
      failed++;
      continue;
    }

    const ok = indexProject(project.name, sourcePath);
    if (ok) success++;
    else failed++;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n=== 完成（${elapsed}s）— ${success} 成功, ${failed} 失败 ===`);

  // 在每个项目的源码目录生成 .mcp.json（如果不存在）
  if (success > 0) {
    for (const project of projects) {
      const sourcePath = project.source || path.join(outputDir, '.sources', project.name);
      const mcpPath = path.join(sourcePath, '.mcp.json');
      if (!fs.existsSync(mcpPath)) {
        const mcpConfig = {
          mcpServers: {
            gitnexus: {
              command: 'gitnexus',
              args: ['mcp']
            }
          }
        };
        fs.writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2) + '\n', 'utf-8');
        console.log(`  [${project.name}] .mcp.json 已生成（GitNexus MCP 自动加载）`);
      }
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
