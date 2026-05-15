# [v2] 导航：CLAUDE.md + INDEX.md + glossary + 行为指令注入开关

**类型：** AFK
**Triage 标签：** ready-for-agent

## 要做什么

四层文档铺好之后，给 Consumer Agent 一个能用得起来的导航层。

### 1. 模块级 CLAUDE.md

每个模块产出 `kb/<module>/CLAUDE.md`：
- **顶部入口 flow 指针** — 选择规则：模块名匹配 > 被引用最多 > 步骤最长 > 不写
- 按 KB 层分 section（Flows / Domain / Contracts / Code）
- 每条目展示：文档链接 + frontmatter 里的 `summary`

### 2. 仓库根 INDEX.md

`<repo>/kb/INDEX.md` 提供跨模块视图：
- 顶部：glossary 链接
- 模块列表（含上次扫描时间）
- 跨模块的状态机汇总
- 跨模块的 flow 汇总
- 循环依赖警告（来自 #6）

### 3. glossary

`<repo>/kb/glossary.md` 在仓库根，跨模块共享的业务术语表。如果有 PRD 提供内容则填充，否则生成空模板让人手填。这是 kb-driven 文档第 1 节强调的"共享全局认知"入口。

### 4. `<repo>/CLAUDE.md` 注入 + opt-out 开关

在用户已有的 `<repo>/CLAUDE.md` 末尾追加 `<!-- KB START -->...<!-- KB END -->` 块，内容包含：
- 一行链接到 INDEX.md
- **system 指令**给 Consumer Agent：引用 KB 内容时附 `(KB version: <commit>, last update: <time>)` 水印；如果 frontmatter 有 `stale: true`，回答前面加 stale 警告

**opt-out 开关**：用户认为这是越界，可以跑 `/project-scan config --no-instruction-injection` 关闭指令注入。关闭后只写链接，不写行为指令。

`<!-- KB END -->` 之后是用户原内容，**不动**。

## 验收标准

- [ ] 每个模块的 CLAUDE.md 顶部有入口 flow 指针，下面是按层分组的索引 + summary
- [ ] INDEX.md 展示跨模块汇总（状态机、flow、循环依赖）
- [ ] glossary.md 存在于仓库根（即使是空模板）
- [ ] `<repo>/CLAUDE.md` 末尾有 KB 块，原内容未被修改
- [ ] 跑 `--no-instruction-injection` 后，KB 块只剩链接，没有行为指令
- [ ] 用户 review 入口 flow 选择 — 在 pur-reconcile 中是否选到了合理的 flow

## 决策依据

CONTEXT.md decision 1、6、30（glossary）、31（指令注入 + opt-out）。

## 阻塞

- #5 flows 层（入口 flow 指针需要有 flow 可选）
- #6 跨模块（INDEX.md 的循环依赖警告来自跨模块分析）
