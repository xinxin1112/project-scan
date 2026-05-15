# project-scan v2 — 实施计划

**权威来源：** `CONTEXT.md`（32 条锁定决策）+ `docs/adr/0001..0005`
**验证门禁：** Q15 fixture — 先通过 pur-reconcile 单模块验证，再进行 pur-center 全仓库回归。

---

## 如何阅读本计划

任务按阶段分组。阶段之间在边界层面是顺序执行的（不能在生成之前做验证），但阶段内部的任务可以并行。

每个任务标注：
- **涉及文件**：哪些文件/脚本
- **依赖**：依赖哪些其他任务
- **完成标准**：能证明其正常工作的最小可观测结果
- **决策链接**：CONTEXT.md 决策编号或 ADR

优先级：**P0** = 位于 v2 首次可运行的关键路径上；**P1** = v2 完成所必需；**P2** = 质量/健壮性；**P3** = 延后处理。

---

## Phase 0 — 骨架与状态模型 (P0)

目标：建立所有后续工作依赖的数据结构和入口路由。

| 任务 | 涉及文件 | 依赖 | 完成标准 | 决策 |
|------|---------|---------|------------|----------|
| **0.1 frontmatter writer** | `scripts/frontmatter.js`（新建） | — | 5 字段 frontmatter（`kb_layer`、`summary`、`sources`、`last_scan_commits`、`stale`）的往返读写。可选字段（`stale_reason`、`human_edited`）已处理。Body hash 计算工具。 | #10, #26 |
| **0.2 .scan-state.json v2 schema** | `scripts/state.js`（新建） | 0.1 | 新 schema 包含 `version: 2`、modules → kb-paths、repo paths。v1 检测例程。 | #13 |
| **0.3 SKILL.md v2 入口路由** | `skills/project-scan/SKILL.md` | — | 自动检测逻辑更新：检测到 v1 `ai/` → 触发迁移；检测到 v2 `.scan-state.json` → 多模块流程；新仓库 → 全新扫描。 | #23 |
| **0.4 按语言路由配置** | `templates/routing/java-spring.md`（新建） | — | Java/Spring 的路径 glob 表（Controller / Entity / Migration / Mapper / Service / Util）。其他语言使用降级路由，仅生成 `code/method-index.md`。 | #2, #28, ADR 0005 |

**Phase 0 结束时：** `/project-scan` 对空 fixture 运行无错误，并写出有效的（空）`kb/` 骨架 + `.scan-state.json` v2。

---

## Phase 1 — 核心生成器 (P0)

目标：从单个 Java/Spring 模块生成四个 KB 层。暂无 flows，暂无跨模块。

| 任务 | 涉及文件 | 依赖 | 完成标准 | 决策 |
|------|---------|---------|------------|----------|
| **1.1 Domain — entities** | 新生成器 | 0.1, 0.4 | 每个 `*Entity.java` / `*PO.java` + 对应 DDL 生成 `kb/<m>/domain/entities/<name>.md`，包含字段表、索引、frontmatter sources。 | #2 |
| **1.2 Domain — enums & rules** | 新生成器 | 1.1 | 枚举 → `domain/enums/`。规则决策表（触发时从 Service 中提取）→ `domain/rules/`。 | #2, #3 |
| **1.3 Domain — state machines** | 新生成器 | 1.1 | 检测 `setStatus()` 模式和迁移文件。生成 `domain/state-machines/<entity>-status.md`，包含转换、守卫条件、副作用。 | #3 |
| **1.4 Contracts — internal** | 新生成器 | 0.4 | 每个 Controller 生成 `kb/<m>/contracts/internal/<name>.md`，列出端点、请求/响应结构。 | #2 |
| **1.5 Contracts — external** | 新生成器 | 0.4 | 检测 `*Callback*` / `*Webhook*` / 出站 `*Client*` 类；生成 `contracts/external/<name>.md`，包含状态码、请求/响应。 | #2 |
| **1.6 Code — method-index** | 新生成器 | — | 每个模块一个 `kb/<m>/code/method-index.md`。**机械提取**方法名 + 文件路径 + 行范围 + 类。**LM 按 10–50 批次**仅生成单行职责摘要。 | #9, #27 |
| **1.7 第 5 类跳过规则** | 共享过滤器 | 0.4 | Constants / configs / utils 记录在 method-index 中但不生成独立文档。 | #32 |

**Phase 1 结束时：** 对 pur-reconcile（单模块），`kb/pur-reconcile/{domain,contracts,code}/` 已填充并通过语法验证（frontmatter 可解析、无损坏的 markdown）。Flows 仍缺失。

---

## Phase 2 — Flows + 跨模块 (P0)

