#!/usr/bin/env node
const http = require('http');
const https = require('https');

// Preferred embedding models, ordered by priority
// bge-m3: Multilingual (100+ langs), Chinese first-class, 1024d, 8192 context
// nomic-embed-text: English-focused, 768d, general purpose fallback
const PREFERRED_MODELS = [
  { name: 'bge-m3', dimensions: 1024, lang: 'multilingual' },
  { name: 'bge-small-zh-v1.5', dimensions: 512, lang: 'zh' },
  { name: 'nomic-embed-text', dimensions: 768, lang: 'en' },
];

async function detectProvider() {
  // Strategy 1: Check EMBEDDING_MODEL env override
  if (process.env.EMBEDDING_MODEL) {
    const model = process.env.EMBEDDING_MODEL;
    const baseUrl = process.env.EMBEDDING_BASE_URL || 'http://127.0.0.1:11434';
    const dims = parseInt(process.env.EMBEDDING_DIMENSIONS || '512');
    if (baseUrl.includes('11434')) {
      return { provider: 'ollama', model, dimensions: dims };
    } else {
      return { provider: 'openai-compatible', model, dimensions: dims, baseUrl };
    }
  }

  // Strategy 2: Ollama with preferred model detection
  try {
    const res = await fetchJSON('http://127.0.0.1:11434/api/tags', { timeout: 3000 });
    if (res && res.models) {
      // Check for preferred models in priority order
      for (const preferred of PREFERRED_MODELS) {
        const found = res.models.some(m => m.name && m.name.includes(preferred.name));
        if (found) return { provider: 'ollama', model: preferred.name, dimensions: preferred.dimensions };
      }

      // No preferred model found — prompt user to install bge-m3
      if (res.models.length > 0) {
        console.error('');
        console.error('Ollama 已运行，但未找到推荐的 embedding 模型。');
        console.error('');
        console.error('推荐安装 bge-m3（多语言，中文一等公民，1024维，8192 上下文）：');
        console.error('  ollama pull bge-m3');
        console.error('');
        console.error('或使用中文小模型（512维）：');
        console.error('  ollama pull bge-small-zh-v1.5');
        console.error('');
        console.error('正在自动拉取 bge-m3 ...');
        try {
          await pullModel('bge-m3');
          console.error('模型拉取成功。');
          return { provider: 'ollama', model: 'bge-small-zh-v1.5', dimensions: 512 };
        } catch (pullErr) {
          console.error('bge-small-zh-v1.5 拉取失败，尝试 nomic-embed-text ...');
          await pullModel('nomic-embed-text');
          console.error('模型拉取成功。');
          return { provider: 'ollama', model: 'nomic-embed-text', dimensions: 768 };
        }
      }
    }
  } catch (e) {}

  // Strategy 3: OpenAI API (or compatible)
  if (process.env.OPENAI_API_KEY) {
    const baseUrl = process.env.EMBEDDING_BASE_URL || 'https://api.openai.com';
    const model = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
    const dims = parseInt(process.env.EMBEDDING_DIMENSIONS || '1536');
    return { provider: 'openai', model, dimensions: dims, baseUrl };
  }

  return null;
}

async function pullModel(model) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ name: model });
    const req = http.request({
      hostname: '127.0.0.1', port: 11434, path: '/api/pull',
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      timeout: 300000
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function embedBatch(texts, provider) {
  if (provider.provider === 'ollama') {
    return embedOllama(texts, provider.model);
  } else if (provider.provider === 'openai-compatible') {
    return embedOpenAI(texts, provider.model, provider.baseUrl);
  } else {
    return embedOpenAI(texts, provider.model, provider.baseUrl || 'https://api.openai.com');
  }
}

async function embedOllama(texts, model) {
  const CONCURRENCY = 5; // 并发数
  const results = new Array(texts.length);

  for (let i = 0; i < texts.length; i += CONCURRENCY) {
    const batch = texts.slice(i, i + CONCURRENCY);
    const promises = batch.map((text, idx) => {
      const data = JSON.stringify({ model, prompt: text });
      return new Promise((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1', port: 11434, path: '/api/embeddings',
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          timeout: 30000
        }, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            try {
              const parsed = JSON.parse(body);
              resolve({ index: i + idx, embedding: parsed.embedding });
            } catch (e) { reject(e); }
          });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
      });
    });

    const batchResults = await Promise.all(promises);
    for (const r of batchResults) {
      results[r.index] = r.embedding;
    }
  }
  return results;
}

async function embedOpenAI(texts, model, baseUrl) {
  const parsed = new URL(baseUrl || 'https://api.openai.com');
  const client = parsed.protocol === 'https:' ? https : http;
  const data = JSON.stringify({ input: texts, model });
  const res = await new Promise((resolve, reject) => {
    const req = client.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: `${parsed.pathname === '/' ? '' : parsed.pathname}/v1/embeddings`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      timeout: 30000
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(JSON.parse(body)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
  return res.data.map(d => d.embedding);
}

function fetchJSON(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(url, { timeout: opts.timeout || 5000 }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// CLI mode
if (require.main === module) {
  const [,, command, ...args] = process.argv;

  if (command === 'detect') {
    detectProvider().then(p => {
      if (p) console.log(JSON.stringify(p));
      else {
        console.error('No embedding provider found.');
        console.error('Options:');
        console.error('  1. Install & run Ollama: brew install ollama && ollama serve && ollama pull nomic-embed-text');
        console.error('  2. Set OpenAI key: export OPENAI_API_KEY=xxx');
        process.exit(1);
      }
    });
  } else if (command === 'embed') {
    const text = args.join(' ');
    if (!text) { console.error('Usage: embed.js embed <text>'); process.exit(1); }
    detectProvider().then(provider => {
      if (!provider) { console.error('No embedding provider available'); process.exit(1); }
      return embedBatch([text], provider).then(vecs => {
        console.log(JSON.stringify({ provider: provider.provider, model: provider.model, dimensions: vecs[0].length }));
      });
    }).catch(e => { console.error(e.message); process.exit(1); });
  } else {
    console.error('Usage: embed.js <detect|embed> [args]');
    process.exit(1);
  }
}

module.exports = { detectProvider, embedBatch };
