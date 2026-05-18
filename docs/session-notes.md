# Grill 会话笔记 — project-scan v2 设计

**日期：** 2026-05-14
**技能：** `/grill-with-docs`
**输入：** `/Users/a6667/Desktop/从向量检索到智能 Agent：企业级知识库的设计实战.docx`（15 张图片 + 正文）+ `/Users/a6667/Desktop/kb-driven-dev-sharing.md`
**输出：** `CONTEXT.md`（21 条锁定决策）+ 5 份 ADR

---

## 如何使用本文件

这是产出 v2 设计的 grill 会话对话记录。`CONTEXT.md` 中每一条锁定决策都可追溯到本文件中的某一轮问答。当你日后想知道"为什么我们决定了 X？"时——请按问题编号在本文件中搜索，而不是在 CONTEXT.md 中按关键词搜索（决策表述简洁；理由存在于对话中）。

每轮格式：
- 我提出的**问题**（压缩版）
- 我给出的**选项** + 我的推荐
- **用户回答**（包括与我推荐的偏差）
- **结果**（锁定了什么，附 CONTEXT.md 或 ADR 的链接）

---

## 第 1 轮 — 主要消费者

**Q1.** 谁消费生成的知识库？
**选项：** A) 下游 Claude Code Agent / B) `search` 子命令 / C) 两者兼有。
**我的推荐：** A。
**用户回答：** A — "Claude Code Agent，hermes 来辅助扫"（最初提到 hermes 作为辅助扫描器；后来撤回）。
**结果：** 消费者 = Claude Code Agent。知识库是供 AI 在进入项目时阅读的 markdown，而非运行时问答检索系统。

---

## 第 2 轮 — hermes 角色（已取消）

**Q2.** Hermes 是什么？（原始模型网关 vs 独立扫描器 vs 第二个 Agent）
**用户回答：** "你忘掉hermes 就当只有claudecode" — Hermes 被移除，唯一执行者 = Claude Code。
**结果：** 全程单 Agent 设计。v2 中无多 Agent 协作。

---

## 第 3 轮 — 目录布局

**Q3.** 四层知识库组织方式：按层顶级 vs 按模块顶级 vs 混合。
**选项：** A) 按层平铺 / B) 模块×层（深层嵌套）/ C) 模块内分层 + 全局 INDEX.md / D) 平铺仅用 frontmatter 区分。
**我的推荐：** C。
**场景探测：** "如果你在修改 pur-reconcile，你首先读哪个文档？" — 确认先读 `flows`。
**用户回答：** "按你推荐的"。
**结果：** 每个模块 `<module>/kb/{domain,contracts,flows,code}/` + 仓库级 `INDEX.md`。CLAUDE.md 以 flows 优先排序。→ CONTEXT.md 决策 1。

---

## 第 4 轮 — 扫描时的层路由

**Q4.** 扫描时如何决定文件归属哪一层？
**选项：** A) 硬编码路径 glob / B) 完全 LM 判断 / C) 先 glob 再 LM 处理歧义 / D) 先打标签再路由。
**我的推荐：** C。
**场景探测：** `BillReconcileServiceImpl`（800 行，状态机 + 规则 + 5 个方法 + 外部客户端）— 应产出 4 份文档（状态机、规则、合约引用、method-index 条目）。
**用户回答：** "按你推荐的"。
**结果：** 先路径 glob（覆盖约 80% 文件），再 LM 处理 Service/Util/歧义文件。一个源文件可能在多个层产出多份文档。→ CONTEXT.md 决策 2、3。

---

## 第 5 轮 — flows 生成

**Q5.** 流程文档从哪里来？PRD / 状态机 / 调用图 / 融合。
**选项：** A) 仅 PRD / B) 仅调用图 / C) 仅状态机 / D) 三者融合并支持降级。
**我的推荐：** D。
**探测并接受的子决策：**
- 调用图深度 = 2（Controller → Service → Mapper/Client/兄弟 Service；Mapper 和外部 Client 打标签但不展开）
- 触发条件：≥2 个不同的 Service/Client 或触发状态机转换
**用户回答：** "d"。
**结果：** PRD + 状态机 + 代码调用图，降级链。→ CONTEXT.md 决策 3、4、5。

