# v3 图谱融合 — grill-with-docs 输入材料

> 本文档是 `/grill-with-docs` 的输入上下文，非最终 spec。整理自 2026-07-20 与 Hermes 的讨论。
> 目标：对齐三个增强功能的需求，构建共享语言，产出 spec + tickets。

## 背景

project-scan 现有三条数据腿：**KB markdown + 向量库(.vector-store) + GitNexus 图谱**。当前它们**割裂**——搜索靠向量库，影响分析靠图谱，业务上下文靠 KB，用户/Agent 需要手动三路交叉验证。本次三个增强围绕"让三条腿协同"。

参照对象：微软 GraphRAG（`microsoft/graphrag`）。结论——project-scan 的**地基比 GraphRAG 好**（GitNexus 用 tree-sitter AST 精确解析建图，零 LLM、无幻觉；GraphRAG 用 LLM 抽实体关系，会错会漏会烧钱）。只借鉴它的**融合检索编排**（向量召回 → 图谱扩展 → 一次返回），不引入 GraphRAG 本体（Python + 重 LLM 依赖，与 Node 技术栈不搭）。

前置事实：GitNexus 已升到 1.6.6（正式版）。1.6.6 新增 **Java HTTP consumer 契约提取**（#1872）+ 跨服务 `group` 能力——这是功能 2 的技术基础。多分支独立索引（#2106）仍在 rc，本次不依赖。

---

## 功能 1：融合检索（hybrid-search）— 优先级最高

**问题**：搜"确认对账单报错"→ 向量库给 KB 文档，但"这个方法改了影响谁"要另开图谱查，两者结果不互通。用户排查问题要手动切工具、手动串联。

**方案**：新增 `hybrid-search.js`，一条流水线自动融合：向量召回 top-K 文档 → 解析文档对应的图谱符号 → 用 GitNexus context/impact 扩展一跳 → 合并返回"文档 + 调用链上下文"。一次查询同时拿到"哪里报错 + 牵连哪些流程"。

**候选深模块**（待 grill 确认粒度）：
- **DocToSymbolResolver** — 输入向量召回的 KB 文档 → 输出对应图谱符号（类名/方法名）。纯映射，可 mock 图谱独立测。
- **GraphExpander** — 输入符号 + 跳数 → 调 GitNexus context/impact 返回关联符号。封装 gitnexus 调用。
- **ResultMerger** — 输入向量结果 + 图谱扩展结果 → 去重、按相关性合并排序、拼装统一输出。纯函数，最该测。
- hybrid-search.js — 薄编排层，串起上面三个 + CLI 解析。

**风险**：低。纯叠加新脚本，不动现有数据结构。不依赖"先重建图谱"。

---

## 功能 2：图谱反哺 contracts 层 — 契合四层方法论

**问题**：contracts 层（内部服务调用、外部回调）现在靠 LM + 脚本从代码扒，成本高、可能漏。

**方案**：让 `contract-generator.js` 优先读 GitNexus 1.6.6 的 HTTP 契约边（group/route/consumer），机械化产出"谁调谁"，LM 只补业务语义。更准、更省 token。契合用户"契约层是四层核心"的方法论。

**候选深模块**：
- **ContractExtractor** — 从 GitNexus 1.6.6 的 HTTP 契约边提取"谁调谁"结构化数据。
- **ContractMerger** — 图谱契约 + 现有 LM 契约合并，图谱优先补机械事实，LM 补业务语义。
- contract-generator.js — 改造现有，接入上面两模块，保持原输出格式。

**风险**：中高。要改现有 contract-generator；依赖 1.6.6 新特性，**必须先重建图谱验证 HTTP 契约提取真的出数据**，再动脚本。

---

## 功能 3：检索质量评测集（eval）— 长期防回归

**问题**：现有 `verify.js` 只查覆盖率（字段/端点/方法数），没有检索质量回归。改 embedding 模型、改 chunk 策略、升级 GitNexus 后，无法知道"搜索/影响分析变好还是变差"，全靠感觉。

**方案**：建 20-30 条 golden set（`eval/queries.yaml`：query → 期望命中文档/符号），跑分脚本算命中率/MRR，每次改动跑一遍防回归。契合用户对数据准确性敏感、"不要 yy"的偏好。

