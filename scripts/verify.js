#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { parse } = require('./frontmatter');

function verifyModule(kbModuleDir, sourceDir, dbConfig) {
  const report = {
    timestamp: new Date().toISOString(),
    checks: [],
    totalCoverage: 0,
    gaps: []
  };

  // Check 1: Entity 字段覆盖率
  const entityCheck = verifyEntities(kbModuleDir, sourceDir);
  report.checks.push(entityCheck);

  // Check 2: Contract 端点覆盖率
  const contractCheck = verifyContracts(kbModuleDir, sourceDir);
  report.checks.push(contractCheck);

  // Check 3: Method-index 覆盖率
  const methodCheck = verifyMethodIndex(kbModuleDir, sourceDir);
  report.checks.push(methodCheck);

  // 计算总覆盖率
  const totalExpected = report.checks.reduce((s, c) => s + c.expected, 0);
  const totalCovered = report.checks.reduce((s, c) => s + c.covered, 0);
  report.totalCoverage = totalExpected > 0 ? Math.round(totalCovered / totalExpected * 100) : 100;
  report.gaps = report.checks.flatMap(c => c.gaps);

  return report;
}

function verifyEntities(kbModuleDir, sourceDir) {
  const entitiesDir = path.join(kbModuleDir, 'domain', 'entities');
  if (!fs.existsSync(entitiesDir)) return { name: 'entities', expected: 0, covered: 0, coverage: 100, gaps: [] };

  const entitySourceDir = findEntityDir(sourceDir);
  if (!entitySourceDir) return { name: 'entities', expected: 0, covered: 0, coverage: 100, gaps: [] };

  const sourceFiles = fs.readdirSync(entitySourceDir).filter(f => f.endsWith('.java'));
  const kbFiles = fs.readdirSync(entitiesDir).filter(f => f.endsWith('.md'));

  const gaps = [];
  for (const sf of sourceFiles) {
    const expectedDoc = sf.replace(/Entity\.java$/, '').replace(/\.java$/, '')
      .replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '') + '.md';
    if (!kbFiles.some(kf => kf === expectedDoc || kf.includes(sf.replace('.java', '').toLowerCase()))) {
      gaps.push({ type: 'entity_missing', file: sf, expected: expectedDoc });
    }
  }

  const covered = sourceFiles.length - gaps.length;
  return {
    name: 'entities',
    expected: sourceFiles.length,
    covered,
    coverage: sourceFiles.length > 0 ? Math.round(covered / sourceFiles.length * 100) : 100,
    gaps
  };
}

function verifyContracts(kbModuleDir, sourceDir) {
  const contractsDir = path.join(kbModuleDir, 'contracts', 'internal');
  if (!fs.existsSync(contractsDir)) return { name: 'contracts', expected: 0, covered: 0, coverage: 100, gaps: [] };

  // 从源码找所有 Controller
  const controllerFiles = findFilesByPattern(sourceDir, /[Cc]ontroller\.java$/);
  const kbFiles = fs.readdirSync(contractsDir).filter(f => f.endsWith('.md'));

  const gaps = [];
  for (const cf of controllerFiles) {
    const content = fs.readFileSync(cf, 'utf-8');
    // 提取所有端点
    const endpoints = [];
    const mappingRegex = /@(Get|Post|Put|Delete|Patch)Mapping\("([^"]+)"\)/g;
    let match;
    while ((match = mappingRegex.exec(content)) !== null) {
      endpoints.push(`${match[1].toUpperCase()} ${match[2]}`);
    }

    // 检查 KB 文档是否覆盖了这些端点
    const className = path.basename(cf, '.java');
    const kbDocName = className.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '').replace(/controller$/, '').replace(/-$/, '') + '.md';
    const kbDoc = kbFiles.find(f => f === kbDocName);

    if (!kbDoc && endpoints.length > 0) {
      gaps.push({ type: 'controller_missing', file: className, endpoints: endpoints.length });
    } else if (kbDoc) {
      const kbContent = fs.readFileSync(path.join(contractsDir, kbDoc), 'utf-8');
      for (const ep of endpoints) {
        const epPath = ep.split(' ')[1];
        if (!kbContent.includes(epPath)) {
          gaps.push({ type: 'endpoint_missing', controller: className, endpoint: ep });
        }
      }
    }
  }

  const totalEndpoints = controllerFiles.reduce((sum, cf) => {
    const content = fs.readFileSync(cf, 'utf-8');
    return sum + (content.match(/@(Get|Post|Put|Delete|Patch)Mapping/g) || []).length;
  }, 0);

  const missingEndpoints = gaps.filter(g => g.type === 'endpoint_missing').length;
  const covered = totalEndpoints - missingEndpoints;

  return {
    name: 'contracts',
    expected: totalEndpoints,
    covered,
    coverage: totalEndpoints > 0 ? Math.round(covered / totalEndpoints * 100) : 100,
    gaps
  };
}

