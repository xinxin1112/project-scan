/**
 * DocToSymbolResolver
 * 向量召回的 KB 文档 → 图谱符号名（类名）
 *
 * 策略（统一，不分 chunk 类型）：
 * 1. 读 frontmatter sources → 从路径尾提取类名
 * 2. heading/text 里匹配类名（补充信号）
 * 3. 都提取不到 → 返回 null
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('./frontmatter');

// 匹配 Java 类名格式：大写开头，至少两个字符
const CLASS_NAME_PATTERN = /\b([A-Z][a-zA-Z0-9]{2,}(?:Controller|Service|ServiceImpl|Repository|Dao|Entity|Mapper|Handler|Listener|Config|Factory|Manager|Provider|Adapter|Client|Facade|Strategy|Builder|Validator|Interceptor|Filter|Aspect|Utils?|Helper))\b/;

/**
 * 从 Java 源码路径提取类名
 * e.g. "/path/to/ReconcileController.java" → "ReconcileController"
 */
function extractClassFromPath(sourcePath) {
  if (!sourcePath) return null;
  const basename = path.basename(sourcePath);
  const match = basename.match(/^([A-Z][a-zA-Z0-9]+)\.java$/);
  return match ? match[1] : null;
}

/**
 * 从文档 heading 或 body 中提取类名（补充信号）
 */
function extractClassFromText(body) {
  if (!body) return [];
  // 优先匹配 # 开头的一级标题
  const headingMatch = body.match(/^#\s+([A-Z][a-zA-Z0-9]+)/m);
  if (headingMatch) {
    const candidate = headingMatch[1];
    // 检查是否像一个类名（含常见后缀或至少有一个驼峰切换）
    if (CLASS_NAME_PATTERN.test(candidate) || /[a-z][A-Z]/.test(candidate)) {
      return [candidate];
    }
  }
  return [];
}

/**
 * 解析 KB 文档，提取图谱符号
 * @param {string} filePath - KB 文档相对路径
 * @param {string} kbBaseDir - KB 根目录绝对路径
 * @returns {{ filePath: string, symbols: string[] } | null}
 */
function resolve(filePath, kbBaseDir) {
  const absPath = path.join(kbBaseDir, filePath);
  if (!fs.existsSync(absPath)) return null;

  const content = fs.readFileSync(absPath, 'utf-8');
  const doc = parse(content);
  if (!doc) return null;

  const symbols = [];

  // 策略 1: frontmatter sources → 提取类名
  if (doc.frontmatter && doc.frontmatter.sources && Array.isArray(doc.frontmatter.sources)) {
    for (const src of doc.frontmatter.sources) {
      const cls = extractClassFromPath(src);
      if (cls && !symbols.includes(cls)) {
        symbols.push(cls);
      }
    }
  }

  // 策略 2: heading/text 补充（仅当 sources 没提取到时）
  if (symbols.length === 0) {
    const textSymbols = extractClassFromText(doc.body);
    for (const s of textSymbols) {
      if (!symbols.includes(s)) symbols.push(s);
    }
  }

  // 策略 3: 都提取不到 → null
  if (symbols.length === 0) return null;

  return { filePath, symbols };
}

module.exports = { resolve, extractClassFromPath, extractClassFromText };
