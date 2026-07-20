# v3 图谱融合 — 技术规格

> 状态：draft，待审  
> 日期：2026-07-20  
> 前置文档：`00-grill-input.md`（需求讨论 + 已验证事实）

---

## 已知约束（来自 grill 实测，非推断）

以下 5 条事实在 grill 过程中通过读源码 + 实测 GitNexus/LanceDB 确认，spec 设计以此为硬约束：

1. **unified-search.js 是死代码**：路径硬编码旧结构，连接失败静默吞，返回空。健康向量层是 `vector-search.js`（动态分环境路径、已 export `search()`）。hybrid-search 复用它，不继承 unified-search。

2. **向量库无 class_name/method_name 字段**：LanceDB schema 仅 6 字段（text, file_path, heading, kb_layer, summary, source_type）。vector-search.js 里 `row.class_name` 等永远 undefined，死字段。**符号映射统一走 KB 文档 frontmatter `sources` 提取类名**，不分 code/business chunk。

3. **类级 context 只有 has_method + implements**：没有 calls（calls 是方法级的）。edge type 过滤无效，真正噪音源是 has_method 数量。裁剪策略 = has_method 数量上限。Controller incoming 通常空，扩展价值在 outgoing。

4. **功能 2 需 GitNexus 1.6.9**：1.6.6 无 Spring route 提取器，Route 节点 = 0。1.6.9 从源码构建后 supplier-portal Route 0→210，验证通过。其余仓仍需 1.6.9 重建。

5. **1.6.9 新能力可纳入**：response-shapes.js（返回结构提取）、route_map/shape_check MCP 工具（现成映射）、trace CLI（最短调用路径）、check 子命令（图谱质量校验）。

---

## 功能 1：融合检索（hybrid-search）

### 目标

一条查询同时返回"向量命中文档 + 图谱关联上下文"，消除手动三路交叉验证。

### 模块划分

```
hybrid-search.js（薄编排层）
  ├── vector-search.search()  ← 已有，直接 require
  ├── DocToSymbolResolver     ← 新模块
  ├── GraphExpander           ← 新模块
  └── ResultMerger            ← 新模块
```

### DocToSymbolResolver

**职责**：向量召回的 KB 文档 → 图谱符号名（类名）。

**策略（统一，不分 chunk 类型）**：
1. 读 KB 文档 frontmatter `sources` 字段 → 从路径尾提取类名（主路径，code/business 通吃）
2. chunk 的 heading/text 里匹配类名·方法名（补充信号）
3. 都提取不到 → 不做图谱扩展，该结果原样保留（兜底）

**输入**：vector-search 返回的 `file_path`（KB 文档相对路径）  
**输出**：`{ filePath, symbols: [className, ...] }` 或 `null`

**纯函数，可 mock KB 文件独立测。**

### GraphExpander

**职责**：输入符号 → 调 GitNexus 返回关联符号。

**模式**：
- **context 模式**（默认）：类级 context，取 outgoing has_method（上限 top-8）+ implements。一跳。
- **trace 模式**（补充）：两符号间最短调用路径。适合展示"命中 A → 关联 B"的精确链路。

**融合检索场景用 context**（补上下文），不用 impact（那是影响分析）。

**实现拆分**：
- 薄 wrapper：调 `gitnexus context/trace` CLI
- 抽出纯函数：`parseContextResult(raw)`、`capMethods(list, n)`、容错降级逻辑
- 纯函数写单测，wrapper 不测

**输入**：`{ symbol, mode: 'context' | 'trace', targetSymbol? }`  
**输出**：`{ symbol, kind, outgoing: [{name, kind, edge_type, filePath}], incoming: [...] }`

### ResultMerger

**职责**：向量结果 + 图谱扩展 → 统一输出。

**输出结构（分区不混排）**：
```json
{
  "hits": [
    { "score": 0.62, "file_path": "...", "heading": "...", "snippet": "..." }
  ],
  "graph_context": [
    {
      "from_hit": "ReconcileController",
      "from_file": "contracts/internal/reconcile.md",
      "expansions": [
        { "symbol": "confirmStatement", "kind": "Method", "edge_type": "has_method", "filePath": "..." },
        { "symbol": "ReconcileService", "kind": "Interface", "edge_type": "implements", "filePath": "..." }
      ]
    }
  ]
}
```

**设计理由**：
- cosine score 和图谱确定性关系不可比，不混排
- graph_context 按 `from_hit` 分组（溯源链），不按 edge_type 分组（类级只有 2 种 edge，顶层分组无意义）
- 消费方可独立判断 hits 和 graph_context 的权重

**纯函数，写单测。**

### hybrid-search.js（编排层）

**流程**：
1. 解析 CLI 参数（--project, --branch, --top, --graph）
2. 调 `vector-search.search()` 获得 hits
3. 对每个 hit 调 `DocToSymbolResolver.resolve(hit.file_path)` 获得符号
4. 对每个符号调 `GraphExpander.expand(symbol)` 获得关联
5. 调 `ResultMerger.merge(hits, expansions)` 拼装输出
6. JSON stdout

**不写单测，由 eval 端到端覆盖。**

---

## 功能 2：图谱反哺 contracts 层

### 目标

contract-generator.js 优先读 GitNexus 1.6.9 的 Route/HTTP 契约数据，机械化产出"谁调谁"+ 返回结构，LM 只补业务语义。更准、更省 token。

### 前置门槛（Issue 第一个子任务）

1. 用 1.6.9 重建目标仓图谱（当前仅 supplier-portal 已重建）
2. 验证 `route_map` / `shape_check` MCP 工具对目标仓的实际输出
3. 验证 response-shapes.js 提取的返回结构质量
4. 通过后再进入主体开发

