#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { hybridSearch } = require('../scripts/hybrid-search');

// --- Pure scoring functions (exported for testing) ---

function computeHitRate(expectedHits, actualHits) {
  if (!expectedHits || expectedHits.length === 0) return 1;
  const actualPaths = actualHits.map(h => h.file_path);
  const found = expectedHits.filter(e => actualPaths.includes(e));
  return found.length / expectedHits.length;
}

function computeMRR(expectedHits, actualHits) {
  if (!expectedHits || expectedHits.length === 0) return 1;
  const actualPaths = actualHits.map(h => h.file_path);
  let sumRR = 0;
  for (const expected of expectedHits) {
    const idx = actualPaths.indexOf(expected);
    if (idx >= 0) sumRR += 1 / (idx + 1);
  }
  return sumRR / expectedHits.length;
}

function computeGraphRecall(expectedSymbols, graphContext) {
  if (!expectedSymbols || expectedSymbols.length === 0) return 1;
  const allSymbols = new Set();
  for (const ctx of graphContext) {
    for (const exp of ctx.expansions || []) {
      allSymbols.add(exp.symbol);
    }
  }
  const found = expectedSymbols.filter(e => allSymbols.has(e.symbol));
  return found.length / expectedSymbols.length;
}

function checkProvenance(expectedSymbols, graphContext) {
  if (!expectedSymbols || expectedSymbols.length === 0) return { pass: true, details: [] };
  const details = [];
  for (const expected of expectedSymbols) {
    if (!expected.from_file) continue;
    let found = false;
    for (const ctx of graphContext) {
      if (ctx.from_file !== expected.from_file) continue;
      for (const exp of ctx.expansions || []) {
        if (exp.symbol === expected.symbol) { found = true; break; }
      }
      if (found) break;
    }
    details.push({ symbol: expected.symbol, from_file: expected.from_file, correct: found });
  }
  const pass = details.length === 0 || details.every(d => d.correct);
  return { pass, details };
}

function detectStaleQueries(queries, kbDir) {
  const stale = [];
  for (const q of queries) {
    for (const expectedPath of (q.expected_hits || [])) {
      const full = path.join(kbDir, expectedPath);
      if (!fs.existsSync(full)) {
        stale.push({ query: q.query, missing_file: expectedPath });
      }
    }
  }
  return stale;
}

// --- Runner ---

async function runEval(options = {}) {
  const {
    queriesPath = path.join(__dirname, 'queries.yaml'),
    project = 'pur-center',
    branch = 'prod',
    topK = 5,
    kbDir
  } = options;

  const raw = fs.readFileSync(queriesPath, 'utf-8');
  const queries = yaml.load(raw);

  const resolvedKbDir = kbDir || path.join('/Users/a6667/bilibili/project-scan', project, branch, 'kb');

  const staleQueries = detectStaleQueries(queries, resolvedKbDir);
  const results = [];

  for (const q of queries) {
    const result = await hybridSearch(q.query, { project, branch, topK, graph: true });

    const hitRate = computeHitRate(q.expected_hits, result.hits);
    const mrr = computeMRR(q.expected_hits, result.hits);
    const graphRecall = computeGraphRecall(q.expected_graph_symbols, result.graph_context);

    let provenance = { pass: true, details: [] };
    if (q.verify_provenance) {
      provenance = checkProvenance(q.expected_graph_symbols, result.graph_context);
    }

    results.push({
      query: q.query,
      hit_rate: hitRate,
      mrr,
      graph_recall: graphRecall,
      provenance,
      actual_hits: result.hits.map(h => h.file_path),
      actual_graph_symbols: result.graph_context.flatMap(g =>
        (g.expansions || []).map(e => e.symbol)
      )
    });
  }

  const totalHitRate = results.reduce((s, r) => s + r.hit_rate, 0) / results.length;
  const totalMRR = results.reduce((s, r) => s + r.mrr, 0) / results.length;
  const totalGraphRecall = results.reduce((s, r) => s + r.graph_recall, 0) / results.length;
  const provenanceResults = results.filter(r => r.provenance.details.length > 0);
  const provenanceAccuracy = provenanceResults.length > 0
    ? provenanceResults.filter(r => r.provenance.pass).length / provenanceResults.length
    : 1;

  return {
    summary: {
      hit_rate: Math.round(totalHitRate * 1000) / 1000,
      mrr: Math.round(totalMRR * 1000) / 1000,
      graph_recall: Math.round(totalGraphRecall * 1000) / 1000,
      provenance_accuracy: Math.round(provenanceAccuracy * 1000) / 1000,
      total_queries: queries.length,
      stale_queries: staleQueries.length
    },
    per_query: results,
    stale: staleQueries
  };
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  const project = args.find(a => a.startsWith('--project='))?.split('=')[1] || 'pur-center';
  const branch = args.find(a => a.startsWith('--branch='))?.split('=')[1] || 'prod';
  const topK = parseInt(args.find(a => a.startsWith('--top='))?.split('=')[1] || '5');
  const queriesPath = args.find(a => a.startsWith('--queries='))?.split('=')[1];

  const opts = { project, branch, topK };
  if (queriesPath) opts.queriesPath = queriesPath;

  runEval(opts)
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(e => { console.error(e.message); process.exit(1); });
}

module.exports = { runEval, computeHitRate, computeMRR, computeGraphRecall, checkProvenance, detectStaleQueries };
