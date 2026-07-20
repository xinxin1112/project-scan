#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const lancedb = require('@lancedb/lancedb');
const { detectProvider, embedBatch } = require('./embed');
const { parse } = require('./frontmatter');

const BATCH_SIZE = 10;

async function indexKb(kbDir, vectorStoreDir, options = {}) {
  const { incremental = true } = options;
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

  // 增量模式：检测哪些文件变了
  const metaPath = path.join(vectorStoreDir, 'meta.json');
  let existingMeta = null;
  let existingFileHashes = {};
  let changedFiles = mdFiles; // 默认全量

  if (incremental && fs.existsSync(metaPath)) {
    existingMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const hashesPath = path.join(vectorStoreDir, 'file-hashes.json');
    if (fs.existsSync(hashesPath)) {
      existingFileHashes = JSON.parse(fs.readFileSync(hashesPath, 'utf-8'));
    }

    // 计算当前文件 hash，找出变化的
    const currentFileHashes = {};
    changedFiles = [];
    for (const fp of mdFiles) {
      const content = fs.readFileSync(fp, 'utf-8');
      const hash = require('crypto').createHash('md5').update(content).digest('hex').slice(0, 12);
      const relativePath = path.relative(kbDir, fp);
      currentFileHashes[relativePath] = hash;
      if (existingFileHashes[relativePath] !== hash) {
        changedFiles.push(fp);
      }
    }

    // 检测被删除的文件
    const currentRelPaths = new Set(mdFiles.map(fp => path.relative(kbDir, fp)));
    const deletedFiles = Object.keys(existingFileHashes).filter(p => !currentRelPaths.has(p));

    if (changedFiles.length === 0 && deletedFiles.length === 0) {
      console.log('\n✓ 向量库已是最新，无需更新');
      return;
    }

    console.log(`增量更新: ${changedFiles.length} 份变更, ${deletedFiles.length} 份删除`);

    // 保存当前 hash
    existingFileHashes = currentFileHashes;
  }

  // 切片（只处理变化的文件）
  const chunks = [];
  for (const fp of changedFiles) {
    const content = fs.readFileSync(fp, 'utf-8');
    const doc = parse(content);
    const relativePath = path.relative(kbDir, fp);
    const kbLayer = doc.frontmatter?.kb_layer || 'unknown';
    const summary = doc.frontmatter?.summary || '';

    const sections = splitByHeadings(doc.body);
    for (const section of sections) {
      if (section.text.trim().length < 20) continue;
      // 给代码块里的每行加上行号前缀
      // 注意：startLine 是 body-relative（去除 frontmatter 后的行号），非源文件绝对行号，这是有意为之
      const textWithLineNumbers = addLineNumbers(section.text, section.startLine);
      chunks.push({
        text: textWithLineNumbers,
        file_path: relativePath,
        heading: section.heading,
        kb_layer: kbLayer,
        summary,
        source_type: detectSourceType(relativePath),
        start_line: section.startLine
      });
    }
  }
  console.log(`切片数: ${chunks.length}`);

  if (chunks.length === 0 && !incremental) {
    console.log('无内容可索引');
    return;
  }

  // 批量 embedding
  console.log('正在生成 embedding...');
  // embedding 模型上下文有限，只取前 2000 字符生成向量；存储保留 3000 供展示
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
    source_type: chunk.source_type,
    start_line: chunk.start_line || 0
  }));

  if (tableNames.includes('kb')) {
    if (incremental && existingMeta) {
      // Schema mismatch detection: if table lacks fields present in new data, force full rebuild
      let schemaMismatch = false;
      try {
        const table = await db.openTable('kb');
        const schema = await table.schema;
        const existingFields = new Set(schema.fields.map(f => f.name));
        const newFields = Object.keys(data[0] || {});
        for (const field of newFields) {
          if (!existingFields.has(field)) {
            console.log(`  schema 不兼容（新字段 "${field}"），强制全量重建`);
            schemaMismatch = true;
            break;
          }
        }
      } catch (e) {
        schemaMismatch = true;
      }

      if (schemaMismatch) {
        await db.dropTable('kb');
        if (data.length > 0) {
          await db.createTable('kb', data);
        }
      } else {
        // 增量：删除变化文件的旧 chunk，追加新 chunk
        const table = await db.openTable('kb');
        const changedRelPaths = changedFiles.map(fp => path.relative(kbDir, fp));
        for (const relPath of changedRelPaths) {
          try {
            await table.delete(`file_path = '${relPath.replace(/'/g, "''")}'`);
          } catch (e) {
            // 文件可能是新增的，没有旧 chunk
          }
        }
        // 删除已删除文件的 chunk
        const currentRelPaths = new Set(mdFiles.map(fp => path.relative(kbDir, fp)));
        for (const oldPath of Object.keys(existingFileHashes)) {
          if (!currentRelPaths.has(oldPath)) {
            try {
              await table.delete(`file_path = '${oldPath.replace(/'/g, "''")}'`);
            } catch (e) {}
          }
        }
        // 追加新 chunk
        if (data.length > 0) {
          await table.add(data);
        }
      }
    } else {
      // 全量：删表重建
      await db.dropTable('kb');
      if (data.length > 0) {
        await db.createTable('kb', data);
      }
    }
  } else {
    if (data.length > 0) {
      await db.createTable('kb', data);
    }
  }

  // 写 meta
  let totalChunks;
  if (incremental && existingMeta) {
    try {
      const table = await db.openTable('kb');
      totalChunks = await table.countRows();
    } catch (e) {
      totalChunks = data.length;
    }
  } else {
    totalChunks = data.length;
  }

  fs.writeFileSync(metaPath, JSON.stringify({
    embedding_model: `${provider.provider}/${provider.model}`,
    dimensions: provider.dimensions,
    chunk_count: data.length > 0 ? totalChunks : (existingMeta?.chunk_count || 0),
    file_count: mdFiles.length,
    indexed_at: new Date().toISOString()
  }, null, 2));

  // 写 file hashes（增量模式用）
  const allHashes = {};
  for (const fp of mdFiles) {
    const content = fs.readFileSync(fp, 'utf-8');
    const hash = require('crypto').createHash('md5').update(content).digest('hex').slice(0, 12);
    allHashes[path.relative(kbDir, fp)] = hash;
  }
  fs.writeFileSync(path.join(vectorStoreDir, 'file-hashes.json'), JSON.stringify(allHashes, null, 2));

  console.log(`\n✓ 向量索引完成`);
  console.log(`  文档: ${mdFiles.length}`);
  console.log(`  本次更新切片: ${chunks.length}`);
  console.log(`  模型: ${provider.provider}/${provider.model}`);
  console.log(`  存储: ${vectorStoreDir}`);
  console.log(`  模式: ${incremental && existingMeta ? '增量' : '全量'}`);
}