目标：三路融合，生成最有价值的层。

| 任务 | 涉及文件 | 依赖 | 完成标准 | 决策 |
|------|---------|---------|------------|----------|
| **2.1 调用图构建器 (depth=2)** | 新分析器 | 0.4 | 静态分析生成 `Controller → Service → (Mapper / Client / 兄弟 Service)` 图。Mapper 和外部 Client 标记但不展开。 | #4 |
| **2.2 Flow 触发检测器** | 使用 2.1 | 2.1 | 当且仅当 Controller 方法满足以下条件时标记为需要生成 flow：≥2 个不同的 Service/Client 或触发状态机转换。 | #5 |
| **2.3 Flow 生成器 — 降级链** | 新生成器 | 2.1, 2.2, 1.3 | 对每个被触发的 Controller 方法：尝试（PRD + 状态机 + 调用图）→ 回退到（状态机 + 调用图）→ 回退到（仅调用图）。始终生成文档。 | #3 |
| **2.4 跨模块调用检测** | 使用 2.1 | 2.1 | 识别目标类位于另一模块的调用点。标记该调用。 | #16 |
| **2.5 入站契约生成器** | 新生成器 | 2.4 | 每个被调用模块获得一个 `contracts/internal/inbound.md`，按调用方分节。Sources 包含双方。 | #16, #17, #18, #29 |
| **2.6 跨模块 flow 放置** | flow 生成器扩展 | 2.3, 2.4 | Flow 放在驱动模块（入口 Controller 所有者）中。跨模块步骤链接到 inbound 节。事件驱动的 flow 放在仓库根目录的 `kb/cross-module-flows/`。 | #17 |
| **2.7 循环依赖警告** | 使用 2.1 | 2.1 | 调用图上的环检测；在 INDEX.md 中作为架构异味展示。非阻塞。 | #19 |

**Phase 2 结束时：** pur-reconcile 生成 `flows/` 内容。如果 pur-reconcile 调用了另一个模块，被调用方会出现 `inbound.md`。"CDN 用量对账"的 flow 文档端到端存在。

---

## Phase 3 — 物理放置、导航、新鲜度 (P0)

目标：将 KB 从 skill 副本放入真实开发仓库并保持其新鲜。

| 任务 | 涉及文件 | 依赖 | 完成标准 | 决策 |
|------|---------|---------|------------|----------|
| **3.1 v1 → v2 首次运行迁移** | `scripts/migrate.js`（新建） | 0.2 | 检测 `<repo>/ai/`，执行 `mv ai/ ai.v1-backup-<ts>/`，删除旧 `.scan-state.json`，将 `ai.v1-backup-*/` 添加到 `.gitignore`。仅输出信息提示。 | #23, ADR 0003 |
| **3.2 输出路径：真实开发仓库** | 路径解析器 | — | KB 写入 `<dev-repo>/kb/`，而非 skill 工作区。通过用户配置或约定检测开发仓库（待定：提示用户一次，存入 `.scan-state.json`）。 | #12 |
| **3.3 术语表生成器** | 新生成器 | 1.1 | 仓库根目录的 `<repo>/kb/glossary.md`，如果存在 PRD/CONTEXT.md 则从中填充，否则为空桩。 | #30 |
| **3.4 INDEX.md 生成器** | 新生成器 | 1.1, 1.4, 2.3 | 仓库根目录的跨模块索引。章节：术语表链接、模块表、所有状态机、所有 flow、循环依赖警告。 | #1, #19 |
| **3.5 `<module>/CLAUDE.md` 生成器** | 新生成器 | 3.4 | 每模块 CLAUDE.md：顶部入口 flow 指针，层章节包含来自 frontmatter 的单行摘要。 | #6 |
| **3.6 `<repo>/CLAUDE.md` 补丁** | 新生成器 + opt-out 标志 | 3.4 | 追加 `<!-- KB START -->...<!-- KB END -->` 块：链接到 INDEX.md + 消费者行为指令（引用水印、过期警告）。`--no-instruction-injection` 跳过该指令。 | #31 |
| **3.7 12h 定时拉取** | 改造 `scripts/auto-update.js` | 0.2 | 复用现有 launchd/Task Scheduler 集成；调整为 12h 间隔；在 `setup-auto-update.js` 中按操作系统安装。 | #14, ADR 0002 |
| **3.8 引用时新鲜度检查** | `scripts/freshness.js`（新建） | 3.7 | 在任何 KB 读取前运行的钩子：如果上次拉取 >12h，执行 `git fetch origin <main>`；如果 commit 有分歧，运行 `update`；失败时标记 frontmatter `stale: true`。Feature 分支分歧时跳过自动更新。 | #14, #15, ADR 0002 |
| **3.9 `/project-scan check` 交互提示** | SKILL.md | 3.8 | 用户主动触发的显式路径，会提示确认；静默路径则不会。 | #14 |