**候选深模块**：
- eval/queries.yaml — golden set 数据（非代码）。
- **EvalRunner** — 跑 query 集，对比实际命中 vs 期望，算命中率/MRR。
- eval-report 生成 — 输出 markdown 报告（命中率、退步项）。

**风险**：低。独立新增，不动现有逻辑。

---

## 依赖与顺序建议

- 功能 1、3 相互独立，风险低，可先做。
- 功能 2 依赖"重建图谱验证 1.6.6 HTTP 契约提取"，应在图谱刷新后做。
- 功能 3 的 golden set 建好后，功能 1/2 的改动都能用它验证——三者有正向协同。

## 待 grill 决策点（facts 查代码 / decisions 问人）

1. 模块划分粒度：功能 1 拆"解析→扩展→合并"三段是否合适？
2. 测试范围：全测 vs 只测核心纯逻辑（ResultMerger / ContractExtractor / EvalRunner）？
3. 产出去向：spec 发 GitHub Issues（本仓 issue tracker 已配 gh CLI）。
4. 是否先重建图谱再做功能 2（验证 HTTP 契约边真有数据）。

---

## 已验证的硬事实（2026-07-20 grill 过程中查证，修正了若干推断）

> 以下是读源码 + 实测 gitnexus/向量库得出的事实，用于修正 grill 中基于推断的设计。

### 事实 1：unified-search.js 是死代码，应新建 hybrid-search 复用 vector-search

- **unified-search.js** 向量库路径写死 `<project>/.vector-store`（L9-11），但 v2 已改成分环境结构 `<project>/<branch>/.vector-store`——旧路径不存在，脚本现在基本返回空（连接失败被 L40-42 静默吞掉）。且硬编码只覆盖 3 个项目、只搜 kb 单表、无 --branch/无阈值/无 blame。**是被 v2 重构落下的死代码。**
- **vector-search.js** 才是健康向量层：动态拼分环境路径（L234）、支持 --project/--branch（L220-221）、智能选表+阈值+blame+4级向量库发现。已 `module.exports = { search, findVectorStore }`（L254），**hybrid-search 可直接 require 复用其 search()**，不用重写召回。
- **结论**：新建 hybrid-search.js 作主入口，内部复用 vector-search.js 做召回 + 叠加图谱扩展；unified-search.js 标记废弃。eval 对 hybrid-search 单入口跑分。

### 事实 2：向量库无 class_name/method_name 字段，映射统一走 frontmatter sources

- 向量库实际只存 6 个字段（kb-vector-index.js L122-131 唯一写入点 + 实测 LanceDB schema 确认）：`text, file_path, heading, kb_layer, summary, source_type`。**没有 class_name / method_name / module / line_start**。
- vector-search.js L61-64 读的 `row.class_name` 等是**不存在的列，永远返回 undefined**——死字段，从没生效。故"code chunk 直接用 class_name.method_name 映射"这条路不存在。
- **真实映射源 = frontmatter `sources` 字段**（实测存在且完整）：KB 文档记录对应源码文件绝对路径（如 `.../controller/.../PurSupplierAnnouncementController.java`），从路径尾提取类名。code 和 business 文档**都有 sources**（CONTEXT.md 决策 7 的增量机制核心），不分 chunk 类型。
- **DocToSymbolResolver 策略**（统一，非按 code/business 分两段）：① frontmatter sources → 提类名（主路径，两类通吃）；② chunk 的 heading/text 里类名·方法名（补充信号）；③ 都提不到 → 不扩展，原样保留（兜底）。
- 顺带清理：vector-search.js 里 undefined 的 class_name/method_name 死字段建议删，避免误导。

### 事实 3：GraphExpander — 类级 context 只有 has_method+implements，calls 是方法级的

- 实测 `PurSupplierAnnouncementController`（Controller）+ `SupplierRegisterServiceImpl`（Service）的 context：
  - **端到端链路通**：frontmatter sources 提类名 → cypher `WHERE n.name CONTAINS '<类名>'` 命中符号 → context 返回结构化调用关系。可行。
  - **类级 context 的 outgoing 只有两种 edge**：`has_method`（该类的方法，Controller 4 个 / Service 22 个）、`implements`（实现的接口）。**没有 calls**。
  - **`calls` 边是方法级的**（A.foo() 调 B.bar() 挂在方法节点上），类节点上不出现。
  - Controller 的 `incoming` 通常为空（HTTP 入口），扩展价值在 outgoing。
