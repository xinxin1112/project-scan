#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const lancedb = require('@lancedb/lancedb');
const { detectProvider, embedBatch } = require('./embed');

const DEFAULT_TOP_K = 5;
// bge-m3 cosine distance typically 0.35-0.60 for relevant results
// score = 1 - distance, so relevant scores are 0.40-0.65
const DEFAULT_THRESHOLD = 0.35;

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
  else if (tables.includes('kb')) searchTables = ['kb'];
  else searchTables = tables.filter(t => ['code', 'business', 'kb'].includes(t));

  if (searchTables.length === 0 && tables.length > 0) {
    // 兜底：搜所有表
    searchTables = tables;
  }

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
  const topResults = allResults.slice(0, topK);

  // 对结果附加 git blame 信息（作者）
  if (topResults.length > 0) {
    // vectorStoreDir = <output_dir>/<project>/<env>/.vector-store
    // kbDir = <output_dir>/<project>/<env>/kb
    const envDir = path.dirname(vectorStoreDir); // <output_dir>/<project>/<env>/
    enrichWithBlame(topResults, path.join(envDir, 'kb'));
  }

  return topResults;
}

const { execSync } = require('child_process');
const { parse } = require('./frontmatter');

function enrichWithBlame(results, kbDir) {
  for (const result of results) {
    try {
      // 读 KB 文档的 frontmatter 获取源码路径
      const kbFilePath = path.join(kbDir, result.file_path);
      if (!fs.existsSync(kbFilePath)) continue;

      const content = fs.readFileSync(kbFilePath, 'utf-8');
      const doc = parse(content);
      if (!doc.frontmatter || !doc.frontmatter.sources || doc.frontmatter.sources.length === 0) continue;

      // 解析源码绝对路径：sources 是相对于 KB 文件的
      const sourceRelPath = doc.frontmatter.sources[0];
      let sourceAbsPath = path.resolve(path.dirname(kbFilePath), sourceRelPath);

      // 如果解析后不存在，尝试从 .sources/ 目录找
      if (!fs.existsSync(sourceAbsPath)) {
        // 从路径中提取 project-test/app/... 部分
        const sourcesMatch = sourceRelPath.match(/([^/]+-test|[^/]+)\/app\/.+/);
        if (sourcesMatch) {
          const outputDir = path.resolve(kbDir, '..', '..', '..');
          sourceAbsPath = path.join(outputDir, '.sources', sourcesMatch[0]);
        }
        if (!fs.existsSync(sourceAbsPath)) continue;
      }

      // 从 snippet 提取行号（支持 markdown 格式如 **行号：** 103 或 行号：103）
      const lineMatch = result.snippet.match(/\*{0,2}行号[：:]\*{0,2}\s*(\d+)/);
      const lineNum = lineMatch ? parseInt(lineMatch[1]) : null;
      if (!lineNum) continue;

      // 找到源码所在的 git 仓库
      const sourceDir = findGitRoot(sourceAbsPath);
      if (!sourceDir) continue;

      const relToRepo = path.relative(sourceDir, sourceAbsPath);

      // git blame 指定行
      const blameOutput = execSync(
        `git blame -L ${lineNum},${lineNum} --porcelain -- "${relToRepo}"`,
        { cwd: sourceDir, timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
      ).toString();

      // 解析 blame 输出获取作者
      const authorMatch = blameOutput.match(/^author (.+)$/m);
      if (authorMatch) {
        result.author = authorMatch[1].trim();
      }
    } catch (e) {
      // blame 失败不影响结果，但输出调试信息到 stderr
      if (process.env.DEBUG_BLAME) {
        console.error(`  [blame] ${result.file_path}: ${e.message}`);
      }
    }
  }
}

function findGitRoot(filePath) {
  let dir = path.dirname(filePath);
  while (dir !== path.parse(dir).root) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return null;
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