---

## 第 6 轮 — CLAUDE.md 详细程度

**Q6.** `<module>/CLAUDE.md` 应该是纯索引、索引+摘要，还是更丰富？
**选项：** A) 纯链接 / B) 索引 + 一行摘要 + 入口流程指针 / C) 嵌入关键事实 / D) 完整内容（无 kb/ 子文件）。
**我的推荐：** B。
**入口流程选择规则：** 模块名匹配 > 被引用最多 > 步骤最长 > 跳过。
**用户回答：** "你推荐什么呢" → 我重述了 B。隐式接受。
**结果：** 索引 + frontmatter 摘要 + 顶部入口流程。→ CONTEXT.md 决策 6。

---

## 第 7 轮 — 增量更新

**Q7.** 如何检测"此知识库文档已过时"？
**选项：** A) 全量重扫 / B) frontmatter `sources` 反向索引 / C) 按层重新生成 / D) 内容指纹。
**我的推荐：** B。
**子决策：**
- `sources` 仅记录直接读取 — Mapper 变更不会使流程文档失效（仅影响 method-index）
- `code/method-index.md` 每个模块一个文件，按类分节
**用户回答：** "好的 按你推荐的"。
**结果：** frontmatter `sources` + `last_scan_commits`，Mapper 变更作为流程失效的已知缺口被接受。→ CONTEXT.md 决策 7、8、9。

---

## 第 8 轮 — frontmatter 模式

**Q8.** 最小集 vs 实用集 vs 完整集。
**选项：** A) 4 个字段 / B) 7 个字段含关联 / C) 10+ 含确定性/复杂度。
**我的推荐：** A — 仅 `kb_layer` / `summary` / `sources` / `last_scan_commits`。
**关键推理：**
- `doc_type` 被拒绝 — kb-doc §4 四象限图（image10）分类的是*问题*，不是*文档*
- `(certainty, complexity)` 同理被拒绝
- `related_*` 被拒绝 — markdown 正文链接是唯一真实来源
**用户回答：** "你推荐什么呢 列出所有问题 来我一次性check" → 我列出所有问题；用户回复"按你推荐的来"。
**结果：** 4 字段最小 frontmatter。（后在 grill 后审查中扩展为 5 字段 — 见下方"Grill 后审查 #1"。）→ CONTEXT.md 决策 10。

---

## 第 9 轮 — search 子命令的命运

**Q9.** 保留 / 砍掉 / 双轨并行 `/project-scan search` 能力。
**选项：** A) 砍掉 / B) 降级为辅助 / C) 并行投入。
**我的推荐：** B。
**对 `vector-search-v2/plan.md` 条目的分类："保留"（1.1、1.2、1.3、2.1、2.4）和"暂停"（3.x 及 2.2/2.3/2.5/2.6）。**
**用户回答：** "按你推荐的来"。
**结果：** Search 降级，ADR 0001 已编写。→ CONTEXT.md 决策 11；ADR 0001。

---

## 第 10 轮 — 知识库物理位置（最大转折点）

**Q10.** 生成的知识库存放在哪里？
**初始选项：** A) 仓库外的工作区 / B) 源仓库内 `<repo>/kb/` / C) 仓库内但 gitignore / D) 可配置。
**我的初始推荐：** B。
**用户澄清使用模型：** "本地在project-scan里面放入项目然后拉取远端的主分支 每次更新都是主分支的" — 用户在技能目录下保留目标项目的副本，在那里运行 `git pull origin <main>`，从那里扫描。真正的开发工作在别处进行。
**重新推荐：** A1（知识库反映主分支快照，写入真实开发仓库）。
**用户进一步澄清：** "AI 永远在真实生产仓库" — 消费者 Agent 始终运行在真实开发仓库中。
**结果：** 知识库物理存放在真实开发仓库（`/Users/a6667/bilibili/pur-center/kb/`），从技能目录副本生成。`<repo>/CLAUDE.md` 在标记区间内追加补丁。`.scan-state.json` 被 gitignore。→ CONTEXT.md 决策 12、13。