function splitByHeadings(body) {
  const sections = [];
  const lines = body.split('\n');
  let currentHeading = '';
  let currentLines = [];
  let startLine = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^#{1,3}\s/.test(line)) {
      if (currentLines.length > 0) {
        sections.push({ heading: currentHeading, text: currentLines.join('\n'), startLine });
      }
      currentHeading = line.replace(/^#+\s*/, '');
      currentLines = [line];
      startLine = i + 1;
    } else {
      currentLines.push(line);
    }
  }
  if (currentLines.length > 0) {
    sections.push({ heading: currentHeading, text: currentLines.join('\n'), startLine });
  }

  return sections;
}

// startLine 是 body-relative 行号（frontmatter 剥离后），非源文件绝对行号
function addLineNumbers(text, startLine) {
  const lines = text.split('\n');
  let inCodeBlock = false;
  const result = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      result.push(line);
    } else if (inCodeBlock) {
      // 代码块内的行加行号
      result.push(`${startLine + i}| ${line}`);
    } else {
      result.push(line);
    }
  }
  return result.join('\n');
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
  const kbDir = args.find(a => !a.startsWith('--')) || 'kb';
  const vectorStoreDir = args.filter(a => !a.startsWith('--'))[1] || path.join(kbDir, '..', '.vector-store');
  const full = args.includes('--full');

  indexKb(kbDir, vectorStoreDir, { incremental: !full }).catch(e => {
    console.error('索引失败:', e.message);
    process.exit(1);
  });
}

module.exports = { indexKb };
