#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const lancedb = require('@lancedb/lancedb');
const { detectProvider, embedBatch } = require('./embed');
const { parse } = require('./frontmatter');

const BATCH_SIZE = 10;

async function indexKb(kbDir, vectorStoreDir) {
  const provider = await detectProvider();
  if (!provider) {
    console.error('无可用 embedding 模型。请安装 Ollama 并拉取 bge-m3：ollama pull bge-m3');
    process.exit(1);
  }
  console.log(`Embedding 模型: ${provider.provider}/${provider.model} (${provider.dimensions}d)`);

  // 收集所有 markdown 文件
  const mdFiles = [];
  walkMd(kbDir, (filePath) => {
    if (path.basename(filePath) === 'verify-report.md') return;
    if (path.basename(filePath) === 'README.md') return;
    mdFiles.push(filePath);
  });
  console.log(`找到 ${mdFiles.length} 份文档`);

  // 切片
  const chunks = [];
  for (const fp of mdFiles) {
    const content = fs.readFileSync(fp, 'utf-8');
    const doc = parse(content);
    const relativePath = path.relative(kbDir, fp);
    const kbLayer = doc.frontmatter?.kb_layer || 'unknown';
    const summary = doc.frontmatter?.summary || '';

    // 按 ## 标题切分
    const sections = splitByHeadings(doc.body);
    for (const section of sections) {
      if (section.text.trim().length < 20) continue;
      chunks.push({
        text: section.text,
        file_path: relativePath,
        heading: section.heading,
        kb_layer: kbLayer,
        summary,
        source_type: detectSourceType(relativePath)
      });
    }
  }
  console.log(`切片数: ${chunks.length}`);

  // 批量 embedding
  console.log('正在生成 embedding...');
  const texts = chunks.map(c => c.text.slice(0, 2000));
  const vectors = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const batchVectors = await embedBatch(batch, provider);
    vectors.push(...batchVectors);
    if ((i + BATCH_SIZE) % 50 === 0 || i + BATCH_SIZE >= texts.length) {
      console.log(`  进度: ${Math.min(i + BATCH_SIZE, texts.length)}/${texts.length}`);
    }
  }

  // 写入 lancedb
  console.log('写入向量库...');
  if (!fs.existsSync(vectorStoreDir)) fs.mkdirSync(vectorStoreDir, { recursive: true });

  const db = await lancedb.connect(vectorStoreDir);
  const tableNames = await db.tableNames();

  const data = chunks.map((chunk, i) => ({
    vector: vectors[i],
    text: chunk.text.slice(0, 3000),
    file_path: chunk.file_path,
    heading: chunk.heading || '',
    kb_layer: chunk.kb_layer,
    summary: chunk.summary,
    source_type: chunk.source_type
  }));

  if (tableNames.includes('kb')) {
    await db.dropTable('kb');
  }
  await db.createTable('kb', data);

  // 写 meta
  const metaPath = path.join(vectorStoreDir, 'meta.json');
  fs.writeFileSync(metaPath, JSON.stringify({
    embedding_model: `${provider.provider}/${provider.model}`,
    dimensions: provider.dimensions,
    chunk_count: chunks.length,
    file_count: mdFiles.length,
    indexed_at: new Date().toISOString()
  }, null, 2));

  console.log(`\n✓ 向量索引完成`);
  console.log(`  文档: ${mdFiles.length}`);
  console.log(`  切片: ${chunks.length}`);
  console.log(`  模型: ${provider.provider}/${provider.model}`);
  console.log(`  存储: ${vectorStoreDir}`);
}

function splitByHeadings(body) {
  const sections = [];
  const lines = body.split('\n');
  let currentHeading = '';
  let currentLines = [];

  for (const line of lines) {
    if (/^#{1,3}\s/.test(line)) {
      if (currentLines.length > 0) {
        sections.push({ heading: currentHeading, text: currentLines.join('\n') });
      }
      currentHeading = line.replace(/^#+\s*/, '');
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }
  if (currentLines.length > 0) {
    sections.push({ heading: currentHeading, text: currentLines.join('\n') });
  }

  return sections;
}

function detectSourceType(relativePath) {
  if (relativePath.includes('external-systems')) return 'external';
  if (relativePath.includes('flows/')) return 'flow';
  if (relativePath.includes('domain/')) return 'domain';
  if (relativePath.includes('contracts/')) return 'contract';
  if (relativePath.includes('code/')) return 'code';
  if (relativePath.includes('shared/')) return 'shared';
  return 'doc';
}

function walkMd(dir, callback) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkMd(full, callback);
    else if (entry.name.endsWith('.md')) callback(full);
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const kbDir = args[0] || 'kb';
  const vectorStoreDir = args[1] || path.join(kbDir, '..', '.vector-store');

  indexKb(kbDir, vectorStoreDir).catch(e => {
    console.error('索引失败:', e.message);
    process.exit(1);
  });
}

module.exports = { indexKb };