**Phase 3 结束时：** pur-reconcile fixture 将完整 KB 写入 `/Users/a6667/bilibili/pur-center/kb/pur-reconcile/`，补丁开发仓库的 CLAUDE.md，调度 12h 拉取器。

---

## Phase 4 — 验证与增量更新 (P1)

目标：保持 KB 的准确性并降低维护成本。

| 任务 | 涉及文件 | 依赖 | 完成标准 | 决策 |
|------|---------|---------|------------|----------|
| **4.1 覆盖率验证器** | `scripts/verify.js`（新建） | 1.1, 1.4, 1.6 | 三项检查：entity 文档字段 ⊇ DDL 字段；contract 文档端点 ⊇ `@RequestMapping` 集合；method-index ⊇ public 方法集合。 | #20 |
| **4.2 Flow 状态转换检查** | `scripts/verify.js` | 1.3, 2.3 | Flow 中提到的转换 ⊆ 实际 `setStatus()` 调用。易误报的检查（步骤数、source 完整性）不包含在内。 | #21 |
| **4.3 verify-report.md** | `scripts/verify.js` 输出 | 4.1, 4.2 | `<repo>/kb/verify-report.md`，包含覆盖率百分比、缺口列表、建议修复命令。 | #20 |
| **4.4 `--fix-coverage` 子命令** | SKILL.md + 调度器 | 4.3 | 读取报告，仅重新生成被标记的文档。不尝试语义修复。 | #22 |
| **4.5 Body-hash 检测** | 使用 0.1 | 0.1 | `update` 时计算当前 body hash 并与 `last_scan_commits[*].body_hash` 比较。如果不同 → 人工编辑过。 | #26, ADR 0004 |
| **4.6 `human_edited: true` 自动设置 + 跳过** | 重新生成器行为 | 4.5 | 首次检测：设置标志。后续运行：即使 sources 变更也跳过。`--force` 覆盖；verify-report 记录计数。 | #26, ADR 0004 |
| **4.7 sources 反向索引更新** | 重新生成器 | 0.1 | `git diff` 对比 `last_scan_commits` → 变更文件列表 → 匹配每个文档的 `sources` → 需要重新生成的过期文档集合。 | #7, #8 |

**Phase 4 结束时：** 在 pur-reconcile 代码变更后运行 `/project-scan update` 仅重新生成受影响的文档（3-5 个文件，而非整个模块）。手工编辑的文档在 `update` 中存活。

---

## Phase 5 — 搜索子命令分流 (P1)

目标：保持搜索功能可用，但不投入检索质量相关的特性开发。

| 任务 | 涉及文件 | 依赖 | 完成标准 | 决策 |
|------|---------|---------|------------|----------|
| **5.1 自定义 OpenAI 兼容 API** | `scripts/embed.js` | — | 支持 `EMBEDDING_BASE_URL`、`EMBEDDING_MODEL` 环境变量。（v2-plan 1.1） | ADR 0001 kept list |
| **5.2 中文 token 估算修复** | `scripts/embed.js` | — | 检测语言比例；当中文占主导时使用 1.5 字符/token。（v2-plan 1.2） | ADR 0001 kept list |
| **5.3 Ollama 批量并发** | `scripts/embed.js` | — | 5–10 个并行请求；或升级到 `/api/embed` 批量端点。（v2-plan 1.3） | ADR 0001 kept list |
| **5.4 .xml / .sql 文件类型** | `scripts/vector-index.js` | — | 索引器接受 MyBatis XML 和迁移 SQL。（v2-plan 2.1） | ADR 0001 kept list |
| **5.5 向量存储中的 `kb_layer` 元数据** | `scripts/vector-index.js` | 0.1 | 索引器读取 frontmatter `kb_layer` 并将其存储为过滤列。（v2-plan 2.4） | ADR 0001 kept list |

**明确不做（按 ADR 0001 暂停）：** v2-plan 条目 2.2、2.3、2.5、2.6、3.1–3.7。它们保留在 `.scratch/vector-search-v2/plan.md` 中供未来重新审视。

---

## Phase 6 — Fixture 验证 (P1)

目标：证明 v2 确实能在用户实际拥有的项目上工作。

