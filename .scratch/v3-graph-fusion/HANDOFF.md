# v3 图谱融合 — Handoff 记录

> 日期：2026-07-20  
> 阶段：需求对齐 + spec + issues 完成，**待创建 GitHub issue + 进 implement**  
> 目的：快速恢复上下文，避免重走已验证的路。

---

## 一句话背景

给 project-scan 加三个增强，让割裂的三条数据腿（KB markdown / 向量库 / GitNexus 图谱）协同。全程走 mattpocock skills 流程（grill-with-docs → to-spec → to-tickets），Hermes 侧负责实测验证 + 验收，纠正了 grill 多处基于推断的错误设计。

## 三个功能

| # | 功能 | 状态 | 依赖 |
|---|---|---|---|
| 1 | 融合检索 hybrid-search（向量召回 + 图谱扩展） | spec/issue 就绪 | 无阻塞，先做 |
| 3 | eval 检索质量评测集（golden set 防回归） | spec/issue 就绪 | 依赖 Issue 1 输出结构 |
| 2 | 图谱反哺 contracts 层（Route 数据机械化产出契约） | spec/issue 就绪 | 前置门槛：1.6.9 重建图谱 + 验证 route_map |

**交付顺序：Issue 1 → Issue 3（紧跟）→ Issue 2（前置门槛过后主体开发）**

## 关键文件

- `spec.md` — 统一技术规格（已验收通过）
- `issues.md` — 3 个 issue 完整内容（待创建到 GitHub `xinxin1112/project-scan`）
- `00-grill-input.md` — 需求讨论 + **5 条已验证事实**（设计硬约束，务必继承）

---

## 已完成的环境变更（重要，别重做）

1. **GitNexus 升级 1.6.6 → 1.6.9**（全局 `~/.local/lib/node_modules/gitnexus`）
   - 从 GitHub 源码构建（npm 无 1.6.9），构建方法见 agentmemory「gitnexus 1.6.9」
   - 旧版备份 `gitnexus.1.6.6-bak`，可回滚
   - 原因：1.6.6 无 Spring route 提取器，Route=0；1.6.9 有，supplier-portal 实测 0→210

2. **incremental.js 已修复并提交**（commit `7de47e7`）
   - fetch dry-run bug（误报"最新"）+ 图谱 analyze 补 --name 后缀 + 超时 300→600s
   - **未 push**

3. **supplier-portal 图谱已用 1.6.9 重建**（Route 210 个）
   - 其余 15 个仓图谱仍是 1.6.6 旧数据（无 route）——功能 2 涉及哪些仓就得先重建
   - 注册表有 supplier-portal / supplier-portal-test 撞名（历史遗留 + allow-duplicate），批量重建时用 --name 后缀理顺

---

## 5 条已验证硬事实（grill 实测纠正，implement 必须遵守）

1. **unified-search.js 是死代码**（路径写死旧结构、返回空）。hybrid-search 复用 `vector-search.search()`（已 export），不继承 unified-search。

2. **向量库无 class_name/method_name 字段**（实测 LanceDB schema 仅 6 字段：text, file_path, heading, kb_layer, summary, source_type）。vector-search.js 里读的 row.class_name 永远 undefined。**DocToSymbolResolver 统一走 frontmatter sources 提类名，不分 code/business chunk，绝不读 class_name。** ← 最容易翻车的坑，grill 曾退回错误方案，spec/issue 已纠正。

3. **类级 context 只有 has_method + implements，无 calls**（calls 是方法级的）。GraphExpander 裁剪 = has_method 数量上限 top-8，不做 edge_type 过滤。Controller incoming 通常空，价值在 outgoing。

4. **功能 2 需 GitNexus 1.6.9**。1.6.6 提取不出 Spring Route。1.6.9 验证 supplier-portal 0→210。

5. **1.6.9 新能力可用**：response-shapes.js（返回结构）、route_map/shape_check MCP 工具（现成映射，但**实际输出尚未验证**，在功能 2 前置门槛里验）、trace CLI（最短路径，功能 1 补充模式）、check 子命令。

---

## 设计要点速查

- **DocToSymbolResolver**：frontmatter sources → 类名（主）+ heading/text（补）+ 提不到则原样保留（兜底）。纯函数可测。
- **GraphExpander**：context 模式（类级 + has_method top-8）默认 + trace 模式补充。抽 parseContextResult / capMethods 纯函数测，CLI wrapper 不测。用 context 不用 impact。
- **ResultMerger**：分区不混排 `{hits, graph_context}`；graph_context 按 from_hit 分组（溯源链），edge_type 降为字段级。纯函数测。
- **ContractExtractor**：数据源优先级 route_map 工具 > Route 节点查询 > regex fallback。抽 parseRouteMapResult / normalizeEndpoints 纯函数测。
- **ContractMerger**：图谱（机械事实）优先，LM 补业务语义，冲突图谱赢。
- **EvalRunner**：queries.yaml 20 条起步（真实查询 + 核心 flow），三层判定（hits hit_rate+MRR / graph_context recall / verify_provenance 抽查），每条标 last_verified_commit 防过时。

## 测试分层

- 纯逻辑（ResultMerger/DocToSymbolResolver/ContractMerger/EvalRunner）+ wrapper 抽出的解析/裁剪/容错纯函数 → 单测
- wrapper CLI 调用本身 → 不测（= 测第三方）
- 编排层 hybrid-search.js → eval 端到端

---

## 下一步（进 implement 前）

1. **创建 3 个 GitHub issue**（issues.md 内容，用 gh CLI 或 web）。建议 Issue 1 补一条验收：DocToSymbolResolver 对真实 code + business 文档都能从 frontmatter sources 提类名、不依赖 class_name。
2. 走 `/implement` 按 Issue 1 → 3 → 2 顺序，内含 tdd + code-review。
3. 功能 2 开工前先跑前置门槛（重建目标仓图谱 + 验证 route_map 工具输出）。

## 教训

grill agent 不会实跑验证，多次基于源码表面推断出错（vector-search.js 的 undefined 死字段特别有迷惑性）。Hermes 侧"实测验证 + 验收"是这套流程的关键补位——每个 grill 假设都用真实 gitnexus/LanceDB 查询验证过再放行。
