# [v2] 探路弹：单 entity 全栈打通

**类型：** HITL
**Triage 标签：** ready-for-human

## 要做什么

一个最小宽度的端到端切片：扫描 pur-reconcile，**只**生成一份 entity 文档，但要把 v2 流水线的每一段都过一遍。这是架构探路弹 — 用最小代价验证地基对不对。

具体流程：
- 路径 glob 路由（Java/Spring 规则）识别一个 `*Entity.java` 和它对应的 DDL
- 单 entity 生成器产出 `kb/pur-reconcile/domain/entities/bill-reconcile.md`
- frontmatter 写入 5 个字段：`kb_layer`、`summary`、`sources`、`last_scan_commits`、`stale`
- 计算 body hash 并存到 `last_scan_commits[*].body_hash`
- 写入 v2 版本的 `.scan-state.json`（`version: 2`）

**本切片不做**：其他层（contracts / flows / code-index）、其他 entity。范围故意窄，让地基在扩展前先被 review 锁定。

这一条是 HITL，因为产出的文档和 frontmatter 格式会成为后续 11 条切片的合约 — 用户必须先看一眼确认 frontmatter 形态对了，再开始铺开。

## 验收标准

- [ ] 跑 `/project-scan` 扫 pur-reconcile 后，`kb/pur-reconcile/domain/entities/` 下**恰好**生成一份文档
- [ ] frontmatter 包含 5 个必填字段，类型正确
- [ ] `last_scan_commits` 记录的是真实的主分支 commit hash + 稳定的 body hash
- [ ] `.scan-state.json` 用 v2 schema 写入
- [ ] 用户 review 后确认文档结构和 frontmatter 形态正确

## 决策依据

CONTEXT.md decision 2、7、10。frontmatter 格式是 ADR 0004（人工编辑保护）和 ADR 0002（新鲜度模型）的基础。

## 阻塞

无 — 可立即开始。