| 任务 | 涉及文件 | 依赖 | 完成标准 | 决策 |
|------|---------|---------|------------|----------|
| **6.1 pur-reconcile 单模块运行** | 端到端 | Phases 1–5 | 仅对 pur-reconcile 进行完整扫描，生成完整的 `kb/pur-reconcile/`，verify-report ≥ 90% 覆盖率，人工审查 `flows/cdn-usage-reconcile.md` 与用户对该功能的心智模型一致。 | #25 |
| **6.2 pur-center 多模块回归** | 端到端 | 6.1 | 对 pur-center 进行完整扫描：跨模块入站契约出现，INDEX.md 跨模块视图正常渲染，循环依赖（如有）作为警告展示，记录文档数量用于粒度校准。 | #25 |
| **6.3 粒度校准** | flow 触发器 / entity 合并调优 | 6.2 | 如果 6.2 生成 >1500 个文档，调整 flow 触发阈值并考虑 entity 合并。将调优记录在 ADR 0001 已知限制后续中。 | ADR 0001 KL §3 |
| **6.4 多模态 PRD 抽查** | 手动 | 6.1 | 将 PNG / PDF / docx PRD 放入 `pur-reconcile/prd/`，扫描，确认 flow 文档获取了内容。如果失败，记录在 ADR 0001 已知限制中。 | ADR 0001 KL §1 |
| **6.5 新鲜度往返测试** | 手动 | Phase 3 | 在 `release_prd` 上做代码变更，推送，等待 12h 定时器或触发引用时检查，确认 KB 更新且 verify-report 重新生成。 | ADR 0002 |
| **6.6 迁移冒烟测试** | 手动 | 3.1 | 对存在 v1 `ai/` 的 fixture 运行 v2。确认 `ai.v1-backup-<ts>/` 出现，gitignore 已补丁，全新 `kb/` 已生成。 | ADR 0003 |

---

## Phase 7 — 打磨与发布 (P2)

| 任务 | 涉及文件 | 依赖 | 完成标准 | 决策 |
|------|---------|---------|------------|----------|
| **7.1 README 重写** | `README.md` | Phase 6 | 技术栈表措辞软化（Java/Spring 完整支持，其他语言获得 method-index，完整分层在 v2.x 路线图中）。搜索降级为"补充"章节。v1→v2 迁移说明靠近顶部。 | ADR 0005 |
| **7.2 ADR 交叉链接** | `docs/adr/*.md` + CONTEXT.md | — | CONTEXT.md 中的决策引用其所属 ADR。ADR 之间在相关处互相引用（如 0004 引用 0002）。 | — |
| **7.3 `package.json` 版本升级** | `package.json` | Phase 6 | 版本 → 2.0.0。 | #24 |
| **7.4 变更日志章节** | `README.md` 或 `CHANGELOG.md` | 7.3 | v2.0.0 亮点：按层 KB、真实仓库放置、新鲜度模型、人工编辑保留、v1 的破坏性变更。 | — |

---

## Phase 8 — 延后处理 (P3)

以下内容在 CONTEXT.md 或 ADR 中明确标记为"延后"：

- **SKILL.md 拆分为 `templates/prompts/*.md`**（#18）— 仅在重新设计稳定且文件没有自行缩小后进行。
- **按语言路由模板**（Vue/React/Go/Python/Rust 完整分层支持）— ADR 0005。
- **多模态 PRD 摄入端到端验证** — 目前是 ADR 0001 中的已知限制。
- **约束级验证**（NOT NULL、状态机守卫、异常码覆盖）— ADR 0001 已知限制。
- **文档粒度自动调优** — 超出 6.3 中手动校准的范围。

---

## 关键路径总结

在 pur-reconcile 上实现 v2 演示的最短链路：

```
0.1 frontmatter
  ↓
0.4 java-spring routing
  ↓
1.1–1.7（并行：entity / enum / state-machine / contract-internal / contract-external / method-index / 5th-class）
  ↓
2.1 call-graph
  ↓
2.2–2.7（flows + 跨模块）
  ↓
3.1–3.6（放置 + glossary + INDEX + CLAUDE.md 补丁）
  ↓
6.1 pur-reconcile fixture 运行 ← 演示门禁
```

Phase 4（验证）、Phase 5（搜索分流）以及 Phase 3 的其余部分（新鲜度调度）可以在其依赖就绪后与关键路径并行运行。

---

## 我实际会先做什么

如果必须选一个任务明天开始：

**0.1 frontmatter writer。** 它是所有其他组件写入时依赖的基础；它很小（约 100 行）；它可以独立测试；而且这里的设计错误会波及每个生成器。先把 schema 做对，然后向外扩展。

0.1 之后：0.4（路由配置）和 1.6（method-index，它检验了机械提取与 LM 的分工）形成紧密的反馈循环。三天的工作能在任何 flow 生成器编写之前暴露 80% 的设计缺陷。
