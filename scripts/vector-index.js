#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const lancedb = require('@lancedb/lancedb');
const { detectProvider, embedBatch } = require('./embed');

const MAX_TOKENS_ESTIMATE = 1000;
const OVERLAP_TOKENS = 200;
const SHORT_FILE_THRESHOLD = 800;
const CHARS_PER_TOKEN = 4;

const CODE_EXTENSIONS = new Set([
  '.java', '.kt', '.ts', '.tsx', '.js', '.jsx', '.vue', '.py', '.go', '.rs'
]);

const DOC_EXTENSIONS = new Set(['.md']);

const METHOD_PATTERNS = {
  java: /^\s*(public|private|protected|static|\s)*[\w<>\[\]]+\s+\w+\s*\(/,
  kotlin: /^\s*(fun|override\s+fun|private\s+fun|internal\s+fun)\s+/,
  typescript: /^\s*(export\s+)?(async\s+)?(function|const|class)\s+\w+/,
  javascript: /^\s*(export\s+)?(async\s+)?(function|const|class)\s+\w+/,
  vue: /^\s*(export\s+)?(async\s+)?(function|const|class)\s+\w+/,
};

function detectLanguage(filePath) {
  const ext = path.extname(filePath);
  const map = { '.java': 'java', '.kt': 'kotlin', '.ts': 'typescript', '.tsx': 'typescript',
    '.js': 'javascript', '.jsx': 'javascript', '.vue': 'vue', '.py': 'python', '.go': 'go', '.rs': 'rust' };
  return map[ext] || 'unknown';
}

function estimateTokens(text) {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function extractClassName(content, language) {
  if (['java', 'kotlin'].includes(language)) {
    const match = content.match(/(?:class|interface|enum)\s+(\w+)/);
    return match ? match[1] : null;
  }
  return null;
}

function splitByMethods(content, language, filePath) {
  const lines = content.split('\n');
  const pattern = METHOD_PATTERNS[language];
  if (!pattern) return [{ text: content, lineStart: 1, lineEnd: lines.length, methodName: null }];

  const chunks = [];
  let currentChunk = [];
  let currentStart = 1;
  let currentMethod = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (pattern.test(line) && currentChunk.length > 0) {
      const text = currentChunk.join('\n');
      if (text.trim()) {
        chunks.push({ text, lineStart: currentStart, lineEnd: i, methodName: currentMethod });
      }
      currentChunk = [line];
      currentStart = i + 1;
      const methodMatch = line.match(/(\w+)\s*\(/);
      currentMethod = methodMatch ? methodMatch[1] : null;
    } else {
      if (currentChunk.length === 0) {
        const methodMatch = line.match(/(\w+)\s*\(/);
        if (pattern.test(line) && methodMatch) currentMethod = methodMatch[1];
      }
      currentChunk.push(line);
    }
  }

  if (currentChunk.length > 0) {
    const text = currentChunk.join('\n');
    if (text.trim()) {
      chunks.push({ text, lineStart: currentStart, lineEnd: lines.length, methodName: currentMethod });
    }
  }

  return chunks.length > 0 ? chunks : [{ text: content, lineStart: 1, lineEnd: lines.length, methodName: null }];
}

function splitLongChunk(chunk) {
  const maxChars = MAX_TOKENS_ESTIMATE * CHARS_PER_TOKEN;
  const overlapChars = OVERLAP_TOKENS * CHARS_PER_TOKEN;

  if (chunk.text.length <= maxChars) return [chunk];

  const results = [];
  const lines = chunk.text.split('\n');
  let charCount = 0;
  let lineStart = chunk.lineStart;
  let chunkLines = [];

  for (let i = 0; i < lines.length; i++) {
    charCount += lines[i].length + 1;
    chunkLines.push(lines[i]);

    if (charCount >= maxChars) {
      results.push({
        text: chunkLines.join('\n'),
        lineStart: lineStart,
        lineEnd: lineStart + chunkLines.length - 1,
        methodName: chunk.methodName
      });
      const overlapLines = Math.ceil(overlapChars / 80);
      const backtrack = Math.min(overlapLines, chunkLines.length);
      const newStart = lineStart + chunkLines.length - backtrack;
      chunkLines = chunkLines.slice(-backtrack);
      lineStart = newStart;
      charCount = chunkLines.join('\n').length;
    }
  }

  if (chunkLines.length > 0) {
    results.push({
      text: chunkLines.join('\n'),
      lineStart: lineStart,
      lineEnd: chunk.lineEnd,
      methodName: chunk.methodName
    });
  }

  return results;
}

// PLACEHOLDER_CONTINUE

function chunkFile(filePath, content, module) {
  const language = detectLanguage(filePath);
  const className = extractClassName(content, language);
  const tokens = estimateTokens(content);

  if (tokens <= SHORT_FILE_THRESHOLD) {
    return [{
      text: content,
      file_path: filePath,
      line_start: 1,
      line_end: content.split('\n').length,
      class_name: className,
      method_name: null,
      language,
      module: module || '',
      source_type: DOC_EXTENSIONS.has(path.extname(filePath)) ? 'doc' : 'code'
    }];
  }

  const rawChunks = splitByMethods(content, language, filePath);
  const finalChunks = [];

  for (const chunk of rawChunks) {
    const splits = splitLongChunk(chunk);
    for (const s of splits) {
      finalChunks.push({
        text: s.text,
        file_path: filePath,
        line_start: s.lineStart,
        line_end: s.lineEnd,
        class_name: className,
        method_name: s.methodName,
        language,
        module: module || '',
        source_type: DOC_EXTENSIONS.has(path.extname(filePath)) ? 'doc' : 'code'
      });
    }
  }

  return finalChunks;
}

function collectFiles(dir, extensions, relativeTo) {
  const files = [];
  if (!fs.existsSync(dir)) return files;

  function walk(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', '.git', 'target', 'build', 'dist', '.vector-store'].includes(entry.name)) continue;
        walk(fullPath);
      } else if (entry.isFile() && extensions.has(path.extname(entry.name))) {
        files.push(path.relative(relativeTo, fullPath));
      }
    }
  }

  walk(dir);
  return files;
}

// PLACEHOLDER_MAIN

async function indexProject(knowledgeBaseDir, options = {}) {
  const { module, incremental, changedFiles } = options;

  const provider = await detectProvider();
  if (!provider) {
    console.error('No embedding provider found.');
    console.error('  1. Install Ollama: brew install ollama && ollama serve && ollama pull nomic-embed-text');
    console.error('  2. Set OpenAI key: export OPENAI_API_KEY=xxx');
    process.exit(1);
  }

  console.log(`Using embedding: ${provider.provider}/${provider.model} (${provider.dimensions}d)`);

  const vectorDir = path.join(knowledgeBaseDir, '.vector-store');
  const metaPath = path.join(vectorDir, 'meta.json');

  if (fs.existsSync(metaPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    if (meta.embedding_model !== `${provider.provider}/${provider.model}`) {
      console.error(`Model changed: ${meta.embedding_model} → ${provider.provider}/${provider.model}`);
      console.error('Vectors are incompatible. Running full reindex...');
    }
  }

  fs.mkdirSync(path.join(vectorDir, 'code'), { recursive: true });
  fs.mkdirSync(path.join(vectorDir, 'business'), { recursive: true });

  // Resolve source code paths from .scan-state.json
  // Strategy: check module-level first, then root-level (parent dir)
  const scanStatePath = path.join(knowledgeBaseDir, '.scan-state.json');
  const parentDir = path.dirname(knowledgeBaseDir);
  const parentScanStatePath = path.join(parentDir, '.scan-state.json');
  let sourceCodePaths = [];

  if (fs.existsSync(parentScanStatePath)) {
    // New format: root-level .scan-state.json with repos + modules
    const state = JSON.parse(fs.readFileSync(parentScanStatePath, 'utf-8'));
    const moduleName = path.basename(knowledgeBaseDir);

    if (state.repos && state.modules && state.modules[moduleName]) {
      const mod = state.modules[moduleName];
      for (const source of mod.sources || []) {
        const repo = state.repos[source.repo];
        if (repo) {
          const absPath = path.resolve(parentDir, repo.path, source.subpath);
          if (fs.existsSync(absPath)) {
            sourceCodePaths.push({ absPath, type: source.type, name: source.name });
          }
        }
      }
    }
  }

  if (sourceCodePaths.length === 0 && fs.existsSync(scanStatePath)) {
    // Legacy format: module-level .scan-state.json with sources[].path
    const state = JSON.parse(fs.readFileSync(scanStatePath, 'utf-8'));
    for (const source of state.sources || []) {
      if (source.path) {
        const absPath = path.resolve(parentDir, source.path);
        if (fs.existsSync(absPath)) {
          sourceCodePaths.push({ absPath, type: source.type, name: source.name });
        }
      }
    }
  }

  // Fallback: check code/ in knowledge base dir or parent
  if (sourceCodePaths.length === 0) {
    const codeDir = path.join(knowledgeBaseDir, 'code');
    if (fs.existsSync(codeDir)) {
      sourceCodePaths.push({ absPath: codeDir, type: 'mixed', name: 'code' });
    }
    const parentCodeDir = path.join(parentDir, 'code');
    if (!fs.existsSync(path.join(knowledgeBaseDir, 'code')) && fs.existsSync(parentCodeDir)) {
      sourceCodePaths.push({ absPath: parentCodeDir, type: 'mixed', name: 'code' });
    }
  }

  const aiDir = path.join(knowledgeBaseDir, 'ai');
  const prdDir = path.join(knowledgeBaseDir, 'prd');
  const businessDir = path.join(aiDir, 'business');

  // Collect source code files from resolved paths
  let codeFiles = [];
  for (const src of sourceCodePaths) {
    const files = collectFiles(src.absPath, CODE_EXTENSIONS, src.absPath);
    for (const f of files) {
      codeFiles.push({ relative: f, absBase: src.absPath, module: src.name });
    }
  }

  // Collect ai/ doc files (for code collection)
  let aiDocFiles = [];
  if (fs.existsSync(aiDir)) {
    const techDirs = ['backend', 'frontend'].map(d => path.join(aiDir, d)).filter(fs.existsSync);
    for (const d of techDirs) {
      const files = collectFiles(d, DOC_EXTENSIONS, knowledgeBaseDir);
      aiDocFiles.push(...files.map(f => ({ relative: f, absBase: knowledgeBaseDir, module: module || '' })));
    }
  }

  // Collect business doc files
  let businessFiles = [];
  if (fs.existsSync(businessDir)) {
    const files = collectFiles(businessDir, DOC_EXTENSIONS, knowledgeBaseDir);
    businessFiles.push(...files.map(f => ({ relative: f, absBase: knowledgeBaseDir, module: module || '' })));
  }
  if (fs.existsSync(prdDir)) {
    const files = collectFiles(prdDir, DOC_EXTENSIONS, knowledgeBaseDir);
    businessFiles.push(...files.map(f => ({ relative: f, absBase: knowledgeBaseDir, module: module || '' })));
  }

  // Filter for incremental
  let allCodeSources = [...codeFiles, ...aiDocFiles];
  let allBusinessSources = businessFiles;

  if (incremental && changedFiles) {
    const changed = new Set(changedFiles);
    allCodeSources = allCodeSources.filter(f => changed.has(f.relative));
    allBusinessSources = allBusinessSources.filter(f => changed.has(f.relative));
  }

  // Chunk all files
  const codeChunks = [];
  for (const f of allCodeSources) {
    const fullPath = path.join(f.absBase, f.relative);
    if (!fs.existsSync(fullPath)) continue;
    const content = fs.readFileSync(fullPath, 'utf-8');
    if (!content.trim()) continue;
    codeChunks.push(...chunkFile(f.relative, content, f.module));
  }

  const businessChunks = [];
  for (const f of allBusinessSources) {
    const fullPath = path.join(f.absBase, f.relative);
    if (!fs.existsSync(fullPath)) continue;
    const content = fs.readFileSync(fullPath, 'utf-8');
    if (!content.trim()) continue;
    businessChunks.push(...chunkFile(f.relative, content, f.module));
  }

  console.log(`Code chunks: ${codeChunks.length}, Business chunks: ${businessChunks.length}`);
  const totalChunks = codeChunks.length + businessChunks.length;
  if (totalChunks === 0) { console.log('No content to index.'); return; }

  // Embed and store
  const db = await lancedb.connect(vectorDir);

  if (codeChunks.length > 0) {
    await embedAndStore(db, 'code', codeChunks, provider, totalChunks);
  }
  if (businessChunks.length > 0) {
    await embedAndStore(db, 'business', businessChunks, provider, totalChunks);
  }

  // Write meta
  const meta = {
    embedding_model: `${provider.provider}/${provider.model}`,
    dimensions: provider.dimensions,
    chunk_count: totalChunks,
    created_at: new Date().toISOString().split('T')[0],
    updated_at: new Date().toISOString().split('T')[0]
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  console.log(`\nIndexing complete. ${totalChunks} chunks stored in ${vectorDir}`);
}

// PLACEHOLDER_EMBED_STORE

async function embedAndStore(db, tableName, chunks, provider, totalChunks) {
  const BATCH_SIZE = 20;
  let processed = 0;

  const records = [];

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const texts = batch.map(c => c.text);

    const vectors = await embedBatch(texts, provider);

    for (let j = 0; j < batch.length; j++) {
      records.push({
        vector: vectors[j],
        text: batch[j].text.substring(0, 2000),
        file_path: batch[j].file_path,
        line_start: batch[j].line_start,
        line_end: batch[j].line_end,
        class_name: batch[j].class_name || '',
        method_name: batch[j].method_name || '',
        language: batch[j].language,
        module: batch[j].module,
        source_type: batch[j].source_type
      });
    }

    processed += batch.length;
    const pct = Math.round((processed / totalChunks) * 100);
    process.stdout.write(`\r[${processed}/${totalChunks}] ${pct}%`);
  }

  process.stdout.write('\n');

  try { await db.dropTable(tableName); } catch (e) {}
  await db.createTable(tableName, records);
  console.log(`Table '${tableName}' created with ${records.length} records.`);
}

// CLI
if (require.main === module) {
  const [,, command, knowledgeBaseDir, ...rest] = process.argv;

  if (!command || !knowledgeBaseDir) {
    console.error('Usage: vector-index.js <index|reindex> <knowledge-base-dir> [--module=name] [--incremental] [--changed=file]');
    process.exit(1);
  }

  const options = {};
  for (const arg of rest) {
    if (arg.startsWith('--module=')) options.module = arg.split('=')[1];
    else if (arg === '--incremental') options.incremental = true;
    else if (arg.startsWith('--changed=')) {
      const changedFile = arg.split('=')[1];
      if (fs.existsSync(changedFile)) {
        options.changedFiles = fs.readFileSync(changedFile, 'utf-8').split('\n').filter(Boolean);
      }
    }
  }

  if (command === 'reindex') {
    const vectorDir = path.join(knowledgeBaseDir, '.vector-store');
    if (fs.existsSync(vectorDir)) {
      fs.rmSync(vectorDir, { recursive: true });
      console.log('Cleared existing vector store.');
    }
  }

  indexProject(path.resolve(knowledgeBaseDir), options)
    .catch(e => { console.error(e.message); process.exit(1); });
}
