#!/usr/bin/env node
const path = require('path');
const lancedb = require('@lancedb/lancedb');
const { detectProvider, embedBatch } = require('./embed');

const PROJECT_SCAN_ROOT = '/Users/a6667/bilibili/project-scan';

const PROJECTS = [
  { name: 'pur-center', vectorStore: path.join(PROJECT_SCAN_ROOT, 'pur-center/.vector-store') },
  { name: 'srm-web', vectorStore: path.join(PROJECT_SCAN_ROOT, 'srm-web/.vector-store') },
  { name: 'supplier-portal', vectorStore: path.join(PROJECT_SCAN_ROOT, 'supplier-portal/.vector-store') },
];

async function searchAll(query, options = {}) {
  const { topK = 10, project = null } = options;

  process.env.EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'bge-m3';
  const provider = await detectProvider();
  const [queryVector] = await embedBatch([query], provider);

  const allResults = [];
  const targets = project ? PROJECTS.filter(p => p.name === project) : PROJECTS;

  for (const proj of targets) {
    try {
      const db = await lancedb.connect(proj.vectorStore);
      const table = await db.openTable('kb');
      const results = await table.search(queryVector).distanceType('cosine').limit(topK).toArray();

      for (const row of results) {
        allResults.push({
          score: Math.round((1 - (row._distance || 0)) * 100) / 100,
          project: proj.name,
          file: row.file_path,
          heading: row.heading || '',
          sourceType: row.source_type || '',
          text: row.text
        });
      }
    } catch (e) {
      // 向量库不存在或打不开，跳过
    }
  }

  // 按分数排序，取 topK
  allResults.sort((a, b) => b.score - a.score);
  return allResults.slice(0, topK);
}

module.exports = { searchAll, PROJECTS, PROJECT_SCAN_ROOT };

if (require.main === module) {
  const args = process.argv.slice(2);
  const projectFlag = args.find(a => a.startsWith('--project='));
  const project = projectFlag ? projectFlag.split('=')[1] : null;
  const topKFlag = args.find(a => a.startsWith('--top='));
  const topK = topKFlag ? parseInt(topKFlag.split('=')[1]) : 10;
  const query = args.filter(a => !a.startsWith('--')).join(' ');

  if (!query) {
    console.log('用法: unified-search.js <query> [--project=pur-center|srm-web|supplier-portal] [--top=10]');
    console.log('');
    console.log('示例:');
    console.log('  node unified-search.js "确认对账单报错"');
    console.log('  node unified-search.js "供应商权限" --project=supplier-portal');
    console.log('  node unified-search.js "CONTROL_PARAM_NOT_EMPTY" --top=5');
    process.exit(0);
  }

  searchAll(query, { topK, project }).then(results => {
    console.log(`\n搜索: "${query}"${project ? ` (仅 ${project})` : ' (全部项目)'}\n`);
    if (results.length === 0) {
      console.log('无结果');
      return;
    }
    for (const r of results) {
      console.log(`[${r.score}] [${r.project}] [${r.sourceType}] ${r.file} | ${r.heading}`);
      console.log(`    ${r.text.slice(0, 120)}...`);
      console.log('');
    }
  });
}