---

## 第 11 轮 — 知识库新鲜度

**Q11.** 鉴于用户提出的测试环境风险，知识库如何保持新鲜？
**用户主动提出的方案：** "定时任务吧 或者引用知识库时候 是否半天没有更新 没有更新取拉取一下是不是最新的git代码 如果不是最新的询问用户是否更新"。
**我的反驳（及原因）：**
- "或者" → AND（定时器非阻塞，引用时检查是安全网）
- 12 小时阈值（用户确认）
- "询问用户"仅对 Claude Code 消费者有效，对产品问答消费者无效
- 推荐：静默自动更新 + 版本水印 + 过时标记
**用户回答：** "12个小时 ，出发时机是and" — 确认 AND + 12h，隐式接受静默自动更新路径。
**结果：** 定时器（12h）+ 引用时检查 + 静默自动更新 + 过时标记 + 回答水印。→ CONTEXT.md 决策 14、15；ADR 0002。

---

## 第 12 轮 — SKILL.md 拆分

**Q12.** 将 75KB 的 SKILL.md 拆分为模板/提示词/？
**我的推荐：** 现在不拆。P3，延后。
**用户回答：** "好的 按你推荐的 B"。
**结果：** 不拆分。→ CONTEXT.md 决策 18。同时主动提出了跨模块调用问题。

---

## 第 13 轮 — 跨模块调用

**Q13a.** 模块 A 调用模块 B 时如何体现在知识库中？
**选项：** A) 仅命名引用 / B) 链接到 method-index / C) 被调用方记录入站合约 / D) 双向交叉引用。
**我的推荐：** B + C 组合 — 被调用模块获得 `contracts/internal/inbound-from-A.md`；调用方流程链接到该文件。
**子决策：**
- 跨模块流程归属驱动模块（入口 Controller 所有者）
- 循环依赖在 INDEX.md 中标记为代码异味
**用户回答：** "按你推荐的来"。
**结果：** 入站合约模式。→ CONTEXT.md 决策 16、17、18、19。（文件数量后来在 grill 后审查 #5 中被合并为每个被调用方单个 `inbound.md` — 见下文。）

**Q13b.** 自验证机制。
**选项：** A) 无 / B) 程序化覆盖率检查 / C) LM 语义检查 / D) 两者兼有。
**我的推荐：** B — 三项程序化覆盖率检查 + verify-report.md + `--fix-coverage` 子命令。流程仅做状态转换一致性检查（其他容易误报）。
**用户回答：** "按你推荐的"。
**结果：** 仅程序化验证。→ CONTEXT.md 决策 20、21、22。

---

## 第 14 轮 — v1 → v2 迁移

**Q14.** 现有的 `<repo>/ai/` 输出怎么处理？
**我的初始推荐：** A) 提示信息，用户手动删除。
**用户介入：** "直接清理到ai/ 然后生成kb/" — 希望自动清理。
**我的反驳：** 硬 `rm -rf` 会销毁人工编辑的内容；推荐 A2（移动到备份目录，无提示）。
**用户对我的方案提出质疑：** "看起来有问题 那你推荐什么呢"
**最终推荐：** A2 — `mv ai/ ai.v1-backup-<ts>/`，gitignore 备份目录，仅输出提示信息。
**结果：** 备份后清理，无确认提示。版本号升至 2.0.0。→ CONTEXT.md 决策 23、24；ADR 0003。

---

## 第 15 轮 — 验证基准

**Q15.** 用什么项目验证 v2？
**选项：** A) pur-center 全量 / B) pur-reconcile 单模块 / C) pur-center + srm-web。
**我的推荐：** B → A 回归。前端延后。
**用户回答：** "好的按你推荐的"。
**结果：** 先单模块基准，再全仓库回归。→ CONTEXT.md 决策 25。

