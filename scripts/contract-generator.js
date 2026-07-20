#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { createFrontmatter, writeDocument } = require('./frontmatter');

function parseControllerFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const result = {
    className: null,
    basePath: '',
    comment: null,
    endpoints: [],
    sourcePath: filePath
  };

  const classMatch = content.match(/public\s+class\s+(\w+)/);
  if (classMatch) result.className = classMatch[1];

  const basePathMatch = content.match(/@RequestMapping\("([^"]+)"\)/);
  if (basePathMatch) result.basePath = basePathMatch[1];

  const classComment = content.match(/\/\*\*\s*\n\s*\*\s*(?:<p>\s*\n\s*\*\s*)?(.+?)\s*\n/);
  if (classComment) result.comment = classComment[1].replace(/<\/?p>/g, '').trim();

  const methodMappings = [
    { regex: /@GetMapping\("([^"]+)"\)/g, method: 'GET' },
    { regex: /@PostMapping\("([^"]+)"\)/g, method: 'POST' },
    { regex: /@PutMapping\("([^"]+)"\)/g, method: 'PUT' },
    { regex: /@DeleteMapping\("([^"]+)"\)/g, method: 'DELETE' },
    { regex: /@PatchMapping\("([^"]+)"\)/g, method: 'PATCH' },
  ];

  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    for (const mapping of methodMappings) {
      mapping.regex.lastIndex = 0;
      const match = mapping.regex.exec(line);
      if (match) {
        const endpointPath = match[1];
        const fullPath = result.basePath + endpointPath;

        let methodComment = '';
        for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
          if (lines[j].trim().startsWith('/**')) {
            const commentBlock = lines.slice(j, i).join('\n');
            const commentLines = commentBlock.split('\n')
              .map(l => l.replace(/^\s*\*\s?/, '').trim())
              .filter(l => l && !l.startsWith('@') && !l.startsWith('/') && !l.startsWith('<'));
            methodComment = commentLines.join(' ');
            break;
          }
        }

        let methodName = '';
        let returnType = '';
        let params = '';
        for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
          const methodMatch = lines[j].match(/public\s+(\S+)\s+(\w+)\s*\(([^)]*)\)/);
          if (methodMatch) {
            returnType = methodMatch[1];
            methodName = methodMatch[2];
            params = methodMatch[3].trim()
              .replace(/@\w+\s*/g, '')
              .replace(/\s+/g, ' ')
              .trim();
            break;
          }
        }

        result.endpoints.push({
          httpMethod: mapping.method,
          path: fullPath,
          methodName,
          returnType,
          params,
          comment: methodComment,
          line: i + 1
        });
      }
    }
  }

  return result;
}

function generateContractMarkdown(controller) {
  const lines = [];
  lines.push(`# ${controller.className}`);
  lines.push('');
  if (controller.comment) {
    lines.push(controller.comment);
    lines.push('');
  }
  lines.push(`**基础路径：** \`${controller.basePath}\``);
  lines.push(`**端点数：** ${controller.endpoints.length}`);
  lines.push('');
  lines.push('## 端点列表');
  lines.push('');
  lines.push('| HTTP | 路径 | 方法名 | 说明 | 返回类型 |');
  lines.push('|------|------|--------|------|---------|');
  for (const ep of controller.endpoints) {
    const comment = ep.comment.replace(/\|/g, '\\|').slice(0, 60);
    const ret = ep.returnType.replace(/\|/g, '\\|');
    lines.push(`| ${ep.httpMethod} | \`${ep.path}\` | ${ep.methodName} | ${comment} | ${ret} |`);
  }

  lines.push('');
  lines.push('## 端点详情');
  lines.push('');
  for (const ep of controller.endpoints) {
    lines.push(`### ${ep.httpMethod} \`${ep.path}\``);
    lines.push('');
    if (ep.comment) lines.push(`${ep.comment}`);
    lines.push('');
    lines.push(`- **方法：** \`${ep.methodName}\``);
    lines.push(`- **行号：** ${ep.line}`);
    if (ep.params) {
      lines.push(`- **参数：** \`${ep.params}\``);
    }
    lines.push(`- **返回：** \`${ep.returnType}\``);
    lines.push('');
  }

  return lines.join('\n');
}

