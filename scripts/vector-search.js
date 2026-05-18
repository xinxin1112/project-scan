#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const lancedb = require('@lancedb/lancedb');
const { detectProvider, embedBatch } = require('./embed');

const DEFAULT_TOP_K = 5;
// bge-m3 cosine similarity scores are typically in 0.55-0.75 range for relevant results
// Lower threshold than nomic-embed-text (which scored 0.7+)
const DEFAULT_THRESHOLD = 0.55;

async function search(vectorStoreDir, query, options = {}) {
  const { topK = DEFAULT_TOP_K, threshold = DEFAULT_THRESHOLD, type } = options;

  const metaPath = path.join(vectorStoreDir, 'meta.json');
  if (!fs.existsSync(metaPath)) {
    throw new Error('No vector index found. Run /project-scan to generate one.');
  }

  const provider = await detectProvider();
  if (!provider) {
    throw new Error('No embedding provider available. Install Ollama or set OPENAI_API_KEY.');
  }

  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  if (meta.embedding_model !== `${provider.provider}/${provider.model}`) {
    console.error(`Warning: index was built with ${meta.embedding_model}, current provider is ${provider.provider}/${provider.model}`);
    console.error('Results may be inaccurate. Run /project-scan reindex to rebuild.');
  }

  const [queryVector] = await embedBatch([query], provider);

  const db = await lancedb.connect(vectorStoreDir);
  const tables = await db.tableNames();

  let searchTables = [];
  if (type === 'code' && tables.includes('code')) searchTables = ['code'];
  else if (type === 'business' && tables.includes('business')) searchTables = ['business'];
  else searchTables = tables.filter(t => ['code', 'business'].includes(t));

  const allResults = [];

  for (const tableName of searchTables) {
    const table = await db.openTable(tableName);
    const results = await table.search(queryVector).distanceType('cosine').limit(topK).toArray();

    for (const row of results) {
      const score = Math.round((1 - (row._distance || 0)) * 100) / 100;
      if (score >= threshold) {
        allResults.push({
          score: Math.round(score * 100) / 100,
          file_path: row.file_path,
          line_start: row.line_start,
          line_end: row.line_end,
          class_name: row.class_name || null,
          method_name: row.method_name || null,
          module: row.module || null,
          source_type: row.source_type,
          collection: tableName,
          snippet: row.text ? row.text.substring(0, 500) : ''
        });
      }
    }
  }

  allResults.sort((a, b) => b.score - a.score);
  return allResults.slice(0, topK);
}

function findVectorStore(startDir) {
  // Strategy 1: Check CLAUDE.md for External Knowledge Base pointer
  const claudeMd = path.join(startDir, 'CLAUDE.md');
  if (fs.existsSync(claudeMd)) {
    const content = fs.readFileSync(claudeMd, 'utf-8');
    const pointerMatch = content.match(/<!-- MANUAL ADDITIONS START -->[\s\S]*?\[.*?\]\((.+?)\/CLAUDE\.md\)[\s\S]*?<!-- MANUAL ADDITIONS END -->/);
    if (pointerMatch) {
      const kbDir = path.resolve(startDir, pointerMatch[1]);
      const vs = path.join(kbDir, '.vector-store');
      if (fs.existsSync(vs)) return vs;
    }
  }

  // Strategy 2: Check .scan-state.json (root-level with modules)
  const scanState = path.join(startDir, '.scan-state.json');
  if (fs.existsSync(scanState)) {
    const state = JSON.parse(fs.readFileSync(scanState, 'utf-8'));
    if (state.modules) {
      for (const modName of Object.keys(state.modules)) {
        const vs = path.join(startDir, modName, '.vector-store');
        if (fs.existsSync(vs)) return vs;
      }
    }
  }

  // Strategy 3: Direct .vector-store in current dir
  const direct = path.join(startDir, '.vector-store');
  if (fs.existsSync(direct)) return direct;

  // Strategy 4: Walk up to find .scan-state.json or .vector-store
  let current = path.dirname(startDir);
  const root = path.parse(current).root;
  for (let depth = 0; depth < 6 && current !== root; depth++) {
    const vs = path.join(current, '.vector-store');
    if (fs.existsSync(vs)) return vs;

    const parentScan = path.join(current, '.scan-state.json');
    if (fs.existsSync(parentScan)) {
      const state = JSON.parse(fs.readFileSync(parentScan, 'utf-8'));
      if (state.modules) {
        for (const modName of Object.keys(state.modules)) {
          const modVs = path.join(current, modName, '.vector-store');
          if (fs.existsSync(modVs)) return modVs;
        }
      }
    }
    current = path.dirname(current);
  }

  return null;
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  let query = '';
  let type = null;
  let topK = DEFAULT_TOP_K;
  let dir = process.cwd();
  let branch = 'prod';
  let project = null;

  for (const arg of args) {
    if (arg.startsWith('--type=')) type = arg.split('=')[1];
    else if (arg.startsWith('--top=')) topK = parseInt(arg.split('=')[1]);
    else if (arg.startsWith('--dir=')) dir = arg.split('=')[1];
    else if (arg.startsWith('--branch=')) branch = arg.split('=')[1];
    else if (arg.startsWith('--project=')) project = arg.split('=')[1];
    else query += (query ? ' ' : '') + arg;
  }

  if (!query) {
    console.error('Usage: vector-search.js <query> [--project=pur-center] [--branch=prod|test] [--type=code|business] [--top=5] [--dir=path]');
    process.exit(1);
  }

  // 如果指定了 project，自动拼向量库路径
  if (project && !args.some(a => a.startsWith('--dir='))) {
    const outputDir = '/Users/a6667/bilibili/project-scan';
    dir = path.join(outputDir, project, branch);
  }

  const vectorStore = findVectorStore(dir);
  if (!vectorStore) {
    console.error(`No vector store found at ${dir}/.vector-store/. Run /project-scan first.`);
    process.exit(1);
  }

  search(vectorStore, query, { topK, type })
    .then(results => {
      if (results.length === 0) {
        console.log('No results found above threshold.');
      } else {
        console.log(JSON.stringify(results, null, 2));
      }
    })
    .catch(e => { console.error(e.message); process.exit(1); });
}

module.exports = { search, findVectorStore };
