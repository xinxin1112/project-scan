# project-scan

一个 Claude Code 技能，用于扫描代码库并生成结构化知识库，供下游 Claude Code Agent 消费。输出为 markdown 文件（非向量嵌入），AI 在进入项目时读取这些文件。

## 术语

**Knowledge Base (KB)**:
生成的产物：按层组织的每模块 markdown 文件，加上顶层 `INDEX.md`。存放在 `<output_dir>/<project>/kb/` 下。
_避免使用_：docs、knowledge graph、vector index

**Project**:
一个独立的 git 仓库，有自己的技术栈和构建系统（如 `pur-center`、`srm-web`、`supplier-portal`）。每个 Project 有独立的 KB 目录和向量库。多个 Project 通过 `scan-config.yaml` 的 `relations` 串联。
_避免使用_：repo（太泛）、workspace

**Module**:
Project 内独立作用域的单元（如 `pur-center` 下的 `pur-reconcile`、`pur-order`）。后端 Project 按 Module 生成四层 KB；前端 Project 按 App 生成。
_避免使用_：package、service、app（前端用 App 区分）

**KB Layer**:
四个固定分类之一，用于组织模块内生成的文档：`domain`、`contracts`、`flows`、`code`。每个文档恰好属于一个层。
_避免使用_：section、category、dimension

**Domain (layer)**:
关于*存在哪些数据以及数据如何变化*的文档：实体 DDL、枚举、状态机、业务规则。

**Contracts (layer)**:
关于*谁调用谁以及传递什么*的文档：内部服务 API、外部系统回调（第三方集成）。

**Flows (layer)**:
关于*业务流程步骤*的文档：带有输入/输出/异常/副作用的有序步骤。下游 Agent 首先读取的入口。

**Code (layer)**:
方法级索引，映射 `class.method` → 文件路径 → 行范围 → 职责。从文档回到实现的桥梁。

**Consumer**:
读取生成的 KB 以理解项目的下游 Claude Code Agent（或人类 + AI）。不要与调用 `/project-scan` 的用户混淆。

**Search subcommand**:
`/project-scan search <query>` — 对生成的 KB 进行向量检索的功能。相对于 KB 生成是次要的；为同一 Consumer 提供临时查询服务。

## 关系

- 一个 **Module** 在其 `kb/` 目录下拥有一个 **Knowledge Base**
- 一个 **Knowledge Base** 包含按四个 **KB Layers**（`domain`、`contracts`、`flows`、`code`）分组的文档
- 仓库根目录有一个 **`INDEX.md`**，提供跨模块视图（如"所有模块的所有状态机"）
- 一个文档恰好属于一个 **KB Layer**，但可以引用其他层的文档
- **Consumer** 通过 `CLAUDE.md` 进入 → 先读 **Flows**，然后按需深入 **Domain** / **Contracts** / **Code**

## 对话示例

> **用户：** "我想修改 CDN 用量对账的工作方式。我应该先看哪里？"
> **技能（通过生成的 KB）：** "打开 `pur-reconcile/kb/flows/cdn-usage-reconcile.md` — 那里给出了步骤和异常。从步骤 3 你会看到对 `domain/bill-reconcile.md` 实体的引用，步骤 4 引用了 `contracts/external/sys-api.md` 的 SYS 回调。实现入口在 `code/method-index.md`。"

## 锁定的设计决策