function camelToKebab(str) {
  return str.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '').replace(/controller$/, '').replace(/-$/, '');
}

function generateContractDoc(controllerFilePath, outputDir, commit) {
  const controller = parseControllerFile(controllerFilePath);
  if (!controller.className || controller.endpoints.length === 0) return null;

  const body = generateContractMarkdown(controller);
  const docName = camelToKebab(controller.className) + '.md';
  const outputPath = path.join(outputDir, docName);

  const relativeSrc = path.relative(process.cwd(), controllerFilePath);
  const frontmatter = createFrontmatter({
    kb_layer: 'contracts',
    summary: `${controller.comment || controller.className}，${controller.endpoints.length} 个端点，基础路径 ${controller.basePath}`,
    sources: [relativeSrc],
    commit,
    body
  });

  writeDocument(outputPath, frontmatter, body);
  return { outputPath, controller };
}

module.exports = { parseControllerFile, generateContractMarkdown, generateContractDoc, camelToKebab };

if (require.main === module) {
  const args = process.argv.slice(2);
  const sourceArg = args.find(a => a.startsWith('--source='));
  const source = sourceArg ? sourceArg.split('=')[1] : 'auto';
  const positional = args.filter(a => !a.startsWith('--'));

  if (positional.length < 2) {
    console.log('用法: contract-generator.js <controller.java | dir> <output-dir> [commit] [--source=graph|regex|auto]');
    process.exit(1);
  }
  const [input, outputDir, commit = 'unknown'] = positional;

  if (source === 'graph' || source === 'auto') {
    const { extractFromGraph } = require('./contract-extractor');
    const { mergeAll } = require('./contract-merger');
    const graphControllers = extractFromGraph(input);

    if (graphControllers && graphControllers.length > 0) {
      let regexControllers = [];
      if (source === 'auto') {
        const stat = fs.statSync(input);
        const files = stat.isDirectory()
          ? fs.readdirSync(input, { recursive: true }).filter(f => f.endsWith('.java')).map(f => path.join(input, f))
          : [input];
        regexControllers = files.map(f => parseControllerFile(f)).filter(c => c.className && c.endpoints.length > 0);
      }

      const merged = mergeAll(graphControllers, regexControllers);
      let count = 0;
      for (const controller of merged) {
        const body = generateContractMarkdown(controller);
        const docName = camelToKebab(controller.className) + '.md';
        const outputPath = path.join(outputDir, docName);
        const relativeSrc = controller.sourcePath || '';
        const frontmatter = createFrontmatter({
          kb_layer: 'contracts',
          summary: `${controller.comment || controller.className}，${controller.endpoints.length} 个端点，基础路径 ${controller.basePath}`,
          sources: [relativeSrc],
          commit,
          body
        });
        writeDocument(outputPath, frontmatter, body);
        console.log(`✓ ${controller.className} — ${controller.endpoints.length} 端点 [graph]`);
        count++;
      }
      console.log(`\n共生成 ${count} 份 contract 文档（source: graph${source === 'auto' ? '+regex merged' : ''}）`);
      process.exit(0);
    } else if (source === 'graph') {
      console.error('图谱中无 Route 数据，无法使用 --source=graph');
      process.exit(1);
    }
    // auto fallthrough to regex
  }

  // regex mode (default fallback)
  const stat = fs.statSync(input);
  const files = stat.isDirectory()
    ? fs.readdirSync(input, { recursive: true })
        .filter(f => f.endsWith('.java'))
        .map(f => path.join(input, f))
    : [input];

  let count = 0;
  for (const f of files) {
    const result = generateContractDoc(f, outputDir, commit);
    if (result) {
      console.log(`✓ ${result.controller.className} — ${result.controller.endpoints.length} 端点`);
      count++;
    }
  }
  console.log(`\n共生成 ${count} 份 contract 文档（source: regex）`);
}
