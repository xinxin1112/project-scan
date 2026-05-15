# 0001 — search 子命令是辅助功能，不是核心能力

## 背景

`project-scan` 最初是一个知识库生成器（扫描代码 → 为下游 Claude Code Agent 编写 markdown）。后来在其上添加了向量搜索子命令（`/project-scan search`），带有自己的依赖栈（`@lancedb/lancedb`、`embed.js`、`vector-index.js`、`vector-search.js`）以及 `.scratch/vector-search-v2/plan.md` 中的活跃改进计划。

围绕 kb-driven 设计的 grilling 环节（见 `CONTEXT.md`）提出了一个问题：谁实际消费搜索结果？消费者是下游 Claude Code Agent——而该 Agent 直接读取 `CLAUDE.md` 和 `kb/` 文件，而非通过向量检索调用。`search` 的真正用户是进行临时查询的人类以及少量自动化场景。

## 决策

`search` 保留，但定位为**辅助功能**。生成器侧（markdown KB + `CLAUDE.md` 索引）是主要产品。

具体而言：

- 不再对纯检索质量特性进行新投入：
  - 不做双集合（一个用于代码，一个用于文档）
  - 不做 Reranker / Cross-Encoder 通道
  - 不在搜索结果中返回 `strategy_hint`
  - 不做混合搜索（向量 + 关键词）
- 向量索引被动跟踪生成器写入 `kb/` 的内容。
- README 降低 `search` 的优先级——从主命令表移至"补充能力"部分。

`vector-search-v2/plan.md` 中的条目经过分类：

**保留（与生成器目标一致）：**

- 1.1 自定义 OpenAI 兼容 API 端点——无论搜索/生成，内部模型访问都需要
- **默认嵌入模型：`BAAI/bge-m3`**（Ollama：`bge-m3`）。替换 v1 的 `nomic-embed-text`。理由：100+ 语言且中文为一等公民，8192-token 上下文（对比 nomic 的 2048），1024 维（对比 768），通过 Ollama 免费本地部署。适合本项目中英混合的代码 + 文档语料库。无云依赖——因为 Bilibili 内部模型目前不可用。
- 1.2 中文 token 估算修复——影响所有分块，包括 method-index 生成
- 1.3 Ollama 批量并发——加速索引构建以及未来使用嵌入的扫描
- 2.1 更多文件类型（.xml、.sql）——生成器必须读取 MyBatis XML 和迁移 SQL
- 2.4 `layer` 元数据——直接映射到新的 `kb_layer` frontmatter 字段

**暂停（纯搜索质量）：**

- 3.1 / 3.2 / 3.3 / 3.4 / 3.5 / 3.6 / 3.7（阈值、混合搜索、重排序、去重、跨层搜索、扩展上下文、更多过滤器）
- 2.2 Markdown 标题感知分块
- 2.3 分块上下文前缀
- 2.5 丰富元数据（annotations、arch_layer）
- 2.6 不截断文本存储

## 后果

- 该 skill 有明确的单一主要目的：生成结构化知识库。设计选择由此驱动。
- 后续反转（将 `search` 重新提升为一等功能）是可能的但代价高昂——暂停的 v2 条目届时需要根据当时的运行时上下文逐一重新评估。
- 为 `/project-scan search` 而来的用户得到一个可用但未改进的工具。如果需求增长，再重新审视。

## 带入 v2 的已知局限

这些不是"本 ADR 的 bug"——它们是 v2 明确不解决的已确认差距，推迟到 v2.x 或更远的版本：

- **多模态 PRD 摄入（PNG/JPG/PDF/docx）。** README 声称支持，Claude 的 Read 工具可以处理 PDF 和图片，但与 flow-generation 管线的集成尚未在 v2 中验证。`<repo>/<module>/prd/` 摄入路径需要在 Q15 fixture 阶段对非文本 PRD 进行显式测试。
- **约束级验证。** verify-report（ADR 尚未编写；见 CONTEXT.md "Self-verification"）仅检查覆盖率（字段集、端点集、方法集）。它不验证约束语义（NOT NULL、状态机守卫、异常码列表）。根据 kb-driven §4.2，"精度来自更严格的约束，而非更强的 AI"——完整约束验证是 P2 候选项，但需要更深入的 AST 分析。
- **文档粒度校准。** 粗略估算一个典型模块约有 ~76 个 markdown 文档（50 领域 + 10 契约 + 15 流程 + 1 代码索引）。对于 20 个模块的仓库，这超过 1500 个文档——INDEX.md 和消费者 Agent 的 token 预算可能受影响。kb-driven §7 明确标注"规格粒度仍在探索中"。Q15 fixture 阶段是首次校准机会。如果数量证明过高，触发阈值（flow-generation 规则、entity-doc 合并）将被重新调整。
- **PRD/代码权威模型。** 当 PRD 内容与代码事实不一致时（例如 PRD 说"差异 < 5元时自动匹配"但代码守卫是 `diff < 1`），KB 写入代码的实际行为。冲突在 `verify-report.md` 中作为警告浮现，而非静默解决。这意味着 KB 可能偏离 PRD——偏离是有意的且已标记。解决是人类决策：修复代码、修复 PRD，或在 `prd-mapping.yaml` 中将偏离标注为已知。未来工作：超越简单数值比较的自动化 PRD/代码漂移检测。
