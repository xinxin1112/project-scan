#!/usr/bin/env node
/**
 * hybrid-search.js — 融合检索主入口
 *
 * 流程：向量召回 → 符号解析 → 图谱扩展 → 合并输出
 * 复用 vector-search.search()，叠加 GitNexus 图谱上下文
 */
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');

const { search, findVectorStore } = require('./vector-search');
const { resolve } = require('./doc-to-symbol-resolver');
const { expand } = require('./graph-expander');
const { merge } = require('./result-merger');

function findSourcePath(projectName) {
  const configCandidates = [
    process.env.SCAN_CONFIG,
    path.join(process.cwd(), 'scan-config.yaml'),
    '/Users/a6667/bilibili/project-scan/scan-config.yaml'
  ].filter(Boolean);

  for (const configPath of configCandidates) {
    if (!fs.existsSync(configPath)) continue;
    const config = yaml.load(fs.readFileSync(configPath, 'utf-8'));
    const project = projectName
      ? config.projects.find(p => p.name === projectName)
      : config.projects.find(p => p.type === 'java-spring' && p.role !== 'gateway');
    if (project) {
      return project.source || path.join(config.output_dir, '.sources', project.name);
    }
  }
  return null;
}

function findKbDir(vectorStoreDir) {
  // KB 目录通常是 vector-store 的同级 kb/ 或上级
  const parent = path.dirname(vectorStoreDir);
  const kbDir = path.join(parent, 'kb');
  if (fs.existsSync(kbDir)) return kbDir;
  // fallback: vector-store 上两级（<project>/<branch>/kb）
  return parent;
}

async function hybridSearch(query, options = {}) {
  const { project, branch = 'prod', topK = 5, graph = true } = options;

  // 1. 找向量库
  let dir = process.cwd();
  if (project) {
    const outputDir = '/Users/a6667/bilibili/project-scan';
    dir = path.join(outputDir, project, branch);
  }

  const vectorStore = findVectorStore(dir);
  if (!vectorStore) {
    throw new Error(`No vector store found. Run /project-scan first.`);
  }

  // 2. 向量召回
  const rawHits = await search(vectorStore, query, { topK });

  // 过滤 vector-search 透传的恒 null 死字段（class_name/method_name/module/line_start/line_end）
  const hits = rawHits.map(hit => {
    const clean = { score: hit.score, file_path: hit.file_path };
    if (hit.heading) clean.heading = hit.heading;
    if (hit.snippet) clean.snippet = hit.snippet;
    if (hit.source_type) clean.source_type = hit.source_type;
    if (hit.collection) clean.collection = hit.collection;
    return clean;
  });

  if (!graph || hits.length === 0) {
    return merge(hits, []);
  }

  // 3. 符号解析 + 图谱扩展
  const kbDir = findKbDir(vectorStore);
  const sourcePath = findSourcePath(project);
  const expansionsMap = [];

  for (const hit of hits) {
    const resolved = resolve(hit.file_path, kbDir);
    if (!resolved || resolved.symbols.length === 0) continue;

    for (const symbol of resolved.symbols) {
      const expansion = expand(symbol, { mode: 'context', sourcePath });
      if (expansion.symbol) {
        expansionsMap.push({
          fromHit: { file_path: hit.file_path, symbol },
          expansion
        });
      }
    }
  }

  // 4. 合并输出
  return merge(hits, expansionsMap);
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  let query = '';
  let project = null;
  let branch = 'prod';
  let topK = 5;
  let graph = true;

  for (const arg of args) {
    if (arg.startsWith('--project=')) project = arg.split('=')[1];
    else if (arg.startsWith('--branch=')) branch = arg.split('=')[1];
    else if (arg.startsWith('--top=')) topK = parseInt(arg.split('=')[1]);
    else if (arg === '--no-graph') graph = false;
    else query += (query ? ' ' : '') + arg;
  }

  if (!query) {
    console.error('Usage: hybrid-search.js <query> [--project=X] [--branch=prod] [--top=5] [--no-graph]');
    process.exit(1);
  }

  hybridSearch(query, { project, branch, topK, graph })
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(e => { console.error(e.message); process.exit(1); });
}

module.exports = { hybridSearch };
