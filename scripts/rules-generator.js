#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { createFrontmatter, writeDocument } = require('./frontmatter');

const RULE_INDICATORS = [
  /差异|阈值|threshold|自动匹配|自动确认|autoMatch|autoConfirm/,
  /判断.*是否|校验.*金额|check.*amount|compare/,
  /isDifferenceRatio|differenceRatio/,
  /规则|rule.*type|RuleType/,
  /needCreate|needCollaboration|needSync/,
  /isFinish|isDoing|isAllowed|canSubmit|canConfirm/,
];

function findRuleCandidates(sourceDir) {
  const candidates = [];
  const javaFiles = findJavaFiles(sourceDir);

  for (const fp of javaFiles) {
    const content = fs.readFileSync(fp, 'utf-8');
    const lines = content.split('\n');
    const relativePath = path.relative(process.cwd(), fp);

    const methods = extractMethodBoundaries(lines);

    for (const method of methods) {
      const methodBody = lines.slice(method.start - 1, method.end).join('\n');
      const matchedIndicators = [];

      for (const pattern of RULE_INDICATORS) {
        if (pattern.test(methodBody)) {
          matchedIndicators.push(pattern.source.slice(0, 30));
        }
      }

      if (matchedIndicators.length >= 1) {
        const ifCount = (methodBody.match(/\bif\s*\(/g) || []).length;
        const ternaryCount = (methodBody.match(/\?.*:/g) || []).length;
        const decisionPoints = ifCount + ternaryCount;

        if (decisionPoints >= 2 || matchedIndicators.length >= 2) {
          candidates.push({
            file: relativePath,
            className: path.basename(fp, '.java'),
            methodName: method.name,
            lineStart: method.start,
            lineEnd: method.end,
            indicators: matchedIndicators,
            decisionPoints,
            snippet: methodBody.slice(0, 800)
          });
        }
      }
    }
  }

  candidates.sort((a, b) => b.decisionPoints - a.decisionPoints);
  return candidates;
}

function extractMethodBoundaries(lines) {
  const methods = [];
  const methodRegex = /^\s*(public|private|protected)\s+(?:static\s+)?(?:abstract\s+)?(?:synchronized\s+)?(?:<[^>]+>\s+)?(\S+)\s+(\w+)\s*\(/;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(methodRegex);
    if (match) {
      const name = match[3];
      if (['equals', 'hashCode', 'toString', 'pkVal'].includes(name)) continue;

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

      methods.push({ name, start: i + 1, end: endLine + 1 });
    }
  }
  return methods;
}

function generateRulesDoc(sourceDir, outputPath, commit) {
  const candidates = findRuleCandidates(sourceDir);
  if (candidates.length === 0) return null;

  const sources = [...new Set(candidates.map(c => c.file))];

  const lines = [];
  lines.push('# 业务规则候选');
  lines.push('');
  lines.push(`**候选方法数：** ${candidates.length}`);
  lines.push(`**涉及文件数：** ${sources.length}`);
  lines.push('');
  lines.push('> 以下方法包含决策逻辑（if-else / 条件判断），可能是业务规则。');
  lines.push('> 需要人工或 LM 审查后转为正式的决策表文档。');
  lines.push('');

  const grouped = {};
  for (const c of candidates) {
    if (!grouped[c.className]) grouped[c.className] = [];
    grouped[c.className].push(c);
  }

  for (const [className, methods] of Object.entries(grouped)) {
    lines.push(`## ${className}`);
    lines.push('');
    lines.push(`\`${methods[0].file}\``);
    lines.push('');
    for (const m of methods) {
      lines.push(`### ${m.methodName}（行 ${m.lineStart}-${m.lineEnd}）`);
      lines.push('');
      lines.push(`- **决策点：** ${m.decisionPoints} 个 if/三元`);
      lines.push(`- **匹配指标：** ${m.indicators.join(', ')}`);
      lines.push('');
      lines.push('```java');
      lines.push(m.snippet.trim());
      if (m.snippet.length >= 800) lines.push('// ... (截断)');
      lines.push('```');
      lines.push('');
    }
  }

  const body = lines.join('\n');

  const frontmatter = createFrontmatter({
    kb_layer: 'domain',
    summary: `业务规则候选，${candidates.length} 个方法，${sources.length} 个文件，待人工审查`,
    sources: sources.slice(0, 30),
    commit,
    body
  });

  writeDocument(outputPath, frontmatter, body);
  return { candidateCount: candidates.length, fileCount: sources.length };
}

function findJavaFiles(dir) {
  const results = [];
  function walk(d) {
    if (!fs.existsSync(d)) return;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (!['test', 'tests', 'target', 'build', 'entity', 'dto', 'vo', 'enums', 'config'].includes(entry.name)) walk(full);
      } else if (entry.name.endsWith('.java')) {
        results.push(full);
      }
    }
  }
  walk(dir);
  return results;
}

module.exports = { findRuleCandidates, generateRulesDoc };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('用法: rules-generator.js <source-dir> <output-file> [commit]');
    process.exit(1);
  }
  const [sourceDir, outputFile, commit = 'unknown'] = args;
  const result = generateRulesDoc(sourceDir, outputFile, commit);
  if (result) {
    console.log(`✓ 生成: ${outputFile}`);
    console.log(`  候选方法: ${result.candidateCount}`);
    console.log(`  涉及文件: ${result.fileCount}`);
  } else {
    console.log('未找到规则候选');
  }
}
