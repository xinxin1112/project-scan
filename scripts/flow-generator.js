#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { createFrontmatter, writeDocument } = require('./frontmatter');

function buildCallGraph(controllerDir, sourceDir) {
  const controllers = findJavaFiles(controllerDir);
  const flows = [];

  // 预加载所有 App/Service/Domain 类的注入关系和方法体
  const allFiles = findJavaFiles(sourceDir);
  const classMap = {};
  const interfaceToImpl = {};

  for (const fp of allFiles) {
    const content = fs.readFileSync(fp, 'utf-8');
    const cn = extractClassName(content);
    if (cn) {
      classMap[cn] = {
        file: fp,
        content,
        injectedFields: extractInjectedFields(content)
      };
      // 建立接口 → 实现类映射（implements XXX）
      const implMatch = content.match(/class\s+(\w+)\s+implements\s+([\w,\s]+)/);
      if (implMatch) {
        const interfaces = implMatch[2].split(',').map(s => s.trim());
        for (const iface of interfaces) {
          if (!interfaceToImpl[iface]) interfaceToImpl[iface] = [];
          interfaceToImpl[iface].push(cn);
        }
      }
    }
  }

  for (const ctrlFile of controllers) {
    const ctrlContent = fs.readFileSync(ctrlFile, 'utf-8');
    const className = extractClassName(ctrlContent);
    const basePath = extractBasePath(ctrlContent);
    const injectedFields = extractInjectedFields(ctrlContent);
    const methods = extractControllerMethods(ctrlContent);

    for (const method of methods) {
      // 第一跳：Controller → App/Service
      const firstCalls = extractServiceCalls(method.body, injectedFields);

      // 第二跳：追踪到 App 层方法体
      const allCalls = [...firstCalls];
      let hasStatusChange = /setReconcileStatus|updateReconcileStatus|batchUpdateReconcileStatus/.test(method.body);

      for (const call of firstCalls) {
        // 尝试直接匹配类名，或通过接口→实现类映射
        let targetClass = classMap[call.serviceName];
        if (!targetClass) {
          const impls = interfaceToImpl[call.serviceName];
          if (impls && impls.length > 0) {
            targetClass = classMap[impls[0]];
          }
        }
        if (!targetClass) continue;

        const targetMethodResult = extractMethodBody(targetClass.content, call.methodName);
        if (!targetMethodResult) continue;
        const targetMethod = targetMethodResult.body;
        const targetAnnotations = targetMethodResult.annotations || [];

        // 记录注解到 call 上
        call.annotations = targetAnnotations;

        if (/setReconcileStatus|updateReconcileStatus|batchUpdateReconcileStatus/.test(targetMethod)) {
          hasStatusChange = true;
        }

        const secondCalls = extractServiceCalls(targetMethod, targetClass.injectedFields);
        for (const sc of secondCalls) {
          allCalls.push({ ...sc, depth: 2, via: `${call.serviceName}.${call.methodName}` });
        }
      }

      const distinctServices = new Set(allCalls.map(c => c.serviceName));

      if (distinctServices.size >= 2 || hasStatusChange) {
        flows.push({
          controller: className,
          controllerFile: ctrlFile,
          httpMethod: method.httpMethod,
          path: basePath + method.path,
          methodName: method.name,
          comment: method.comment,
          line: method.line,
          calls: allCalls,
          hasStatusChange,
          distinctServiceCount: distinctServices.size
        });
      }
    }
  }

  return flows;
}

function extractMethodBody(content, methodName) {
  const lines = content.split('\n');
  const regex = new RegExp(`\\b${methodName}\\s*\\(`);

  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i]) && /^\s*(public|private|protected|@Override)/.test(lines[Math.max(0, i-1)] + lines[i])) {
      // 提取方法上的注解
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
      }
      return { body: lines.slice(i, endLine + 1).join('\n'), annotations };
    }
  }
  return null;
}

function extractClassName(content) {
  const match = content.match(/public\s+class\s+(\w+)/);
  return match ? match[1] : 'Unknown';
}

function extractBasePath(content) {
  const match = content.match(/@RequestMapping\("([^"]+)"\)/);
  return match ? match[1] : '';
}

function extractInjectedFields(content) {
  const fields = {};
  const regex = /@Resource\s*\n\s*private\s+(\w+)\s+(\w+)\s*;/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    fields[match[2]] = match[1];
  }
  const autowiredRegex = /@Autowired\s*\n\s*private\s+(\w+)\s+(\w+)\s*;/g;
  while ((match = autowiredRegex.exec(content)) !== null) {
    fields[match[2]] = match[1];
  }
  return fields;
}