### 模块划分

```
contract-generator.js（改造现有）
  ├── ContractExtractor  ← 新模块
  └── ContractMerger     ← 新模块
```

### ContractExtractor

**职责**：从 GitNexus 1.6.9 Route 数据提取结构化契约。

**数据源优先级**：
1. `route_map` MCP 工具（如果能直接给 route↔controller 映射）
2. 直接查 Route 节点（cypher / gitnexus query）
3. 现有 regex 扫描（fallback，兼容无图谱场景）

**输出**：与现有 contract-generator 的 `parseControllerFile()` 返回格式对齐（className, basePath, endpoints[]），保证下游兼容。

**实现拆分**：
- 薄 wrapper：调 route_map 工具 / gitnexus CLI
- 抽出纯函数：`parseRouteMapResult(raw)`、`normalizeEndpoints(routes)`、工具不可用时的 fallback
- 纯函数写单测

### ContractMerger

**职责**：图谱契约（机械事实）+ 现有 LM 契约（业务语义）→ 合并输出。

**合并规则**：
- 图谱优先（端点路径、HTTP method、参数类型 = 机械事实，以图谱为准）
- LM 补充（业务说明、中文注释 = 语义，图谱不提供的部分用 LM 填）
- 冲突时图谱赢（机械事实 > LM 推断）

**纯函数，写单测。**

### contract-generator.js 改造

- 新增 `--source=graph|regex|auto` 参数
- `auto`（默认）：先尝试 ContractExtractor（图谱），失败 fallback 到现有 regex
- 保持原输出格式不变（KB markdown + frontmatter）
- verify.js 的 Contract 覆盖率检查无需改动（它验产出文档，不关心来源）

---

## 功能 3：检索质量评测集（eval）

### 目标

golden set + 跑分脚本，防止 embedding 模型/chunk 策略/GitNexus 升级后检索质量回归。

### 范围

**只覆盖功能 1（hybrid-search）**。功能 2 的产出质量由 verify.js 的 Contract 覆盖率检查兜住。

### 模块划分

```
eval/
  ├── queries.yaml       ← golden set 数据
  ├── eval-runner.js     ← 跑分脚本
  └── eval-report.js     ← 报告生成
```

### eval/queries.yaml 结构

```yaml
- query: "确认对账单报错"
  last_verified_commit: "abc1234"
  expected_hits:
    - file_path: "contracts/internal/reconcile.md"
    - file_path: "flows/reconcile-confirm.md"
  expected_graph_symbols:
    - symbol: "ReconcileController"
      from_hit: "contracts/internal/reconcile.md"
    - symbol: "ReconcileService"
      from_hit: "contracts/internal/reconcile.md"
  verify_provenance: false  # 是否验证 from_hit 溯源正确性（与 GraphExpander trace 模式无关）
```

### 三层判定

| 层 | 指标 | 说明 |
|---|---|---|
| hits | hit rate + MRR | top-K 内是否命中期望 file_path，命中位次 |
| graph_context | recall | 期望符号是否出现在 graph_context 中 |
| 溯源正确性 | 抽查 | verify_provenance=true 的 query：验证符号挂在正确的 from_hit 下 |

### EvalRunner

**职责**：加载 queries.yaml → 对每条 query 调 hybrid-search → 比对期望 → 算指标。

**输入**：queries.yaml 路径 + hybrid-search 配置（project, branch）  
**输出**：`{ hit_rate, mrr, graph_recall, trace_accuracy, per_query_details[] }`

**纯函数（比对逻辑），写单测。**

### 防过时机制

- 每条 query 标 `last_verified_commit`
- 命中率下降时区分两种情况：
  - **检索退化**：同一 commit 下跑分变差 → 检索改动有 bug
  - **golden set 过时**：commit 推进后期望文档被重命名/删除 → 更新期望值
- 跑分报告标注"哪些 query 的期望文档已不存在"

### query 来源

- 真实排查场景（日常用过的查询）
- 各模块核心 flow（submit/confirm/cancel 等）
- 不凭空造，用真实场景保证命中率有意义

---

## 测试分层

| 层 | 内容 | 测试方式 |
|---|---|---|
| 纯逻辑 | ResultMerger、DocToSymbolResolver、ContractMerger、EvalRunner | 单测 |
| wrapper 解析/裁剪/容错 | parseContextResult、capMethods、parseRouteMapResult、normalizeEndpoints、fallback | 单测（抽成纯函数） |
| wrapper CLI 调用 | GraphExpander 调 gitnexus、ContractExtractor 调工具 | 不测（= 测第三方） |
| 编排层 | hybrid-search.js | eval 端到端覆盖 |

---

## 交付顺序与 blocking 关系

```
Issue 1: hybrid-search（融合检索）  ← 无阻塞，先做
    ↓ 输出结构定型后
Issue 3: eval（检索质量评测集）     ← 依赖 Issue 1 的 ResultMerger 输出结构
    
Issue 2: contracts 反哺             ← 独立前置门槛（图谱重建+工具验证）
                                       可与 Issue 1 并行起步验证前置
                                       主体开发排最后
```

- Issue 1 + 3 是配套（产出 + 验证），3 紧跟 1
- Issue 2 第一个子任务 = 重建图谱 + 验证工具输出，通过才继续

---

## 技术栈约束

- Node.js（与现有 project-scan 一致）
- GitNexus 1.6.9（从源码构建，全局安装）
- LanceDB（向量库，已有依赖）
- 不引入 Python / GraphRAG / 额外 LLM 依赖