- **组织结构：`module/kb/{domain,contracts,flows,code}/`** — 按模块的知识库，内部分层。仓库级 `INDEX.md` 提供跨模块视图。
- **扫描时的层路由：先路径 glob，再 LM。** 80% 的文件通过路径模式路由（如 `**/controller/**` → `contracts/internal/`）。Service 层文件和模糊类型由 LM 判断。单个源文件可能在多个层中产生文档（如 `BillReconcileServiceImpl` → 状态机 + 规则 + method-index）。
- **Flows 生成：PRD + 状态机 + 代码调用图，优雅降级。** 三个来源都存在时合并；回退到状态机 + 代码，再回退到仅代码。对每个重要入口点始终生成*某些内容*。
- **Flow 文档分两个层次。** 层次 1（纯脚本）：调用链 + 事务/异步注解标注，机械提取，`flow-generator.js` 生成。层次 2（LM 辅助）：条件分支 + 异常码 + 事务边界 + 决策点表 + 入参类型，需要 LM 读 Service 方法体后输出结构化文档。层次 2 通过 `flow-level2-builder.js` 构建 prompt，由 `incremental.js --auto-lm` 触发重生成。层次 2 文档通过 `## 条件分支流程` heading 识别。核心方法（submit/confirm/cancel 等）优先做层次 2。
- **调用图深度 = 2。** 追踪 `Controller → Service → (Mapper | Client | 兄弟 Service)`。Mapper 和外部客户端标记引用，不展开。
- **Flow 生成触发条件。** 当 Controller 方法调用 ≥2 个不同的 Service/外部 Client 或触发状态机转换时，成为一个 flow。
- **CLAUDE.md 格式：索引 + 每个文档一行摘要，顶部加"入口 flow"指针。** 摘要来自每个文档的 frontmatter。
- **增量更新：frontmatter `sources` 反向索引。** 每个 KB 文档记录构建它的源文件 + 扫描时的 commit。对这些 commit 执行 `git diff` 可以精确告诉扫描器哪些文档需要重新生成。
- **`sources` 仅记录直接读取。** flow 文档记录它实际遍历的 Controller/Service；它仅标记的 Mapper 不在 `sources` 中。副作用：Mapper 变更不会使 flow 文档失效 — 只影响 `code/method-index.md`。已接受的权衡。
- **`code/method-index.md` 每个模块一个文件**，按类分节。不是每个类一个文件。
- **Frontmatter 最小化：5 个字段。** `kb_layer`、`summary`、`sources`、`last_scan_commits`、`stale`（布尔值，默认 false）。可选伴随字段：`stale: true` 时的 `stale_reason`；人工修改文档正文时的 `human_edited: true`。没有 `doc_type`，没有 `(certainty, complexity)`，没有 `related_entities` / `related_flows`。理由：Consumer（Claude Code Agent）直接读取 markdown 链接和文本 — 它不解析 frontmatter 来导航。跨文档关系以 markdown 链接形式存在于文档正文中（单一事实来源）。`strategy_hint`（按 kb-knowledge-base 文档 §4）如果下游需要，可以仅从 `kb_layer` 派生。
- **`search` 子命令是辅助的，非核心。** 向量索引跟随生成器写入的内容 — 没有双集合、没有 Reranker、不返回 `strategy_hint`、没有混合搜索。README 将 `search` 降级为"补充"部分。现有 `vector-search-v2/plan.md` 条目拆分为：(a) 与生成器对齐的（保留并合并到生成器轨道），(b) 纯搜索质量的（暂停）。参见 `docs/adr/0001-search-as-auxiliary.md` 的 v2-plan 分类。
- **KB 物理位置：独立目录，不在任何 git 仓库内。** 路径由 `scan-config.yaml` 的 `output_dir` 配置（如 `/Users/a6667/bilibili/project-scan/`）。按项目分子目录（`<output_dir>/<project>/kb/`）。不污染项目仓库，不影响团队成员。扫描源仍在 `<output_dir>/.sources/<repo>/`（用户在此运行 `git pull <main-branch>`）。不再修补项目仓库的 `CLAUDE.md`。
- **`scan-config.yaml` 是项目配置的唯一来源。** 脚本本身不含任何项目名/路径/字段名。所有项目特定信息（源码路径、分支、模块列表、DB 连接、项目间关系、前端 app 列表、字典文件路径、状态枚举路径）都从此文件读取。首次运行 `/project-scan setup` 时交互式生成。后续手动编辑。
- **KB 反映主分支快照，而非当前功能分支。** 技能扫描用户拉取到技能副本中的主分支（`release_prd` 或等效分支）。当 Consumer Agent 在功能分支上时，KB 被视为稳定基线 + Agent 读取 `git diff` 获取增量。frontmatter `last_scan_commits` 记录主分支 commit，以便 Consumer 知道 KB 版本。
- **新鲜度模型：定时器 + 引用时间检查的 AND 条件，12 小时阈值，静默自动更新。**
  - 定时任务每 12 小时运行 `git fetch origin <main-branch>`。
  - 当 Agent 引用 KB 且上次新鲜度检查超过 12 小时时，技能同步触发 `git fetch`，如果 commit 有分歧则运行增量更新，然后继续。
  - 静默流程中**无交互提示** — 自动拉取、自动更新。如果用户在功能分支上且与 main 有分歧，技能跳过自动更新并保留之前的主分支快照（保持 Consumer 对"稳定基线"的预期）。
  - 获取/更新失败时，Consumer 继续使用现有 KB。frontmatter 标注 `stale` 标记，以便 Agent 在回答中包含警告。
  - 显式 `/project-scan check` 是唯一提示用户的路径 — 这是用户主动的"我想管理 KB 状态"命令。
