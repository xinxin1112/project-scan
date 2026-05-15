#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { createFrontmatter, writeDocument } = require('./frontmatter');

function extractMethods(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const methods = [];

  const classMatch = content.match(/(?:public\s+)?(?:abstract\s+)?(?:class|interface)\s+(\w+)/);
  const className = classMatch ? classMatch[1] : path.basename(filePath, '.java');

  const packageMatch = content.match(/^package\s+([\w.]+);/m);
  const packageName = packageMatch ? packageMatch[1] : '';

  const lines = content.split('\n');
  const methodRegex = /^\s*(public|protected)\s+(?:static\s+)?(?:abstract\s+)?(?:synchronized\s+)?(?:<[^>]+>\s+)?(\S+)\s+(\w+)\s*\(([^)]*)\)/;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(methodRegex);
    if (match) {
      const visibility = match[1];
      const returnType = match[2];
      const methodName = match[3];
      const params = match[4].trim();

      if (methodName === className) continue;
      if (['equals', 'hashCode', 'toString', 'pkVal'].includes(methodName)) continue;

      const paramList = params ? params.split(',').map(p => {
        const parts = p.trim().split(/\s+/);
        return parts.length >= 2 ? parts.slice(-2).join(' ') : p.trim();
      }).join(', ') : '';

      // 提取方法上的注解（往上找，直到遇到空行或另一个方法）
      const annotations = [];
      for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
        const annMatch = lines[j].trim().match(/^@(\w+)(?:\(([^)]*)\))?/);
        if (annMatch) {
          annotations.push(annMatch[0]);
        } else if (lines[j].trim() === '' || lines[j].trim().startsWith('*/')) {
          break;
        }
      }

      let endLine = i;
      let braceCount = 0;
      let foundOpen = false;
      for (let j = i; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === '{') { braceCount++; foundOpen = true; }
          if (ch === '}') braceCount--;
        }
        if (foundOpen && braceCount === 0) { endLine = j; break; }
        if (lines[j].includes(';') && !foundOpen) { endLine = j; break; }
      }

      methods.push({
        name: methodName,
        returnType,
        params: paramList,
        visibility,
        lineStart: i + 1,
        lineEnd: endLine + 1,
        bodyLines: endLine - i + 1,
        annotations
      });
    }
  }

  return { className, packageName, methods, filePath };
}

function generateMethodIndex(sourceDir, outputPath, commit) {
  const javaFiles = findJavaFiles(sourceDir);
  const allClasses = [];
  const allSources = [];

  for (const fp of javaFiles) {
    const result = extractMethods(fp);
    if (result.methods.length > 0) {
      allClasses.push(result);
      allSources.push(path.relative(process.cwd(), fp));
    }
  }

  allClasses.sort((a, b) => a.className.localeCompare(b.className));

  const lines = [];
  lines.push('# Method Index');
  lines.push('');
  lines.push(`**模块：** pur-reconcile`);
  lines.push(`**类数：** ${allClasses.length}`);
  lines.push(`**方法总数：** ${allClasses.reduce((sum, c) => sum + c.methods.length, 0)}`);
  lines.push('');

  for (const cls of allClasses) {
    const relativePath = path.relative(process.cwd(), cls.filePath);
    lines.push(`## ${cls.className}`);
    lines.push('');
    lines.push(`\`${relativePath}\``);
    lines.push('');
    lines.push('| 方法 | 返回类型 | 参数 | 注解 | 行 |');
    lines.push('|------|---------|------|------|-----|');
    for (const m of cls.methods) {
      const params = m.params.length > 40 ? m.params.slice(0, 37) + '...' : m.params;
      const annStr = m.annotations.length > 0 ? m.annotations.map(a => `\`${a}\``).join(' ') : '';
      lines.push(`| ${m.name} | ${m.returnType} | ${params} | ${annStr} | ${m.lineStart}-${m.lineEnd} |`);
    }
    lines.push('');
  }

  const body = lines.join('\n');

  const frontmatter = createFrontmatter({
    kb_layer: 'code',
    summary: `方法索引，${allClasses.length} 个类，${allClasses.reduce((sum, c) => sum + c.methods.length, 0)} 个方法`,
    sources: allSources.slice(0, 50),
    commit,
    body
  });

  writeDocument(outputPath, frontmatter, body);
  return { classCount: allClasses.length, methodCount: allClasses.reduce((sum, c) => sum + c.methods.length, 0) };
}

function findJavaFiles(dir) {
  const results = [];
  function walk(d) {
    if (!fs.existsSync(d)) return;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (!['test', 'tests', 'target', 'build'].includes(entry.name)) walk(full);
      } else if (entry.name.endsWith('.java')) {
        results.push(full);
      }
    }
  }
  walk(dir);
  return results;
}

module.exports = { extractMethods, generateMethodIndex, findJavaFiles };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('用法: method-index-generator.js <source-dir> <output-file> [commit]');
    process.exit(1);
  }
  const [sourceDir, outputFile, commit = 'unknown'] = args;
  const result = generateMethodIndex(sourceDir, outputFile, commit);
  console.log(`✓ 生成: ${outputFile}`);
  console.log(`  类数: ${result.classCount}`);
  console.log(`  方法数: ${result.methodCount}`);
}
