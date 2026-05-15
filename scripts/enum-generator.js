#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { createFrontmatter, writeDocument } = require('./frontmatter');

function parseEnumFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const result = {
    className: null,
    dictName: null,
    values: [],
    sourcePath: filePath
  };

  const classMatch = content.match(/public\s+enum\s+(\w+)/);
  if (classMatch) result.className = classMatch[1];

  const dictMatch = content.match(/@HermesLocalDict\(name\s*=\s*"([^"]+)"\)/);
  if (dictMatch) result.dictName = dictMatch[1];

  const enumBodyMatch = content.match(/public\s+enum\s+\w+[^{]*\{([\s\S]*?)\n\s*private/);
  if (!enumBodyMatch) {
    const altMatch = content.match(/public\s+enum\s+\w+[^{]*\{([\s\S]*?)\n\s*;/);
    if (altMatch) {
      parseEnumValues(altMatch[1], result);
    }
  } else {
    parseEnumValues(enumBodyMatch[1], result);
  }

  return result;
}

function parseEnumValues(block, result) {
  const valueRegex = /(\w+)\s*\(\s*"([^"]*)"(?:\s*,\s*"([^"]*)")?\s*\)/g;
  let match;
  while ((match = valueRegex.exec(block)) !== null) {
    result.values.push({
      name: match[1],
      code: match[2],
      desc: match[3] || match[2]
    });
  }
}

function generateMarkdown(enumInfo) {
  const lines = [];
  lines.push(`# ${enumInfo.className}`);
  lines.push('');
  if (enumInfo.dictName) {
    lines.push(enumInfo.dictName);
    lines.push('');
  }
  lines.push(`**枚举值数量：** ${enumInfo.values.length}`);
  lines.push('');
  lines.push('## 枚举值');
  lines.push('');
  lines.push('| 枚举名 | code | 描述 |');
  lines.push('|--------|------|------|');
  for (const v of enumInfo.values) {
    lines.push(`| ${v.name} | \`${v.code}\` | ${v.desc} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function camelToKebab(str) {
  return str.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '').replace(/enum$/, '').replace(/-$/, '');
}

function generateEnumDoc(enumFilePath, outputDir, commit) {
  const enumInfo = parseEnumFile(enumFilePath);
  if (!enumInfo.className || enumInfo.values.length === 0) return null;

  const body = generateMarkdown(enumInfo);
  const docName = camelToKebab(enumInfo.className) + '.md';
  const outputPath = path.join(outputDir, docName);

  const relativeSrc = path.relative(process.cwd(), enumFilePath);
  const frontmatter = createFrontmatter({
    kb_layer: 'domain',
    summary: `${enumInfo.dictName || enumInfo.className}，${enumInfo.values.length} 个枚举值`,
    sources: [relativeSrc],
    commit,
    body
  });

  writeDocument(outputPath, frontmatter, body);
  return { outputPath, enumInfo };
}

module.exports = { parseEnumFile, generateMarkdown, generateEnumDoc };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('用法: enum-generator.js <enum.java> <output-dir> [commit]');
    process.exit(1);
  }
  const [enumFile, outputDir, commit = 'unknown'] = args;
  const result = generateEnumDoc(enumFile, outputDir, commit);
  if (result) {
    console.log(`✓ 生成: ${result.outputPath}`);
    console.log(`  类名: ${result.enumInfo.className}`);
    console.log(`  字典名: ${result.enumInfo.dictName || '-'}`);
    console.log(`  枚举值: ${result.enumInfo.values.length}`);
  } else {
    console.error('解析失败或无枚举值');
  }
}
