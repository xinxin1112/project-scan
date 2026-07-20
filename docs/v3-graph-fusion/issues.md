# Issues for v3 图谱融合

> 创建方法：`gh issue create --repo xinxin1112/project-scan` 或直接在 GitHub web 创建

---

## Issue 1: feat: hybrid-search — 融合检索（向量召回 + 图谱扩展）

**Labels**: enhancement

### 概述

新建 `hybrid-search.js` 作为融合检索主入口，一条查询同时返回"向量命中文档 + 图谱关联上下文"，消除手动三路交叉验证。

**Spec**: `.scratch/v3-graph-fusion/spec.md` 功能 1 章节

### 已知约束（硬事实，非推断）

- 向量库无 class_name/method_name 字段（schema 仅 6 字段），符号映射统一走 frontmatter sources 提类名
- 类级 context 只有 has_method + implements，无 calls（calls 是方法级的）
- 复用 `vector-search.search()`（已 export），不继承死代码 unified-search.js

### 子任务

- [ ] **DocToSymbolResolver** — KB 文档 frontmatter sources → 类名提取；heading/text 补充信号；提取不到则不扩展
- [ ] **GraphExpander** — context 模式（类级，has_method 上限 top-8）+ trace 模式（最短路径补充）；抽出 parseContextResult / capMethods 纯函数
- [ ] **ResultMerger** — 分区不混排（hits + graph_context）；graph_context 按 from_hit 分组；edge_type 降为字段级
- [ ] **hybrid-search.js 编排层** — 串 search→resolve→expand→merge，CLI 参数 --project/--branch/--top/--graph
- [ ] **单测** — DocToSymbolResolver、ResultMerger、parseContextResult、capMethods、容错降级
- [ ] **标记 unified-search.js 废弃**

### 验收标准

1. `node hybrid-search.js "确认对账单报错" --project=pur-center --branch=prod` 返回 hits + graph_context 结构
2. graph_context 每个 expansion 有 from_hit 溯源
3. gitnexus 不可用时降级：只返回 hits，graph_context 为空数组，不崩
4. DocToSymbolResolver 对一个真实 code 文档（如 method-index.md）和一个 business 文档（如 flow）都能从 frontmatter sources 正确提取出类名，且不依赖 class_name/method_name 字段
5. 单测全过

### 输出结构示例

```json
{
  "hits": [{ "score": 0.62, "file_path": "...", "heading": "...", "snippet": "..." }],
  "graph_context": [
    {
      "from_hit": "ReconcileController",
      "from_file": "contracts/internal/reconcile.md",
      "expansions": [
        { "symbol": "confirmStatement", "kind": "Method", "edge_type": "has_method", "filePath": "..." }
      ]
    }
  ]
}
```

---

## Issue 2: feat: 图谱反哺 contracts 层 — GitNexus Route 数据机械化产出契约

**Labels**: enhancement  
**Blocked by**: 前置门槛（本 issue 第一个子任务）

### 概述

改造 `contract-generator.js`，优先读 GitNexus 1.6.9 的 Route/HTTP 契约数据，机械化产出"谁调谁"+ 返回结构，LM 只补业务语义。

**Spec**: `.scratch/v3-graph-fusion/spec.md` 功能 2 章节

### 已知约束

- 需 GitNexus 1.6.9（1.6.6 无 Spring route 提取器）
- 当前仅 supplier-portal 已用 1.6.9 重建（Route 210 个），其余仓仍旧数据
- route_map / shape_check MCP 工具的实际输出尚未验证（放进前置门槛）

### 子任务

- [ ] **前置门槛：重建图谱 + 验证工具输出**
  - 用 1.6.9 重建目标仓图谱
  - 验证 `route_map` MCP 工具对目标仓的实际输出
  - 验证 `response-shapes.js` 提取的返回结构质量
  - 通过后再继续下面的子任务
- [ ] **ContractExtractor** — 从 Route 数据提取结构化契约；数据源优先级：route_map 工具 > Route 节点查询 > regex fallback
- [ ] **ContractMerger** — 图谱契约（机械事实，优先）+ LM 契约（业务语义，补充）合并
- [ ] **contract-generator.js 改造** — 新增 --source=graph|regex|auto；auto 默认先图谱后 regex
- [ ] **单测** — ContractMerger、parseRouteMapResult、normalizeEndpoints、fallback 逻辑
- [ ] **verify.js 回归** — 确认改造后 Contract 覆盖率不退步

### 验收标准

1. `node contract-generator.js <source-dir> <output-dir> --source=graph` 产出与现有格式兼容的 KB markdown
2. 图谱不可用时 auto 模式无感 fallback 到 regex（现有行为）
3. verify.js 覆盖率 ≥ 改造前
4. 单测全过

---

## Issue 3: feat: eval — 检索质量评测集（golden set + 跑分防回归）

**Labels**: enhancement  
**Depends on**: Issue 1（需 ResultMerger 输出结构定型）

### 概述

建 golden set + 跑分脚本，防止 embedding 模型/chunk 策略/GitNexus 升级后检索质量回归。

**Spec**: `.scratch/v3-graph-fusion/spec.md` 功能 3 章节

### 范围

只覆盖功能 1（hybrid-search）。功能 2 产出质量由 verify.js Contract 覆盖率兜住。

### 子任务

- [ ] **eval/queries.yaml** — 20 条起步 golden set；来源：真实排查查询 + 核心 flow；每条标 last_verified_commit
- [ ] **EvalRunner** — 加载 yaml → 调 hybrid-search → 比对期望 → 算指标（hit_rate, mrr, graph_recall, verify_provenance 抽查）
- [ ] **eval-report.js** — 输出 markdown 报告：总分 + 退步项 + 过时检测（期望文档不存在时标注）
- [ ] **单测** — EvalRunner 比对逻辑（纯函数）
- [ ] **集成验证** — 对 pur-center/prod 跑一轮，确认报告产出正常

### 三层判定

| 层 | 指标 | 说明 |
|---|---|---|
| hits | hit rate + MRR | top-K 内是否命中期望 file_path，命中位次 |
| graph_context | recall | 期望符号是否出现在 graph_context 中 |
| 溯源正确性 | 抽查 | verify_provenance=true 的 query：符号挂在正确 from_hit 下 |

### queries.yaml 结构示例

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
  verify_provenance: false
```

### 验收标准

1. `node eval/eval-runner.js --project=pur-center --branch=prod` 输出 hit_rate / mrr / graph_recall 数值
2. 报告标注过时 query（期望文件不存在）
3. 单测全过

---

## Blocking 关系

```
Issue 1 (hybrid-search)  ← 无阻塞，先做
    ↓ 输出结构定型
Issue 3 (eval)           ← 依赖 Issue 1
    
Issue 2 (contracts)      ← 独立前置门槛，可与 Issue 1 并行验证前置，主体排后
```