---

## Grill 后审查（发现 12 个问题，全部已处理）

锁定 14 轮 grill 后，对两份源文档再做一轮审查以捕捉遗漏。发现 9 个缺口 + 3 个一致性问题。用户："处理完在做"（先处理再继续）。全部 12 项已处理：

### 严重（4 项）

1. **frontmatter 缺少 `stale` 字段**（与 Q11 新鲜度冲突）→ 从 4 字段扩展为 5 字段。→ CONTEXT.md 决策 10（修订）。
2. **人工编辑会被 `update` 静默覆盖**（kb-driven §6.2 自动演进循环被打断）→ body-hash 检测 + `human_edited: true` 标记，`--force` 可覆盖。→ ADR 0004；CONTEXT.md 决策 26。
3. **`method-index.md` LM 整体生成时会幻觉行号** → 机械化 AST/正则提取；LM 仅写一行"职责"摘要，每批 10–50 个方法。→ CONTEXT.md 决策 27。
4. **README 声称支持 Vue/React/Go/Python/Rust 但锁定决策是 Java/Spring 形态** → v2 仅交付 Java/Spring 完整分层路由；其他语言仅获得 `code/method-index.md`。README 必须更新。→ ADR 0005；CONTEXT.md 决策 28。

### 中等（4 项）

5. **`inbound-from-X.md` 文件数爆炸**（当被调用方是热点时）→ 合并为每个被调用方单个 `inbound.md`，按调用方分节。→ CONTEXT.md 决策 16（修订）、决策 29。
6. **术语表位置未定义** → `<repo>/kb/glossary.md` 放在仓库根级，由 INDEX.md 作为首个引用加载。→ CONTEXT.md 决策 30。
7. **水印机制无法由技能强制执行** — 消费者 Agent 负责渲染引用，技能无法控制。→ `<repo>/CLAUDE.md` 补丁中包含明确的系统指令，告知 Agent 渲染水印。→ CONTEXT.md 决策 31。
8. **Constants/Configs/Utils 不适合四层分类** → 第 5 类"仅索引，无文档"：出现在 `method-index.md` 中，无独立 markdown。→ CONTEXT.md 决策 32。

### 锦上添花（1 项）

9. **多模态 PRD 摄入（PNG/JPG/PDF/docx）未验证** → 列为"已知限制"，在 Q15 基准阶段验证。→ ADR 0001 已扩展。

### 一致性（3 项）

10. **doc_type — 重新检查是否需要引入** → 否，原始判断成立。kb-doc §4.1 四象限图分类的是*用户问题*，不是*文档*。doc_type 会是一个死字段。
11. **验证仅检查覆盖率，不检查约束语义** → 列为已知限制；约束级验证是 P2 候选，需要更深层的 AST 分析。
12. **文档粒度约 76 份/模块**（估算）可能过高 → 列为已知限制；校准延后到 Q15 基准阶段。

---

## 产出物最终状态

**CONTEXT.md：** 32 条锁定决策（14 轮产出 + grill 后新增 7 条 + 11 条细节澄清内联吸收）。
**ADR：** 5 份
- 0001 search 作为辅助（+ 已知限制章节）
- 0002 知识库新鲜度 + 水印
- 0003 v1→v2 迁移
- 0004 保留人工编辑
- 0005 语言特定路由

**待用户确认**（来自 grill 后审查，尚未确认）：
- #2 — 首次检测到编辑时自动设置 `human_edited: true`（vs 要求手动切换）
- #4 — README 重写范围（去掉多语言全面支持的营销声明）
- #5 — `inbound.md` 单文件方案推翻第 13 轮决策
- #7 — CLAUDE.md 系统指令注入（技能向用户项目写入 Agent 行为规则）
- #10 — doc_type 不引入（尽管有产品问答的未来场景）

用户对确认列表的回应：**"我们的所有对话存储到 知识库的session-notes.md 放便后期取用"** — 即在继续之前归档本次会话。本文件即为该归档。

---

