#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const lancedb = require('@lancedb/lancedb');
const { detectProvider, embedBatch } = require('./embed');

const DEFAULT_TOP_K = 5;
const DEFAULT_THRESHOLD = 0.7;

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
    const match = content.match(/\[.*?\]\((.+?)\/CLAUDE\.md\)/);
    if (match) {
      const kbDir = path.resolve(startDir, match[1]);
      const vs = path.join(kbDir, '.vector-store');
      if (fs.existsSync(vs)) return vs;
    }
  }

  // Strategy 2: Check .scan-state.json
  const scanState = path.join(startDir, '.scan-state.json');
  if (fs.existsSync(scanState)) {
    const state = JSON.parse(fs.readFileSync(scanState, 'utf-8'));
    if (state.output) {
      const vs = path.join(state.output, '.vector-store');
      if (fs.existsSync(vs)) return vs;
    }
  }

  // Strategy 3: Direct .vector-store in current dir
  const direct = path.join(startDir, '.vector-store');
  if (fs.existsSync(direct)) return direct;

  // Strategy 4: Search parent directories
  const parent = path.dirname(startDir);
  if (parent !== startDir) {
    const parentVs = path.join(parent, '.vector-store');
    if (fs.existsSync(parentVs)) return parentVs;
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

  for (const arg of args) {
    if (arg.startsWith('--type=')) type = arg.split('=')[1];
    else if (arg.startsWith('--top=')) topK = parseInt(arg.split('=')[1]);
    else if (arg.startsWith('--dir=')) dir = arg.split('=')[1];
    else query += (query ? ' ' : '') + arg;
  }

  if (!query) {
    console.error('Usage: vector-search.js <query> [--type=code|business] [--top=5] [--dir=path]');
    process.exit(1);
  }

  const vectorStore = findVectorStore(dir);
  if (!vectorStore) {
    console.error('No vector store found. Run /project-scan first to generate a knowledge base with vector index.');
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
