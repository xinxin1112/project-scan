#!/usr/bin/env node
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const SETTINGS_PATH = path.join(process.env.HOME || '/Users/a6667', '.claude/settings.json');

function loadConfig() {
  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
  } catch (e) {}

  const token = process.env.ANTHROPIC_AUTH_TOKEN || settings.env?.ANTHROPIC_AUTH_TOKEN;
  const baseUrl = process.env.ANTHROPIC_BASE_URL || settings.env?.ANTHROPIC_BASE_URL;
  const model = process.env.KB_LEVEL2_MODEL || 'claude-sonnet-5';

  if (!token) throw new Error('ANTHROPIC_AUTH_TOKEN not found (env or ~/.claude/settings.json)');
  if (!baseUrl) throw new Error('ANTHROPIC_BASE_URL not found (env or ~/.claude/settings.json)');

  return { token, baseUrl, model };
}

function selectModel(config, complexity) {
  if (complexity === 'high') return 'claude-opus-4-8';
  return config.model;
}

function assessComplexity(candidate, flowContent) {
  const svcMatch = flowContent.match(/调用服务数[：:]\s*\**\s*(\d+)/);
  const svcCount = svcMatch ? parseInt(svcMatch[1]) : 0;
  const hasStatusChange = /触发状态变更[：:]\s*\**\s*是/.test(flowContent);
  const hasTransaction = flowContent.includes('事务') || flowContent.includes('@Transactional');
  const hasMQ = flowContent.includes('MQ') || flowContent.includes('消息队列') || flowContent.includes('EventBus');

  if (svcCount >= 4) return 'high';
  if (svcCount >= 3 && hasStatusChange) return 'high';
  if (hasStatusChange && (hasTransaction || hasMQ)) return 'high';
  return 'normal';
}

function callLLM(config, model, system, userMessage) {
  return new Promise((resolve, reject) => {
    const url = new URL(config.baseUrl.replace(/\/+$/, '') + '/v1/messages');
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const body = JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: [{ role: 'user', content: userMessage }]
    });

    const req = transport.request({
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.token}`,
        'anthropic-version': '2023-06-01'
      },
      timeout: 120000
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`API ${res.statusCode}: ${data.slice(0, 300)}`));
          return;
        }
        try {
          const parsed = JSON.parse(data);
          const text = parsed.content?.[0]?.text;
          if (!text) reject(new Error('API 返回空 content'));
          else resolve(text);
        } catch (e) {
          reject(new Error(`响应解析失败: ${e.message}`));
        }
      });
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('API 超时 (120s)')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function parseLevel2Response(responseText) {
  let body = responseText.trim();
  if (body.startsWith('```markdown')) body = body.slice('```markdown'.length);
  else if (body.startsWith('```')) body = body.slice(3);
  if (body.endsWith('```')) body = body.slice(0, -3);
  return body.trim();
}

async function generateLevel2ForCandidate(candidate, repoDir, config) {
  const { buildPromptForMethod } = require('./flow-level2-builder');
  const { parse, serialize } = require('./frontmatter');

  const content = fs.readFileSync(candidate.file, 'utf-8');
  const doc = parse(content);
  if (!doc.frontmatter || !doc.frontmatter.sources || doc.frontmatter.sources.length === 0) {
    throw new Error('无 frontmatter sources');
  }

  const controllerSource = doc.frontmatter.sources.find(s => s.includes('Controller'));
  if (!controllerSource) throw new Error('sources 中无 Controller 文件');

  const controllerFile = path.resolve(repoDir, controllerSource);
  if (!fs.existsSync(controllerFile)) throw new Error(`Controller 不存在: ${controllerSource}`);

  const methodName = candidate.name.replace('.md', '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());

  const javaIdx = controllerFile.indexOf('/src/main/java/');
  const sourceDir = javaIdx !== -1
    ? controllerFile.slice(0, javaIdx + '/src/main/java'.length)
    : path.dirname(controllerFile);

  let enumDir = '';
  const commonEnumsDir = findEnumDirFromRepo(repoDir);
  if (commonEnumsDir) enumDir = commonEnumsDir;

  const prompt = buildPromptForMethod(controllerFile, methodName, sourceDir, enumDir);
  if (!prompt) throw new Error(`buildPromptForMethod 返回 null（方法 ${methodName}）`);

  const complexity = assessComplexity(candidate, content);
  const model = selectModel(config, complexity);

  const responseText = await callLLM(config, model, prompt.system, prompt.user);
  const level2Body = parseLevel2Response(responseText);

  const newBody = doc.body.trimEnd() + '\n\n' + level2Body + '\n';
  const updated = serialize(doc.frontmatter, newBody);
  fs.writeFileSync(candidate.file, updated, 'utf-8');

  return { model, complexity, methodName };
}

function findEnumDirFromRepo(repoDir) {
  const candidates = [];
  try {
    const apps = fs.readdirSync(repoDir).filter(d => {
      const fp = path.join(repoDir, d);
      return fs.statSync(fp).isDirectory() && !d.startsWith('.');
    });
    for (const app of apps) {
      const commonEnums = path.join(repoDir, app, 'src/main/java');
      if (!fs.existsSync(commonEnums)) continue;
      const found = findDirRecursive(commonEnums, 'enums', 4);
      if (found) candidates.push(found);
    }
  } catch (e) {}
  return candidates.find(c => c.includes('common')) || candidates[0] || '';
}

function findDirRecursive(base, target, maxDepth) {
  if (maxDepth <= 0) return null;
  try {
    const entries = fs.readdirSync(base, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === target) return path.join(base, e.name);
      const found = findDirRecursive(path.join(base, e.name), target, maxDepth - 1);
      if (found) return found;
    }
  } catch (e) {}
  return null;
}

module.exports = {
  loadConfig,
  selectModel,
  assessComplexity,
  callLLM,
  parseLevel2Response,
  generateLevel2ForCandidate
};