## 待确认事项 — 已于 2026-05-14 解决

用户审查了全部 5 项待确认内容，并接受了我对每项的推荐处理方式（"都可以 按你说的来"）：

| # | 待确认内容 | 解决方案 |
|---|-----------|---------|
| #2 | 首次检测到编辑时自动设置 `human_edited: true` | **自动设置** — 手动切换在实践中不会被执行；保护 > 误报 |
| #4 | README 重写范围（多语言声明） | **弱化，不删除** — 保留章节，重新表述为"Java/Spring 完整分层支持；其他语言获得 method-index，完整分层在 v2.x 路线图中" |
| #5 | `inbound.md` 单文件 vs 多文件 | **每个被调用方单文件，按调用方分节** — 第 13 轮的多文件设计被推翻 |
| #7 | CLAUDE.md 系统指令注入 | **默认注入**，提供 `--no-instruction-injection` 退出选项给认为越界的用户 |
| #10 | doc_type 为产品问答预留 | **不添加** — `kb_layer` 已可推导 strategy_hint；v2.x 在产品问答成为现实时再添加 doc_type |

#7 的退出选项已添加到 CONTEXT.md 决策 31。其他所有解决方案在 grill 后处理阶段已写入 CONTEXT.md / ADR。

---

## 下一次会话的开放问题

~~用户审查上述 5 项待确认后：~~

所有确认已解决。Issue 已编写并定稿。

**当前状态：** `.scratch/v2/` 中有 14 个 issue 文件，全部为中文，可以开始执行。未推送到 GitHub（决策：仅本地保留，直到 #1 tracer 通过）。

**下一步行动：** 开始实现 #1（tracer：单实体端到端）。这是基础 — frontmatter 写入器 + 路径路由 + 单实体生成器 + .scan-state.json v2。

**Grill 后补充（初始 15 轮之后）：**
- 嵌入模型：默认从 `nomic-embed-text` 切换为 `BAAI/bge-m3`（免费、本地、中文优先、8192 上下文、1024 维）。已写入 #12 和 ADR 0001。
- PRD ↔ 代码绑定：向量召回 + prd-mapping.yaml 覆盖。PRD 路径记录在 `sources` 中。PRD/代码不一致时代码为权威；冲突在 verify-report 中呈现。已写入 CONTEXT.md + #5 + #10 + #11 + ADR 0001。

---

## 实现 session（2026-05-15）

### 完成的切片

| 切片 | 产出 | 脚本 |
|------|------|------|
| #1 探路弹 | frontmatter 合约锁定 | frontmatter.js, router.js, state.js |
| #2 domain | 20 entities(DDL) + 28 enums + 2 state-machines + 1 rules(70候选) + 1 error-codes(123码185抛出点) | entity-generator.js, enum-generator.js, state-machine-generator.js, rules-generator.js |
| #3 contracts | 11 internal(98端点) + 1 external | contract-generator.js |
| #4 method-index | 180类 1047方法 + 注解列 | method-index-generator.js |
| #5 flows | 59份 flow（深度2调用链 + 事务标注）+ 1份层次2（confirm，含条件分支） | flow-generator.js, flow-level2-builder.js |
| #7 导航 | INDEX.md + CLAUDE.md（入口flow指针） | navigation-generator.js |
| #8 放置+迁移 | setup.js（v1备份 + CLAUDE.md补丁 + gitignore） | setup.js |
| #9 新鲜度 | freshness.js（12h阈值 + feature分支保护） | freshness.js |
| #10 校验 | verify-report.md（entities 100% + contracts 100%） | verify.js |
| #11 增量 | incremental.js（sources比对 + human_edited + 层次1/2分流） | incremental.js |
| #12 search | bge-m3默认 + 中文token修正 + 向量库822切片 | kb-vector-index.js, embed.js修改 |

### 额外完成（超出原14切片）