function extractControllerMethods(content) {
  const methods = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const mappingMatch = lines[i].match(/@(Get|Post|Put|Delete|Patch)Mapping\("([^"]+)"\)/);
    if (!mappingMatch) continue;

    const httpMethod = mappingMatch[1].toUpperCase();
    const urlPath = mappingMatch[2];

    let comment = '';
    for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
      if (lines[j].trim().startsWith('/**')) {
        comment = lines.slice(j, i)
          .map(l => l.replace(/^\s*\*\s?/, '').trim())
          .filter(l => l && !l.startsWith('@') && !l.startsWith('/') && !l.startsWith('<'))
          .join(' ');
        break;
      }
    }

    let methodName = '';
    let methodLine = i + 1;
    for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
      const mMatch = lines[j].match(/public\s+\S+\s+(\w+)\s*\(/);
      if (mMatch) {
        methodName = mMatch[1];
        methodLine = j + 1;
        break;
      }
    }

    let endLine = methodLine;
    let braceCount = 0;
    let foundOpen = false;
    for (let j = methodLine - 1; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === '{') { braceCount++; foundOpen = true; }
        if (ch === '}') braceCount--;
      }
      if (foundOpen && braceCount === 0) { endLine = j + 1; break; }
    }

    const body = lines.slice(methodLine - 1, endLine).join('\n');

    methods.push({
      httpMethod,
      path: urlPath,
      name: methodName,
      comment,
      line: methodLine,
      body
    });
  }

  return methods;
}

function extractServiceCalls(body, injectedFields) {
  const calls = [];
  const callRegex = /(\w+)\.([\w]+)\s*\(/g;
  let match;

  while ((match = callRegex.exec(body)) !== null) {
    const varName = match[1];
    const methodName = match[2];

    if (varName === 'log' || varName === 'JSONObject' || varName === 'JSON') continue;
    if (['info', 'error', 'warn', 'debug', 'toJSONString', 'success', 'fail'].includes(methodName)) continue;

    const serviceType = injectedFields[varName];
    if (serviceType) {
      calls.push({
        serviceName: serviceType,
        fieldName: varName,
        methodName,
        isExternal: serviceType.includes('Client') || serviceType.includes('Http')
      });
    }
  }

  return calls;
}

function generateFlowMarkdown(flow, sourceDir) {
  const lines = [];
  lines.push(`# ${flow.comment || flow.methodName}`);
  lines.push('');
  lines.push(`**入口：** \`${flow.httpMethod} ${flow.path}\``);
  lines.push(`**Controller：** ${flow.controller}.${flow.methodName}（行 ${flow.line}）`);
  lines.push(`**调用服务数：** ${flow.distinctServiceCount}`);
  lines.push(`**触发状态变更：** ${flow.hasStatusChange ? '是' : '否'}`);
  lines.push('');

  lines.push('## 调用链');
  lines.push('');
  lines.push('```');
  lines.push(`${flow.controller}.${flow.methodName}()`);
  const seen = new Set();
  for (const call of flow.calls) {
    const key = `${call.serviceName}.${call.methodName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const prefix = call.isExternal ? '  → [外部]' : '  →';
    const txTag = (call.annotations || []).some(a => /Transactional/.test(a)) ? ' [事务]' : '';
    const asyncTag = (call.annotations || []).some(a => /Async/.test(a)) ? ' [异步]' : '';
    lines.push(`${prefix} ${call.serviceName}.${call.methodName}()${txTag}${asyncTag}`);
  }
  lines.push('```');
  lines.push('');

  lines.push('## 步骤');
  lines.push('');
  let step = 1;
  const seenSteps = new Set();
  for (const call of flow.calls) {
    const key = `${call.serviceName}.${call.methodName}`;
    if (seenSteps.has(key)) continue;
    seenSteps.add(key);
    const tag = call.isExternal ? '（外部系统）' : '';
    const annTags = (call.annotations || [])
      .filter(a => /Transactional|Async|Cacheable|Retryable|Scheduled/.test(a))
      .map(a => `\`${a}\``)
      .join(' ');
    const annSuffix = annTags ? ` ${annTags}` : '';
    lines.push(`${step}. 调用 \`${call.serviceName}.${call.methodName}()\` ${tag}${annSuffix}`);
    step++;
  }
  lines.push('');

  if (flow.hasStatusChange) {
    lines.push('## 状态变更');
    lines.push('');
    lines.push('本流程触发对账单状态变更。详见 [状态机文档](../domain/state-machines/)。');
    lines.push('');
  }

  return lines.join('\n');
}

function generateFlowDocs(controllerDir, sourceDir, outputDir, commit) {
  const flows = buildCallGraph(controllerDir, sourceDir);
  let count = 0;

  for (const flow of flows) {
    const body = generateFlowMarkdown(flow, sourceDir);
    const docName = flow.methodName.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '') + '.md';
    const outputPath = path.join(outputDir, docName);

    const relativeSrc = path.relative(process.cwd(), flow.controllerFile);
    const frontmatter = createFrontmatter({
      kb_layer: 'flows',
      summary: `${flow.comment || flow.methodName}，${flow.httpMethod} ${flow.path}，调用 ${flow.distinctServiceCount} 个服务`,
      sources: [relativeSrc],
      commit,
      body
    });

    writeDocument(outputPath, frontmatter, body);
    count++;
  }

  return { flowCount: count, totalAnalyzed: flows.length };
}

function findJavaFiles(dir) {
  const results = [];
  function walk(d) {
    if (!fs.existsSync(d)) return;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.java')) results.push(full);
    }
  }
  walk(dir);
  return results;
}

module.exports = { buildCallGraph, generateFlowDocs };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.log('用法: flow-generator.js <controller-dir> <source-dir> <output-dir> [commit]');
    process.exit(1);
  }
  const [controllerDir, sourceDir, outputDir, commit = 'unknown'] = args;
  const result = generateFlowDocs(controllerDir, sourceDir, outputDir, commit);
  console.log(`✓ 生成 ${result.flowCount} 份 flow 文档`);
}
