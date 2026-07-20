#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { runEval } = require('./eval-runner');

function generateReport(evalResult) {
  const { summary, per_query, stale } = evalResult;
  const lines = [];

  lines.push('# Eval Report — hybrid-search quality');
  lines.push('');
  lines.push(`Date: ${new Date().toISOString().slice(0, 10)}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`| Metric | Score |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Hit Rate | ${(summary.hit_rate * 100).toFixed(1)}% |`);
  lines.push(`| MRR | ${(summary.mrr * 100).toFixed(1)}% |`);
  lines.push(`| Graph Recall | ${(summary.graph_recall * 100).toFixed(1)}% |`);
  lines.push(`| Provenance Accuracy | ${(summary.provenance_accuracy * 100).toFixed(1)}% |`);
  lines.push(`| Total Queries | ${summary.total_queries} |`);
  lines.push(`| Stale Queries | ${summary.stale_queries} |`);
  lines.push('');

  const regressions = per_query.filter(r => r.hit_rate < 1 || r.graph_recall < 1);
  if (regressions.length > 0) {
    lines.push('## Regressions');
    lines.push('');
    lines.push('| Query | Hit Rate | Graph Recall | Missing |');
    lines.push('|-------|----------|--------------|---------|');
    for (const r of regressions) {
      const missing = [];
      if (r.hit_rate < 1) missing.push('hits');
      if (r.graph_recall < 1) missing.push('graph');
      lines.push(`| ${r.query} | ${(r.hit_rate * 100).toFixed(0)}% | ${(r.graph_recall * 100).toFixed(0)}% | ${missing.join(', ')} |`);
    }
    lines.push('');
  }

  const provenanceFails = per_query.filter(r => !r.provenance.pass);
  if (provenanceFails.length > 0) {
    lines.push('## Provenance Failures');
    lines.push('');
    for (const r of provenanceFails) {
      lines.push(`### "${r.query}"`);
      lines.push('');
      for (const d of r.provenance.details.filter(x => !x.correct)) {
        lines.push(`- **${d.symbol}** expected under \`${d.from_file}\` — not found`);
      }
      lines.push('');
    }
  }

  if (stale.length > 0) {
    lines.push('## Stale Queries (expected file missing)');
    lines.push('');
    lines.push('| Query | Missing File |');
    lines.push('|-------|-------------|');
    for (const s of stale) {
      lines.push(`| ${s.query} | \`${s.missing_file}\` |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  const project = args.find(a => a.startsWith('--project='))?.split('=')[1] || 'pur-center';
  const branch = args.find(a => a.startsWith('--branch='))?.split('=')[1] || 'prod';
  const output = args.find(a => a.startsWith('--output='))?.split('=')[1];

  runEval({ project, branch })
    .then(result => {
      const report = generateReport(result);
      if (output) {
        fs.writeFileSync(output, report);
        console.log(`Report written to ${output}`);
      } else {
        console.log(report);
      }
    })
    .catch(e => { console.error(e.message); process.exit(1); });
}

module.exports = { generateReport };