function verifyMethodIndex(kbModuleDir, sourceDir) {
  const methodIndexPath = path.join(kbModuleDir, 'code', 'method-index.md');
  if (!fs.existsSync(methodIndexPath)) return { name: 'method-index', expected: 0, covered: 0, coverage: 0, gaps: [{ type: 'method_index_missing' }] };

  const indexContent = fs.readFileSync(methodIndexPath, 'utf-8');
  const indexedMethods = (indexContent.match(/^\| \w+/gm) || []).length;

  // 粗略统计源码 public 方法数
  const javaFiles = findFilesByPattern(sourceDir, /\.java$/);
  let totalPublicMethods = 0;
  for (const jf of javaFiles) {
    const content = fs.readFileSync(jf, 'utf-8');
    totalPublicMethods += (content.match(/^\s*public\s+(?!class|interface|enum)\S+\s+\w+\s*\(/gm) || []).length;
  }

  const coverage = totalPublicMethods > 0 ? Math.round(indexedMethods / totalPublicMethods * 100) : 100;

  return {
    name: 'method-index',
    expected: totalPublicMethods,
    covered: indexedMethods,
    coverage: Math.min(coverage, 100),
    gaps: coverage < 90 ? [{ type: 'method_index_incomplete', indexed: indexedMethods, total: totalPublicMethods }] : []
  };
}

function findEntityDir(sourceDir) {
  const candidates = findFilesByPattern(sourceDir, /[Ee]ntity\.java$/);
  if (candidates.length === 0) return null;
  return path.dirname(candidates[0]);
}

function findFilesByPattern(dir, pattern) {
  const results = [];
  function walk(d) {
    if (!fs.existsSync(d)) return;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (!['test', 'tests', 'target', 'build', 'node_modules'].includes(entry.name)) walk(full);
      } else if (pattern.test(entry.name)) {
        results.push(full);
      }
    }
  }
  walk(dir);
  return results;
}

function generateReport(report, outputPath) {
  const lines = [];
  lines.push('# KB Verification Report');
  lines.push('');
  lines.push(`**生成时间：** ${report.timestamp}`);
  lines.push(`**总覆盖率：** ${report.totalCoverage}%`);
  lines.push(`**问题数：** ${report.gaps.length}`);
  lines.push('');

  lines.push('## 检查结果');
  lines.push('');
  lines.push('| 检查项 | 预期 | 覆盖 | 覆盖率 |');
  lines.push('|--------|------|------|--------|');
  for (const check of report.checks) {
    const icon = check.coverage >= 90 ? '✓' : '✗';
    lines.push(`| ${icon} ${check.name} | ${check.expected} | ${check.covered} | ${check.coverage}% |`);
  }
  lines.push('');

  if (report.gaps.length > 0) {
    lines.push('## 覆盖差距');
    lines.push('');
    for (const gap of report.gaps) {
      switch (gap.type) {
        case 'entity_missing':
          lines.push(`- **Entity 文档缺失：** ${gap.file} → 预期文档 ${gap.expected}`);
          break;
        case 'controller_missing':
          lines.push(`- **Controller 文档缺失：** ${gap.file}（${gap.endpoints} 个端点未记录）`);
          break;
        case 'endpoint_missing':
          lines.push(`- **端点未记录：** ${gap.controller} → ${gap.endpoint}`);
          break;
        case 'method_index_missing':
          lines.push(`- **method-index.md 不存在**`);
          break;
        case 'method_index_incomplete':
          lines.push(`- **method-index 不完整：** 索引了 ${gap.indexed}/${gap.total} 个方法`);
          break;
      }
    }
    lines.push('');
  }

  lines.push('## 建议操作');
  lines.push('');
  if (report.gaps.length > 0) {
    lines.push('```bash');
    lines.push('/project-scan update --fix-coverage');
    lines.push('```');
  } else {
    lines.push('无需操作，覆盖率达标。');
  }
  lines.push('');

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');
}

module.exports = { verifyModule, generateReport };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('用法: verify.js <kb-module-dir> <source-dir> [output-path]');
    process.exit(1);
  }
  const [kbModuleDir, sourceDir, outputPath = 'kb/verify-report.md'] = args;
  const report = verifyModule(kbModuleDir, sourceDir);
  generateReport(report, outputPath);
  console.log(`✓ 验证完成 — 总覆盖率: ${report.totalCoverage}%`);
  if (report.gaps.length > 0) {
    console.log(`  问题数: ${report.gaps.length}`);
  }
}
