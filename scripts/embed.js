#!/usr/bin/env node
const http = require('http');
const https = require('https');

async function detectProvider() {
  try {
    const res = await fetchJSON('http://127.0.0.1:11434/api/tags', { timeout: 3000 });
    if (res && res.models) {
      const hasNomic = res.models.some(m => m.name && m.name.includes('nomic-embed-text'));
      if (hasNomic) return { provider: 'ollama', model: 'nomic-embed-text', dimensions: 768 };
      if (res.models.length > 0) {
        console.error('Ollama detected but nomic-embed-text not found. Pulling model (this may take a few minutes)...');
        await pullModel('nomic-embed-text');
        console.error('Model pulled successfully.');
        return { provider: 'ollama', model: 'nomic-embed-text', dimensions: 768 };
      }
    }
  } catch (e) {}

  if (process.env.OPENAI_API_KEY) {
    return { provider: 'openai', model: 'text-embedding-3-small', dimensions: 1536 };
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
  } else {
    return embedOpenAI(texts, provider.model);
  }
}

async function embedOllama(texts, model) {
  const results = [];
  for (const text of texts) {
    const data = JSON.stringify({ model, prompt: text });
    const res = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1', port: 11434, path: '/api/embeddings',
        method: 'POST', headers: { 'Content-Type': 'application/json' },
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
    results.push(res.embedding);
  }
  return results;
}

async function embedOpenAI(texts, model) {
  const data = JSON.stringify({ input: texts, model });
  const res = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.openai.com', port: 443, path: '/v1/embeddings',
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