| 能力 | 产出 | 说明 |
|------|------|------|
| 跨系统知识 | external-systems/{rule-engine, flow-system, settlement}.md | 手写模板，human_edited=true |
| 共享枚举分离 | kb/shared/domain/enums/ (25份) | pur-common枚举不归属单一模块 |
| 前端扫描 | reconcile-mng (7份) + supplier-c (5份) | routes + API + pages + stores |
| 前后端映射 | backend-mapping.md (205条) | 前端函数 → 后端flow链接 |
| API类型提取 | api-types.md (202个接口Req/Res) | 从 reconcile.types.ts 解析 |
| hermesDict字典 | hermes-dict.md (301个字典常量) | 从 dictConstants.ts 解析 |
| 前端状态聚合 | frontend-enums.md | 6态聚合规则 + BusinessStatus |
| 字段一致性校验 | field-consistency-report.md (59对) | 前端Req vs 后端DTO |
| 表单校验vs数据库 | form-validation-report.md (20 required + 303风险) | NOT NULL vs required |
| 字段联动逻辑 | field-linkage-detail.md | 值传递/条件展示/级联清空/动态计算 |
| 节点×按钮×字段矩阵 | node-button-field-matrix.md | 按钮权限 + 编辑模式 + 字段可见性 |
| supplier-portal扫描 | api-mapping.md (30个转发接口) | Retrofit接口 → pur-center路径 |
| 跨项目拓扑 | system-topology.md | 三跳链路图 + 排查路径 |
| 统一搜索 | unified-search.js | 跨3个项目向量库搜索 |
| 层次2 prompt模板 | templates/prompts/flow-level2-analysis.md | 自动化条件分支分析 |

### 物理位置变更

KB 从 `pur-center/kb/` 迁移到独立目录：

```
/Users/a6667/bilibili/project-scan/
├── system-topology.md
├── frontend-backend-map.md
├── pur-center/
│   ├── kb/ (131份)
│   └── .vector-store/ (822切片)
├── srm-web/
│   ├── kb/ (16份)
│   └── .vector-store/ (100+切片)
└── supplier-portal/
    ├── kb/ (1份)
    └── .vector-store/ (3切片)
```

### 新增 scripts（本次session）

```
scripts/
├── frontmatter.js              ← 5字段读写 + body hash
├── router.js                   ← Java/Spring路径glob路由
├── entity-generator.js         ← Entity + DDL（DB密码改为环境变量）
├── enum-generator.js           ← Enum
├── state-machine-generator.js  ← 状态转移 + Mermaid
├── rules-generator.js          ← 规则候选定位
├── method-index-generator.js   ← 方法索引 + 注解
├── contract-generator.js       ← Controller端点
├── flow-generator.js           ← 调用链（深度2）+ 事务 + 接口→实现类映射
├── flow-level2-builder.js      ← 层次2 prompt构建器
├── navigation-generator.js     ← CLAUDE.md + INDEX.md
├── frontend-generator.js       ← React前端扫描（routes/API/pages/stores）
├── kb-vector-index.js          ← KB文档切片入lancedb
├── unified-search.js           ← 跨项目统一搜索
├── setup.js                    ← v1迁移 + CLAUDE.md补丁
├── verify.js                   ← 覆盖率校验
├── incremental.js              ← 增量更新 + human_edited + 层次分流
├── freshness.js                ← 12h新鲜度
└── state.js                    ← .scan-state.json v2
```

### Skill 化（已完成）

~~当前所有能力都是"手动跑脚本"，需要集成到 `/project-scan` skill 里变成一条命令。~~

**已完成：**

1. ✅ **`scan-config.yaml`** — 项目配置的唯一来源（路径、分支、模块、DB、项目间关系）
2. ✅ **`scripts/scan-all.js`** — 总入口，读配置 → 按类型分发 → 生成 → 入向量库
   - java-spring：entity + enum + state-machine + contract + flow + method-index + error-codes + rules
   - react：routes + api-client + api-types + stores + hermes-dict + frontend-enums + field-linkage + node-button-matrix + backend-mapping
   - gateway：Retrofit 转发映射
   - 跨项目：system-topology + frontend-backend-map（自动生成）
