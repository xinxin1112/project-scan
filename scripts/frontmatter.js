#!/usr/bin/env node
const fs = require('fs');
const crypto = require('crypto');

const REQUIRED_FIELDS = ['kb_layer', 'summary', 'sources', 'last_scan_commits', 'stale'];
const VALID_LAYERS = ['domain', 'contracts', 'flows', 'code'];

function parse(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: null, body: content };

  const raw = match[1];
  const body = match[2];
  const fm = {};

  let currentKey = null;
  let currentValue = '';
  let inArray = false;
  let arrayItems = [];

  function flushCurrent() {
    if (currentKey) {
      fm[currentKey] = inArray ? arrayItems : currentValue.trim();
    }
    currentKey = null;
    currentValue = '';
    inArray = false;
    arrayItems = [];
  }

  for (const line of raw.split('\n')) {
    const topLevelMatch = line.match(/^(\w[\w_]*):\s*(.*)/);
    if (topLevelMatch && !line.startsWith(' ') && !line.startsWith('\t')) {
      flushCurrent();
      currentKey = topLevelMatch[1];
      const rest = topLevelMatch[2].trim();
      if (rest === '' || rest === '[]') {
        inArray = true;
        arrayItems = [];
      } else if (rest === 'true') {
        fm[currentKey] = true;
        currentKey = null;
      } else if (rest === 'false') {
        fm[currentKey] = false;
        currentKey = null;
      } else {
        currentValue = rest.replace(/^["']|["']$/g, '');
        inArray = false;
      }
    } else if (inArray && /^\s+-\s/.test(line)) {
      const item = line.replace(/^\s+-\s*/, '').trim();
      if (item.startsWith('{')) {
        const obj = {};
        const inner = item.replace(/^\{|\}$/g, '');
        const pairs = inner.split(/,\s*/);
        for (const pair of pairs) {
          const cIdx = pair.indexOf(':');
          if (cIdx > 0) {
            const k = pair.slice(0, cIdx).trim();
            const v = pair.slice(cIdx + 1).trim().replace(/^["']|["']$/g, '');
            obj[k] = v;
          }
        }
        arrayItems.push(obj);
      } else {
        arrayItems.push(item.replace(/^["']|["']$/g, ''));
      }
    }
  }
  flushCurrent();

  return { frontmatter: fm, body };
}

function serialize(frontmatter, body) {
  const lines = ['---'];

  lines.push(`kb_layer: ${frontmatter.kb_layer}`);
  lines.push(`summary: "${(frontmatter.summary || '').replace(/"/g, '\\"')}"`);
  lines.push(`stale: ${frontmatter.stale || false}`);

  if (frontmatter.stale_reason) {
    lines.push(`stale_reason: "${frontmatter.stale_reason}"`);
  }
  if (frontmatter.human_edited) {
    lines.push(`human_edited: true`);
  }

  lines.push('sources:');
  for (const src of (frontmatter.sources || [])) {
    lines.push(`  - ${src}`);
  }

  lines.push('last_scan_commits:');
  for (const entry of (frontmatter.last_scan_commits || [])) {
    lines.push(`  - {file: "${entry.file}", commit: "${entry.commit}", body_hash: "${entry.body_hash || ''}"}`);
  }

  lines.push('---');
  return lines.join('\n') + '\n' + body;
}

function computeBodyHash(body) {
  const normalized = body
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 16);
}

function createFrontmatter({ kb_layer, summary, sources, commit, body }) {
  const bodyHash = computeBodyHash(body);
  return {
    kb_layer,
    summary,
    stale: false,
    sources: sources || [],
    last_scan_commits: (sources || []).map(file => ({
      file,
      commit: commit || '',
      body_hash: bodyHash
    }))
  };
}

function writeDocument(filePath, frontmatter, body) {
  const dir = require('path').dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, serialize(frontmatter, body), 'utf-8');
}

function readDocument(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf-8');
  return parse(content);
}

function isHumanEdited(filePath) {
  const doc = readDocument(filePath);
  if (!doc || !doc.frontmatter) return false;
  if (doc.frontmatter.human_edited) return true;

  const currentHash = computeBodyHash(doc.body);
  const entries = doc.frontmatter.last_scan_commits || [];
  if (entries.length > 0 && entries[0].body_hash) {
    return currentHash !== entries[0].body_hash;
  }
  return false;
}

module.exports = {
  parse,
  serialize,
  computeBodyHash,
  createFrontmatter,
  writeDocument,
  readDocument,
  isHumanEdited,
  REQUIRED_FIELDS,
  VALID_LAYERS
};

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === 'verify' && args[1]) {
    const doc = readDocument(args[1]);
    if (!doc || !doc.frontmatter) {
      console.error('无法解析 frontmatter');
      process.exit(1);
    }
    const missing = REQUIRED_FIELDS.filter(f => !(f in doc.frontmatter));
    if (missing.length > 0) {
      console.error(`缺少字段: ${missing.join(', ')}`);
      process.exit(1);
    }
    if (!VALID_LAYERS.includes(doc.frontmatter.kb_layer)) {
      console.error(`无效的 kb_layer: ${doc.frontmatter.kb_layer}`);
      process.exit(1);
    }
    const edited = isHumanEdited(args[1]);
    console.log(`✓ frontmatter 有效 | kb_layer=${doc.frontmatter.kb_layer} | human_edited=${edited}`);
  } else {
    console.log('用法: frontmatter.js verify <file.md>');
  }
}
