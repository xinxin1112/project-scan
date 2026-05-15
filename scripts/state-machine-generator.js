#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { createFrontmatter, writeDocument } = require('./frontmatter');

function extractTransitions(sourceDir, statusEnumFile) {
  const enumValues = parseStatusEnum(statusEnumFile);
  const transitions = [];
  const sources = new Set();

  const javaFiles = findJavaFiles(sourceDir);

  for (const fp of javaFiles) {
    const content = fs.readFileSync(fp, 'utf-8');
    const relativePath = path.relative(process.cwd(), fp);

    const patterns = [
      /updateReconcileStatus\([^,]+,\s*(\w+Enum)\.(\w+)/g,
      /setReconcileStatus\((\w+Enum)\.(\w+)\.getCode\(\)\)/g,
      /setReconcileStatus\((\w+Enum)\.(\w+)\.getCode\(\)\)/g,
      /batchUpdateReconcileStatus\([^,]+,\s*[^,]+,\s*(\w+)/g,
    ];

    const statusSetPattern = /(?:updateReconcileStatus|setReconcileStatus|batchUpdateReconcileStatus)\s*\(/g;
    let match;
    while ((match = statusSetPattern.exec(content)) !== null) {
      const lineNum = content.slice(0, match.index).split('\n').length;
      const context = content.slice(Math.max(0, match.index - 500), Math.min(content.length, match.index + 300));

      const targetMatch = context.match(/(?:ReconcileUsageStatusEnum|ReconcileUsageAllStatusEnum|ReconcileSupplyStatusEnum)\.(\w+)/);
      if (!targetMatch) continue;

      const targetStatus = targetMatch[1];

      const methodContext = findEnclosingMethod(content, match.index);
      const trigger = methodContext.methodName || 'unknown';

      let fromStatus = 'any';
      const fromMatch = context.match(/getReconcileStatus\(\)|List\.of\(([^)]+)\)/);
      if (fromMatch && fromMatch[1]) {
        const fromCodes = fromMatch[1].match(/(\w+Enum)\.(\w+)/g);
        if (fromCodes) {
          fromStatus = fromCodes.map(c => c.split('.').pop()).join(' | ');
        }
      }

      sources.add(relativePath);
      transitions.push({
        from: fromStatus,
        to: targetStatus,
        trigger,
        file: relativePath,
        line: lineNum
      });
    }
  }

  return { enumValues, transitions, sources: [...sources] };
}

function parseStatusEnum(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const values = [];
  const regex = /(\w+)\s*\(\s*"([^"]*)"(?:\s*,\s*"([^"]*)")?\s*\)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    if (match.index > content.indexOf('{') && match.index < content.indexOf('private')) {
      values.push({ name: match[1], code: match[2], desc: match[3] || match[2] });
    }
  }
  return values;
}

function findEnclosingMethod(content, index) {
  const before = content.slice(0, index);
  const methodMatch = [...before.matchAll(/(?:public|private|protected)\s+\S+\s+(\w+)\s*\(/g)];
  if (methodMatch.length > 0) {
    return { methodName: methodMatch[methodMatch.length - 1][1] };
  }
  return { methodName: 'unknown' };
}

function findJavaFiles(dir) {
  const results = [];
  function walk(d) {
    if (!fs.existsSync(d)) return;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (!['test', 'tests', 'target', 'build', 'entity', 'dto', 'vo', 'enums'].includes(entry.name)) walk(full);
      } else if (entry.name.endsWith('.java')) {
        results.push(full);
      }
    }
  }
  walk(dir);
  return results;
}

function generateMarkdown(entityName, data) {
  const lines = [];
  lines.push(`# ${entityName} 状态机`);
  lines.push('');
  lines.push(`**状态数：** ${data.enumValues.length}`);
  lines.push(`**转移数：** ${data.transitions.length}`);
  lines.push('');

  lines.push('## 状态定义');
  lines.push('');
  lines.push('| 枚举名 | code | 描述 |');
  lines.push('|--------|------|------|');
  for (const v of data.enumValues) {
    lines.push(`| ${v.name} | \`${v.code}\` | ${v.desc} |`);
  }
  lines.push('');

  lines.push('## 状态转移');
  lines.push('');
  lines.push('| 从 | 到 | 触发方法 | 源文件 | 行 |');
  lines.push('|----|-----|---------|--------|-----|');
  for (const t of data.transitions) {
    const file = path.basename(t.file, '.java');
    lines.push(`| ${t.from} | ${t.to} | ${t.trigger} | ${file} | ${t.line} |`);
  }
  lines.push('');

  if (data.enumValues.length > 0) {
    lines.push('## 状态流转图（Mermaid）');
    lines.push('');
    lines.push('```mermaid');
    lines.push('stateDiagram-v2');
    for (const t of data.transitions) {
      const from = t.from === 'any' ? '[*]' : t.from;
      lines.push(`    ${from} --> ${t.to}: ${t.trigger}`);
    }
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}

function generateStateMachineDoc(entityName, sourceDir, statusEnumFile, outputDir, commit) {
  const data = extractTransitions(sourceDir, statusEnumFile);
  if (data.transitions.length === 0) return null;

  const body = generateMarkdown(entityName, data);
  const docName = entityName.toLowerCase().replace(/\s+/g, '-') + '-status.md';
  const outputPath = path.join(outputDir, docName);

  const frontmatter = createFrontmatter({
    kb_layer: 'domain',
    summary: `${entityName} 状态机，${data.enumValues.length} 个状态，${data.transitions.length} 个转移`,
    sources: data.sources,
    commit,
    body
  });

  writeDocument(outputPath, frontmatter, body);
  return { outputPath, stateCount: data.enumValues.length, transitionCount: data.transitions.length };
}

module.exports = { extractTransitions, generateStateMachineDoc };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 4) {
    console.log('用法: state-machine-generator.js <entity-name> <source-dir> <status-enum-file> <output-dir> [commit]');
    process.exit(1);
  }
  const [entityName, sourceDir, statusEnumFile, outputDir, commit = 'unknown'] = args;
  const result = generateStateMachineDoc(entityName, sourceDir, statusEnumFile, outputDir, commit);
  if (result) {
    console.log(`✓ 生成: ${result.outputPath}`);
    console.log(`  状态数: ${result.stateCount}`);
    console.log(`  转移数: ${result.transitionCount}`);
  } else {
    console.error('未找到状态转移');
  }
}
