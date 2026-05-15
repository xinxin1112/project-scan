#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROMPT_TEMPLATE = fs.readFileSync(
  path.join(__dirname, '../templates/prompts/flow-level2-analysis.md'), 'utf-8'
);

// 核心 flow 方法列表（可配置）
const CORE_FLOWS = [
  'submit', 'confirm', 'save', 'cancel', 'abandon',
  'change', 'withdraw', 'nodeBack', 'copy', 'batchSubmit'
];

function buildPromptForMethod(controllerFile, methodName, sourceDir, enumDir) {
  const controllerContent = fs.readFileSync(controllerFile, 'utf-8');

  // 提取 Controller 方法
  const ctrlMethod = extractMethod(controllerContent, methodName);
  if (!ctrlMethod) return null;

  // 找到调用的 Service 方法
  const serviceCalls = findServiceCalls(ctrlMethod.body, controllerContent);

  // 提取 Service 方法体
  const serviceMethods = [];
  for (const call of serviceCalls) {
    const implFile = findImplFile(call.className, sourceDir);
    if (!implFile) continue;
    const implContent = fs.readFileSync(implFile, 'utf-8');
    const method = extractMethod(implContent, call.methodName);
    if (method) {
      serviceMethods.push({
        className: call.className,
        methodName: call.methodName,
        body: method.body.slice(0, 3000) // 限制长度
      });
    }
  }

  // 加载异常码枚举
  const errorEnums = loadErrorEnums(enumDir);

  // 加载状态枚举
  const statusEnums = loadStatusEnums(enumDir);

  // 拼接 prompt
  const userMessage = [
    '## Controller 方法',
    '```java',
    ctrlMethod.body,
    '```',
    '',
    '## Service 方法（第二层）',
    ...serviceMethods.map(m => [
      `### ${m.className}.${m.methodName}`,
      '```java',
      m.body,
      '```',
      ''
    ].join('\n')),
    '',
    '## 状态枚举',
    '```',
    statusEnums.slice(0, 1000),
    '```',
    '',
    '## 异常码枚举（部分）',
    '```',
    errorEnums.slice(0, 1500),
    '```'
  ].join('\n');

  return {
    system: PROMPT_TEMPLATE,
    user: userMessage,
    methodName,
    controllerFile
  };
}

function extractMethod(content, methodName) {
  const lines = content.split('\n');
  const regex = new RegExp(`\\b${methodName}\\s*\\(`);

  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i]) && /^\s*(public|private|protected|@)/.test(lines[Math.max(0, i-3)] + lines[Math.max(0, i-2)] + lines[Math.max(0, i-1)] + lines[i])) {
      // 往上找注解和注释
      let startLine = i;
      for (let j = i - 1; j >= Math.max(0, i - 15); j--) {
        if (lines[j].trim().startsWith('@') || lines[j].trim().startsWith('*') || lines[j].trim().startsWith('/**') || lines[j].trim().startsWith('//')) {
          startLine = j;
        } else if (lines[j].trim() === '') {
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

      return { body: lines.slice(startLine, endLine + 1).join('\n'), startLine, endLine };
    }
  }
  return null;
}

function findServiceCalls(body, controllerContent) {
  const calls = [];
  const injected = {};
  const regex = /@Resource\s*\n\s*private\s+(\w+)\s+(\w+)\s*;/g;
  let match;
  while ((match = regex.exec(controllerContent)) !== null) {
    injected[match[2]] = match[1];
  }

  const callRegex = /(\w+)\.([\w]+)\s*\(/g;
  while ((match = callRegex.exec(body)) !== null) {
    if (injected[match[1]]) {
      calls.push({ className: injected[match[1]], methodName: match[2] });
    }
  }
  return calls;
}

function findImplFile(interfaceName, sourceDir) {
  const implName = interfaceName + 'Impl.java';
  const files = execSync(`find "${sourceDir}" -name "${implName}" 2>/dev/null`).toString().trim().split('\n');
  return files[0] || null;
}

function loadErrorEnums(enumDir) {
  const errorDir = path.join(enumDir, 'error/reconcile');
  if (!fs.existsSync(errorDir)) return '';
  const files = fs.readdirSync(errorDir).filter(f => f.endsWith('.java'));
  let result = '';
  for (const f of files) {
    const content = fs.readFileSync(path.join(errorDir, f), 'utf-8');
    const enumRegex = /(\w+)\s*\(\s*(\d+)\s*,\s*"([^"]+)"\s*\)/g;
    let match;
    while ((match = enumRegex.exec(content)) !== null) {
      result += `${match[1]} (${match[2]}): ${match[3]}\n`;
    }
  }
  return result;
}

function loadStatusEnums(enumDir) {
  const statusDir = path.join(enumDir, 'dict/reconcile');
  if (!fs.existsSync(statusDir)) return '';
  const statusFile = path.join(statusDir, 'ReconcileUsageStatusEnum.java');
  if (!fs.existsSync(statusFile)) return '';
  const content = fs.readFileSync(statusFile, 'utf-8');
  const enumRegex = /(\w+)\s*\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/g;
  let result = '';
  let match;
  while ((match = enumRegex.exec(content)) !== null) {
    result += `${match[1]} ("${match[2]}"): ${match[3]}\n`;
  }
  return result;
}

module.exports = { buildPromptForMethod, CORE_FLOWS };

if (require.main === module) {
  const args = process.argv.slice(2);
  const controllerFile = args[0] || 'app/pur-reconcile/src/main/java/com/bilibili/purchase/reconcile/api/controller/usage/ReconcileUsageOperateController.java';
  const methodName = args[1] || 'confirm';
  const sourceDir = args[2] || 'app/pur-reconcile/src/main/java';
  const enumDir = args[3] || 'app/pur-common/src/main/java/com/bilibili/purchase/common/enums';

  const prompt = buildPromptForMethod(controllerFile, methodName, sourceDir, enumDir);
  if (prompt) {
    console.log('=== System Prompt ===');
    console.log(prompt.system.slice(0, 200) + '...');
    console.log(`\n=== User Message (${prompt.user.length} chars) ===`);
    console.log(prompt.user.slice(0, 500) + '...');
    console.log(`\n✓ Prompt 构建成功，可发送给 LM API`);
    console.log(`  方法: ${prompt.methodName}`);
    console.log(`  User message 长度: ${prompt.user.length} 字符`);

    // 输出完整 prompt 到文件供调试
    const outputDir = path.join(__dirname, '../.scratch/prompts');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, `${methodName}.txt`), `SYSTEM:\n${prompt.system}\n\nUSER:\n${prompt.user}`);
    console.log(`  完整 prompt 已保存到: .scratch/prompts/${methodName}.txt`);
  } else {
    console.error(`未找到方法: ${methodName}`);
  }
}
