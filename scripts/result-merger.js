/**
 * ResultMerger
 * 向量结果 + 图谱扩展 → 统一输出（分区不混排）
 *
 * 输出结构：
 * { hits: [...], graph_context: [{ from_hit, from_file, expansions }] }
 */

/**
 * 合并向量召回结果和图谱扩展
 * @param {Array} hits - 向量搜索结果
 * @param {Array} expansionsMap - [{ fromHit: {file_path, symbol}, expansion: {symbol, kind, outgoing, incoming} }]
 * @returns {{ hits: Array, graph_context: Array }}
 */
function merge(hits, expansionsMap) {
  const safeHits = Array.isArray(hits) ? hits : [];
  const safeExpansions = Array.isArray(expansionsMap) ? expansionsMap : [];

  const graphContext = [];

  for (const entry of safeExpansions) {
    const { fromHit, expansion } = entry;
    if (!expansion) continue;

    // 合并 outgoing + incoming，映射 name → symbol（spec 输出格式）
    const rawEdges = [...(expansion.outgoing || []), ...(expansion.incoming || [])];

    // 跳过空扩展
    if (rawEdges.length === 0) continue;

    const expansions = rawEdges.map(edge => ({
      symbol: edge.name,
      kind: edge.kind,
      edge_type: edge.edge_type,
      filePath: edge.filePath
    }));

    graphContext.push({
      from_hit: fromHit.symbol || expansion.symbol,
      from_file: fromHit.file_path,
      expansions
    });
  }

  return {
    hits: safeHits,
    graph_context: graphContext
  };
}

module.exports = { merge };