3. ✅ **SKILL.md** — 完整执行手册（v2 子命令 + 每种项目类型的详细生成列表 + 向量库交互流程）
4. ✅ **端到端测试** — `scan-all.js` 跑通三个项目（pur-center + srm-web + supplier-portal）
5. ✅ **通用化策略** — MyBatis-Plus 为默认规则，config 预留 `framework` 字段，不过早抽象

### Grill check（设计一致性校验）

session 末尾用 `/grill-with-docs` 做了设计一致性检查，发现并修复了 10 个偏差：

| # | 问题 | 处理 |
|---|------|------|
| 1 | KB 物理位置变了（不在 git 仓库） | CONTEXT.md 决策 12 更新 |
| 2 | 多项目是新概念 | CONTEXT.md 术语段加 Project |
| 3 | 前端扫描超出"降级模式" | ADR 0005 更新：React 有专属文档类型集 |
| 4 | scan-config.yaml 是新核心 | CONTEXT.md 加决策 |
| 5 | 跨项目串联是新能力 | CONTEXT.md 加决策 |
| 6 | CLAUDE.md 补丁已废弃 | CONTEXT.md 决策 31 改为"不再修补" |
| 7 | 向量库每项目一个 | 不需要改（已在 #5 覆盖） |
| 8 | 层次 2 flow 是新能力 | CONTEXT.md 加决策 |
| 9 | error-codes 归属 | 不需要改（归 domain 层合理） |
| 10 | 通用化策略 | 保持 MyBatis-Plus 默认，不改脚本 |

### GitHub 推送记录

```
仓库: github.com:xinxin1112/project-scan (main)
版本: 2.0.0

提交历史（本次 session）：
  4bcc2d3 docs: add install and update commands to README
  b5d5953 feat: add vector store interactive setup flow in SKILL.md
  cd1b644 docs: sync CONTEXT.md and ADR 0005 with actual implementation
  3858873 feat: complete scan-all.js with full frontend scanning + cross-project generation
  82c999b feat: v2.0.0 — structured KB generation with multi-project support
```

### 安装与更新

```bash
# 安装
git clone git@github.com:xinxin1112/project-scan.git ~/.claude/skills/project-scan
cd ~/.claude/skills/project-scan && npm install
ollama pull bge-m3  # 可选，用于向量搜索

# 更新
cd ~/.claude/skills/project-scan && git pull origin main && npm install

# 重建向量库（模型更新后）
/project-scan reindex
```

### 下次 session 可做的事

1. **通用化脚本** — 当有第二个非 MyBatis-Plus 项目时，把注解识别规则从脚本里抽到 config
2. **Vue 前端支持** — 类似 React 的文档类型集，适配 Vue 的 router/store/composables
3. **层次 2 flow 自动化** — 接 Claude API 或本地 Ollama qwen2.5，实现 `--auto-lm` 的完整闭环
4. **pur-center 全模块回归** — 扫 pur-center 所有模块（不只是 pur-reconcile），验证跨模块 inbound contract
5. **setup 交互式命令** — `/project-scan setup` 引导用户生成 scan-config.yaml
6. **GitNexus 知识图谱集成** — 影响分析层
   - 安装 GitNexus，跑 benchmark（全量索引 pur-center + srm-web + supplier-portal 各要多久）
   - 写 `scripts/graph-index.js`（调 GitNexus 索引 3 个项目，数据存 `.sources/<project>/.gitnexus/`）
   - 写 `scripts/graph-query.js`（影响分析：输入方法名 → 输出所有调用方 + 受影响页面）
   - SKILL.md 加子命令：`/project-scan graph`、`/project-scan graph --impact=X`、`/project-scan graph --web`
   - 决定更新策略：如果全量 < 2 分钟 → 绑定到 `/project-scan update`；> 10 分钟 → 独立按需
   - 集成到全量扫描流程（Step 1 scan-all → Step 2 向量库 → Step 3 图谱 → Step 4 层次 2）
   - Web UI：`/project-scan graph --web` 启动本地服务查看交互式图谱