- **修正 grill 的裁剪策略**：grill 想"按 edge type 过滤 calls/has_method/implements、滤掉 has_property/imports"——但类级根本没有 calls，has_property 也没出现，**edge type 过滤基本是空过滤**。真正的噪音源是 **has_method 的数量**（Service 22 个方法会爆）。
- **修正后策略**：hybrid-search 起步用**类级 context + has_method 数量上限（如 top-8）**，一跳。因为 DocToSymbolResolver 提取的粒度是**类**，类级扩展最自然。要方法级真实调用链（→DAO）是第二阶段，需先把符号粒度从类下沉到方法（calls 才有意义，且天然需两跳）。eval 跑分验证类级够不够，不够再下沉/放两跳。
- **context vs impact 用途**：融合检索补上下文用 `context`（调用方+被调方）；影响分析"改它炸哪些"用 `impact`。hybrid-search 用 context。

### 事实 4：功能 2 前置已验证——GitNexus 升级 1.6.6→1.6.9，Spring route 提取 0→210

> 第 5 问（功能 2 图谱前置）的实测结论。2026-07-20 完成。

- **1.6.6 提取不出 Spring route**：当前图谱（1.6.6 建）`MATCH (r:Route)` = 0，route_map 空。根因——1.6.6 的 route 提取管线（pipeline-phases/routes.js）只 import 了 nextjs/expo/php(Laravel) 提取器，**没有 Spring 提取器**。我们的 supplier-portal 是 26 个 @RestController 的标准 Spring MVC，提取不出。
- **Spring 提取器在 1.6.6 之后才加**：GitHub 源码（1.6.9）有 `route-extractors/spring.js`，但 npm 只发到 1.6.6 正式 + 1.6.7-rc.7。遂从 GitHub 源码构建 1.6.9 全局安装（构建方法见 agentmemory）。
- **实测验证成功**：用 1.6.9 全量重建 supplier-portal → **Route 节点 0 → 210**，URL 路径完整（类级 @RequestMapping `/supplier-portal/file` + 方法级 @PostMapping `/upload` 正确拼成 `/supplier-portal/file/upload`），精确到源文件。**功能 2 地基坐实，无需砍。**

### 事实 5：1.6.9 相比 1.6.6 的新能力（可纳入本次三功能）

| 新能力 | 价值 | 用在 |
|---|---|---|
| `route-extractors/spring.js` + `spring-shared.js` | Spring MVC route 提取（0→210 已验证） | **功能 2 地基** |
| `route-extractors/response-shapes.js` | 提取接口返回结构 | **功能 2**：契约不止"谁调谁"，还有"返回什么" |
| `route_map` / `shape_check` MCP 工具 | 现成 route↔consumer 映射 + 返回结构比对 | **功能 2**：ContractExtractor 可能直接调工具，不用从零写 |
| `trace <from> <to>` CLI/工具（新增） | 求两符号间最短调用路径 | **功能 1**：GraphExpander 增加 trace-based 扩展模式，串"命中符号→目标"调用链，比 context 一跳更精准 |
| `check` 子命令 | 对图谱跑结构化检查 | **功能 3**：eval 复用它做图谱侧质量校验 |

**对功能 2 设计的修正建议**：spec 里先验证 `route_map`/`shape_check` MCP 工具对 supplier-portal 的实际输出，再决定 ContractExtractor 写多少——很可能大部分逻辑图谱工具已提供，只需薄封装 + LM 补业务语义。

**对功能 1 设计的补充**：GraphExpander 除 context 一跳，增加 `trace` 扩展模式（求命中符号→目标符号最短路径），融合检索展示关联关系更精准。

### ⚠️ 重要前置：功能 2 正式开工前需用 1.6.9 重建相关仓图谱

当前只有 supplier-portal 是 1.6.9 重建的（有 route）。**其余 15 个仓图谱仍是 1.6.6 旧数据（无 route）**。功能 2 涉及哪些仓，就得先用 1.6.9 重建哪些。且 1.6.9 对同名注册更严格（`supplier-portal` 与 `supplier-portal-test` 撞名报错）——正好靠已改的 incremental.js `--name` 加环境后缀根治。
