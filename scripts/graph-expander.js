/**
 * GraphExpander
 * 输入符号 → 调 GitNexus context/trace 返回关联符号
 *
 * 纯函数（parseContextResult, capMethods）可独立测试
 * wrapper（expand）调 gitnexus CLI，不测
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');

const DEFAULT_METHOD_CAP = 8;

/**
 * 解析 gitnexus context 返回的 JSON 为统一结构
 * 容错：null/undefined/error 返回空结构
 */
function parseContextResult(raw) {
  const empty = { symbol: null, kind: null, outgoing: [], incoming: [] };
  if (!raw || raw.error || !raw.symbol) return empty;

  const { symbol } = raw;
  const outgoing = [];
  const incoming = [];

  // 解析 outgoing edges
  if (raw.outgoing && typeof raw.outgoing === 'object') {
    for (const [edgeType, nodes] of Object.entries(raw.outgoing)) {
      if (!Array.isArray(nodes)) continue;
      for (const node of nodes) {
        outgoing.push({
          name: node.name,
          kind: node.kind,
          edge_type: edgeType,
          filePath: node.filePath
        });
      }
    }
  }

  // 解析 incoming edges
  if (raw.incoming && typeof raw.incoming === 'object') {
    for (const [edgeType, nodes] of Object.entries(raw.incoming)) {
      if (!Array.isArray(nodes)) continue;
      for (const node of nodes) {
        incoming.push({
          name: node.name,
          kind: node.kind,
          edge_type: edgeType,
          filePath: node.filePath
        });
      }
    }
  }

  return {
    symbol: symbol.name,
    kind: symbol.kind,
    outgoing,
    incoming
  };
}

/**
 * 裁剪 outgoing 列表：has_method 限制数量上限，其他 edge 类型保留
 */
function capMethods(list, n = DEFAULT_METHOD_CAP) {
  if (!list || list.length === 0) return [];

  const methods = list.filter(item => item.edge_type === 'has_method');
  const others = list.filter(item => item.edge_type !== 'has_method');

  const cappedMethods = methods.slice(0, n);
  return [...cappedMethods, ...others];
}

/**
 * 调 gitnexus context CLI（wrapper，不测）
 */
function expand(symbol, options = {}) {
  const { mode = 'context', targetSymbol, sourcePath, methodCap = DEFAULT_METHOD_CAP } = options;

  if (!sourcePath) {
    return { symbol: null, kind: null, outgoing: [], incoming: [] };
  }

  try {
    let cmd;
    if (mode === 'trace' && targetSymbol) {
      cmd = `gitnexus trace "${symbol}" "${targetSymbol}"`;
    } else {
      cmd = `gitnexus context "${symbol}"`;
    }

    const stdout = execSync(cmd, {
      cwd: sourcePath,
      timeout: 30000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const raw = JSON.parse(stdout.trim());
    const result = parseContextResult(raw);
    result.outgoing = capMethods(result.outgoing, methodCap);
    return result;
  } catch (e) {
    // 降级：gitnexus 不可用时返回空结构，不崩
    return { symbol: null, kind: null, outgoing: [], incoming: [] };
  }
}

module.exports = { parseContextResult, capMethods, expand };
