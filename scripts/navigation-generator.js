#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { parse } = require('./frontmatter');

function generateModuleClaude(kbDir, moduleName) {
  const layers = ['flows', 'domain', 'contracts', 'code'];
  const lines = [];

  // 找入口 flow（文件名含模块关键词，或步骤最多的）
  const flowsDir = path.join(kbDir, 'flows');
  let entryFlow = null;
  if (fs.existsSync(flowsDir)) {
    const flowFiles = fs.readdirSync(flowsDir).filter(f => f.endsWith('.md'));
    let bestScore = 0;
    for (const f of flowFiles) {
      const content = fs.readFileSync(path.join(flowsDir, f), 'utf-8');
      const doc = parse(content);
      const stepCount = (content.match(/^\d+\./gm) || []).length;
      const nameMatch = f.includes('submit') || f.includes('confirm') || f.includes('save');
      const score = stepCount + (nameMatch ? 100 : 0);
      if (score > bestScore) {
        bestScore = score;
        entryFlow = { file: f, summary: doc.frontmatter?.summary || f };
      }
    }
  }

  lines.push(`# ${moduleName}`);
  lines.push('');
  if (entryFlow) {
    lines.push('> **第一次进这个模块？从这条主线开始：**');
    lines.push(`> [${entryFlow.summary.split('，')[0]}](./flows/${entryFlow.file})`);
    lines.push('');
  }

  // Flows
  if (fs.existsSync(flowsDir)) {
    const flowFiles = fs.readdirSync(flowsDir).filter(f => f.endsWith('.md')).sort();
    lines.push(`## Flows（业务流程）— ${flowFiles.length} 份`);
    lines.push('');
    for (const f of flowFiles) {
      const content = fs.readFileSync(path.join(flowsDir, f), 'utf-8');
      const doc = parse(content);
      const summary = doc.frontmatter?.summary || f;
      lines.push(`- [${f.replace('.md', '')}](./flows/${f}) — ${summary}`);
    }
    lines.push('');
  }

  // Domain
  const domainDir = path.join(kbDir, 'domain');
  if (fs.existsSync(domainDir)) {
    lines.push('## Domain（数据与规则）');
    lines.push('');
    const subdirs = ['entities', 'state-machines', 'enums', 'rules'];
    for (const sub of subdirs) {
      const subDir = path.join(domainDir, sub);
      if (!fs.existsSync(subDir)) continue;
      const files = fs.readdirSync(subDir).filter(f => f.endsWith('.md'));
      if (files.length === 0) continue;
      const label = { entities: 'Entities', 'state-machines': '状态机', enums: '枚举', rules: '规则' }[sub];
      lines.push(`### ${label} — ${files.length} 份`);
      lines.push('');
      for (const f of files) {
        const content = fs.readFileSync(path.join(subDir, f), 'utf-8');
        const doc = parse(content);
        const summary = doc.frontmatter?.summary || f;
        lines.push(`- [${f.replace('.md', '')}](./domain/${sub}/${f}) — ${summary}`);
      }
      lines.push('');
    }
  }

  // Contracts
  const contractsDir = path.join(kbDir, 'contracts');
  if (fs.existsSync(contractsDir)) {
    lines.push('## Contracts（接口契约）');
    lines.push('');
    for (const sub of ['internal', 'external']) {
      const subDir = path.join(contractsDir, sub);
      if (!fs.existsSync(subDir)) continue;
      const files = fs.readdirSync(subDir).filter(f => f.endsWith('.md'));
      if (files.length === 0) continue;
      const label = sub === 'internal' ? '内部接口' : '外部回调';
      lines.push(`### ${label} — ${files.length} 份`);
      lines.push('');
      for (const f of files) {
        const content = fs.readFileSync(path.join(subDir, f), 'utf-8');
        const doc = parse(content);
        const summary = doc.frontmatter?.summary || f;
        lines.push(`- [${f.replace('.md', '')}](./contracts/${sub}/${f}) — ${summary}`);
      }
      lines.push('');
    }
  }

  // Code
  const codeDir = path.join(kbDir, 'code');
  if (fs.existsSync(codeDir)) {
    lines.push('## Code（实现索引）');
    lines.push('');
    const files = fs.readdirSync(codeDir).filter(f => f.endsWith('.md'));
    for (const f of files) {
      const content = fs.readFileSync(path.join(codeDir, f), 'utf-8');
      const doc = parse(content);
      const summary = doc.frontmatter?.summary || f;
      lines.push(`- [${f.replace('.md', '')}](./code/${f}) — ${summary}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function generateIndex(kbRoot) {
  const lines = [];
  lines.push('# Knowledge Base Index');
  lines.push('');
  lines.push('> 本索引由 project-scan v2 自动生成。');
  lines.push('');

  // External systems
  const extDir = path.join(kbRoot, 'external-systems');
  if (fs.existsSync(extDir)) {
    const files = fs.readdirSync(extDir).filter(f => f.endsWith('.md') && f !== 'README.md');
    lines.push(`## 外部系统 — ${files.length} 份`);
    lines.push('');
    for (const f of files) {
      const content = fs.readFileSync(path.join(extDir, f), 'utf-8');
      const doc = parse(content);
      const summary = doc.frontmatter?.summary || f;
      lines.push(`- [${f.replace('.md', '')}](./external-systems/${f}) — ${summary}`);
    }
    lines.push('');
  }

  // Shared
  const sharedDir = path.join(kbRoot, 'shared', 'domain', 'enums');
  if (fs.existsSync(sharedDir)) {
    const files = fs.readdirSync(sharedDir).filter(f => f.endsWith('.md'));
    lines.push(`## 共享枚举 — ${files.length} 份`);
    lines.push('');
    lines.push(`位于 [shared/domain/enums/](./shared/domain/enums/)`);
    lines.push('');
  }

  // Modules
  const entries = fs.readdirSync(kbRoot, { withFileTypes: true });
  const modules = entries.filter(e => e.isDirectory() && !['external-systems', 'shared'].includes(e.name));
  if (modules.length > 0) {
    lines.push('## 模块');
    lines.push('');
    lines.push('| 模块 | 入口 |');
    lines.push('|------|------|');
    for (const mod of modules) {
      const claudeFile = path.join(kbRoot, mod.name, 'CLAUDE.md');
      if (fs.existsSync(claudeFile)) {
        lines.push(`| [${mod.name}](./${mod.name}/CLAUDE.md) | 模块知识库入口 |`);
      } else {
        lines.push(`| ${mod.name} | （无 CLAUDE.md） |`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

if (require.main === module) {
  const kbRoot = process.argv[2] || 'kb';

  // 生成每个模块的 CLAUDE.md
  const entries = fs.readdirSync(kbRoot, { withFileTypes: true });
  const modules = entries.filter(e => e.isDirectory() && !['external-systems', 'shared'].includes(e.name));

  for (const mod of modules) {
    const modDir = path.join(kbRoot, mod.name);
    const content = generateModuleClaude(modDir, mod.name);
    fs.writeFileSync(path.join(modDir, 'CLAUDE.md'), content, 'utf-8');
    console.log(`✓ ${mod.name}/CLAUDE.md`);
  }

  // 生成 INDEX.md
  const indexContent = generateIndex(kbRoot);
  fs.writeFileSync(path.join(kbRoot, 'INDEX.md'), indexContent, 'utf-8');
  console.log(`✓ INDEX.md`);
}

module.exports = { generateModuleClaude, generateIndex };