- **基于 KB 构建的回答包含版本水印。** 当 Consumer Agent（Claude Code 或未来产品问答）引用 KB 时，附加 `(KB version: <commit>, last update: <time>)`。如果 KB 过期（距上次成功的主分支同步超过 24 小时），Agent 额外显示 `"此回答基于 N 天前的 KB；如果关键请对照最新代码验证"`。防止在 KB 可能滞后的测试/预发环境中产生错误信息。
- **跨模块调用建模为被调用方的入站契约。** 当模块 A 的代码调用模块 B 的 `OrderService.markOrderPaid()` 时，扫描在 `pur-order/kb/contracts/internal/inbound.md` 中添加条目（每个被调用模块一个文件，按调用方分节）。模块 A 的 flow 文档链接到此节，而非直接链接到模块 B 的代码。
- **跨模块 flow 放置：写在驱动模块中。** 拥有入口 Controller 的模块拥有 flow 文档。跨模块步骤使用指向入站契约的链接，不内联展开被调用方的逻辑。例外：没有单一驱动者的事件驱动 / MQ flow 放在仓库根目录的 `kb/cross-module-flows/` 目录中。
- **`inbound.md` 的 `sources` 包含双方。** 调用方的源文件和被调用方暴露的方法都被追踪。任一方变更都会使入站契约文档失效。权衡：更频繁的重新生成，但任一方的签名漂移都会被捕获。
- **扫描期间循环跨模块调用标记为警告。** 不阻止、不自动修复 — 在 `INDEX.md` 中显示为 `"架构异味：检测到 A 和 B 之间的循环依赖"`。这是架构关注点，与 KB 正确性无关。
- **跨项目串联通过 `scan-config.yaml` 的 `relations` 配置 + 自动生成的拓扑/映射文档实现。** 每个 Project 有独立的 KB 和向量库；跨项目关联靠：(1) `system-topology.md` 全局拓扑图（从 relations 自动生成），(2) `frontend-backend-map.md` 前后端路由总表，(3) 各前端 app 的 `backend-mapping.md` 函数级映射（自动匹配前端函数名 → 后端 flow），(4) `unified-search.js` 跨项目向量搜索（遍历所有项目的 `.vector-store`，合并排序返回 top-K）。不合并向量库 — 各项目独立更新不互相影响。
- **GitNexus 知识图谱作为影响分析层集成到 project-scan 流程。** 用途：改接口前评估影响面 + 重构前查调用方。不替代 KB 和向量库，而是叠加。数据存 `.sources/<project>/.gitnexus/`（GitNexus 默认行为，在被索引的 repo 根目录下创建，约 963MB/项目）。3 个项目都索引（后端 + 前端 + 网关）。不用 MCP，跟向量库一样用脚本直接查。更新策略：`/project-scan update` 时 `npx gitnexus analyze --index-only`（commit 没变 1.5s 跳过，变了全量重建 ~2.5 分钟）。子命令：`/project-scan graph`（构建）、`/project-scan graph --impact=X`（查询）、`/project-scan graph --web`（Web UI）。
- **SKILL.md 单体文件暂时保留。** 75KB 单文件目前不是瓶颈。拆分为 `templates/prompts/*.md` 是 P3，推迟到主线重设计（KB 结构、frontmatter、新鲜度）落地后。重设计后重新评估大小 — 当前许多 Phase 内容可能会缩减。
- **自验证是程序化的，非基于 LM。** 扫描完成后，`scripts/verify.js` 运行三项覆盖率检查：(1) 实体文档字段集 vs DDL 字段集，(2) 契约文档端点列表 vs `@RequestMapping` 注解集，(3) method-index 方法列表 vs 源文件公共方法集。输出：`<repo>/kb/verify-report.md`，包含覆盖率百分比和差距列表。没有基于 LM 的语义验证 — 单 Agent 自审查是已知的反模式（记录在 kb-knowledge-base 文档 §5 多 Agent 理由中）。
- **Flow 验证较弱，这是设计意图。** 只运行一项 flow 检查：flow 步骤中提到的状态转换 vs 源码中的 `setStatus()` 调用。步骤数和源完整性检查的误报率太高。Flow 差距以警告形式显示，而非错误。
- **`--fix-coverage` 子命令存在但有针对性。** 读取 `verify-report.md`，仅重新生成被标记为有覆盖率差距的文档。不尝试修复语义不匹配（LM 用相同提示重新生成可能产生相同差距）。对于语义问题，报告将受影响的文件指向人类用户进行手动审查。
- **v1 → v2 迁移：备份后清理，无提示。** 首次 v2 运行检测到现有 `<repo>/ai/`，将其移动到 `<repo>/ai.v1-backup-<timestamp>/`，删除 `<repo>/.scan-state.json`，然后生成全新的 `<repo>/kb/` 和新状态。用户看到信息消息但不被要求确认。验证 v2 输出后用户手动 `rm -rf` 备份。理由：真正的 `rm -rf ai/` 会销毁任何手动编辑的内容（按 kb-driven §6.2"知识自动演进"，KB 预期接收人工编辑）。`mv` 与 `rm` 的用户体验相同但可逆。备份路径自动 gitignore（如果不存在则添加到 `.gitignore`）。
- **版本升级到 2.0.0。** 输出结构（`ai/` → `kb/`）和组织方式（按角色 → 按层）都发生变化。按 SemVer 为破坏性变更。
- **验证基准：先 pur-reconcile 单模块，再 pur-center 全多模块回归。** 单模块循环快速（约 1 分钟/次），用户对领域足够熟悉，能立即发现语义错误。全仓库回归覆盖跨模块契约生成、INDEX.md 和 verify-report 覆盖率。前端（srm-web）集成推迟到两个后端阶段通过后。
- **人工编辑在重新生成时被保留。** 当 Consumer 或用户手动编辑生成的 KB 文档时，重新生成器检测到变更（正文哈希与 `last_scan_commits[*].body_hash` 不同）并且 (a) 自动在 frontmatter 中设置 `human_edited: true`，或 (b) 在 `update` 期间跳过该文档。`--force` 覆盖。这是 kb-driven §6.2"知识自动演进"的技术补充 — KB 随时间接收人工编辑，工具不得销毁它们。
- **`method-index.md` 内容机械构建，摘要通过批量 LM。** 方法名、文件路径、行范围、类归属来自 AST/正则解析 — 从不来自 LM（LM 的行号会产生幻觉）。只有一行"职责"摘要使用 LM，以 10-50 个方法为一批。这避免了要求 LM 一次性写出 1000 行索引的失败模式。
- **层路由规则是语言特定的。** v2 附带完整的 Java/Spring 路由规则。其他语言（Vue/React/Go/Python/Rust）为降级模式：扫描仅生成 `code/method-index.md`，不生成 `domain` / `contracts` / `flows` 层，直到每语言的 ROUTING 模板在 v2.x 中发布。README 必须反映此范围。
- **入站契约折叠为每个被调用模块单个 `inbound.md`**，按调用方分节。不是每个 `inbound-from-X.md` 一个文件。避免核心模块被多方调用时文件数量爆炸。
- **术语表位于仓库根目录，不在任何单个模块中。** `<repo>/kb/glossary.md` 是所有模块共享的业务词汇 — kb-driven §1"共享全局认知"。由 INDEX.md 作为第一个引用加载。
- **共享层（pur-common）的枚举/常量放 `kb/shared/domain/enums/`，不归属任何单一模块。** 各模块 CLAUDE.md 用相对链接引用共享枚举。模块自己的枚举（如 `pur-reconcile/srm/enums/`）仍放 `kb/<module>/domain/enums/`。判定规则：源文件在 `pur-common` 或其他共享包下 → shared；源文件在模块自己的包下 → module。
- **跨系统知识用 `kb/external-systems/` 手动维护。** 外部系统（规则引擎、Flow 审批、结算系统等）的接口契约和配置说明放在此目录，每个系统一份文档。这些文档 `human_edited: true` 始终为 true（永远手写），frontmatter `sources` 为空（无代码可扫）。模块 flow 文档中跨系统步骤用链接指向对应的外部系统文档。不尝试扫描外部系统代码 — 80% 的跨系统知识是接口契约 + 运营配置，一份 50 行 markdown 的 ROI 远高于写解析器。
- **不再修补项目仓库的 CLAUDE.md。** KB 在独立目录，Consumer Agent 通过直接读取 `<output_dir>/<project>/kb/INDEX.md` 获取入口，不依赖项目仓库内的指针。版本水印和 stale 警告由 Consumer Agent 自行从 frontmatter 读取 — 不需要注入系统指令。
- **第 5 类文件存在："仅索引，无文档"。** 常量、配置、工具类（`*Constants.java`、`application.yml`、`*Utils.java` 等）记录在 `code/method-index.md` 中，但不产生独立的 markdown 文档。它们不适合四个 KB Layer，膨胀文档数量对 Consumer 没有价值。
- **PRD ↔ 代码绑定：默认向量召回，`prd-mapping.yaml` 作为覆盖。** 当 flow 生成器需要将 Controller 方法与 PRD 内容配对时，它 (a) 从方法名 + Service 调用链构建查询，(b) 从向量存储中召回 top-3 PRD 片段，(c) 传递给 LM。发现错误配对的用户在 `<repo>/kb/prd-mapping.yaml` 中添加条目（`{ prd_section, prd_file, driving_method }`）— 条目存在时覆盖召回。默认自动；手动映射是例外。模式匹配 kb-knowledge-base §4.4 动态策略注入。
- **PRD 文件作为 `sources` 被追踪在消费它们的任何 KB 文档中。** 没有单独的 PRD 哈希机制。frontmatter `sources` 反向索引（决策 7）是唯一的追踪层 — 当 PRD 文件路径出现在 flow 的 `sources` 中时，PRD 变更时该 flow 会被重新生成（非 git 管理的 PRD 文件用 mtime 检查；git 追踪的用 `git diff`）。将 PRD 更新传播免费接入现有增量机制。
- **代码与 PRD 不一致时，代码是事实来源。** Flow 生成器从代码（调用图 + 状态机）构建结构骨架；PRD 仅提供命名和业务上下文。如果验证检测到 PRD 陈述的事实与代码矛盾（如 PRD 说"差异 < 5 元时自动匹配"但代码守卫是 `diff < 1`），`verify-report.md` 记录冲突警告。解决是人类决策（修复代码、修复 PRD，或在 `prd-mapping.yaml` 中注释为已知分歧）。KB 永远不会静默地将 PRD 的声明覆盖代码的实际行为。

## 标记的歧义

_（当前无 — 所有歧义已在上述锁定决策中解决）_
