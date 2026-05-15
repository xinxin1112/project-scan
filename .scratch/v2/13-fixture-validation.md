# [v2] fixture 验收：pur-reconcile → pur-center

**类型：** HITL
**Triage 标签：** ready-for-human

## 要做什么

验证门。前 12 条切片把 v2 流水线建好了，本切片在用户真实项目上跑一遍，验证设计是否经得起考验。

### 1. pur-reconcile 单模块跑通

只扫 pur-reconcile 一个模块：
- 完整生成 `kb/pur-reconcile/{domain,contracts,flows,code}/`
- `verify-report.md` 显示覆盖率 ≥ 90%
- 用户 review `flows/cdn-usage-reconcile.md`，确认与脑里对该业务的理解一致
- 记录文档总数（用于后续粒度校准）

### 2. pur-center 全模块回归

扫整个 pur-center：
- 所有模块都产出 `kb/<module>/`
- 跨模块 inbound contract 正确出现（pur-reconcile 调 pur-order → pur-order 那边出现 inbound section）
- INDEX.md 跨模块视图能渲染
- 循环依赖（如果有）以警告形式登记，不报错
- 记录全仓文档总数

### 3. 粒度校准

如果 pur-center 全仓文档数 > 1500：
- 调高 flow 触发条件阈值
- 考虑 entity 合并（多个小 entity 合一份文档）
- 把校准结果作为 follow-up 加到 ADR 0001 已知限制段

### 4. ADR 0001 已知限制项的抽样验证

- **多模态 PRD**：往 `pur-reconcile/prd/` 丢一份 PNG / PDF / docx PRD，重扫，确认 flow 文档抓到了内容（抓不到就标记为已知限制）
- **新鲜度环路**：在 `release_prd` 上提交一个 commit 并 push，触发引用前校验，确认 KB 自动更新 + verify-report 重新生成
- **迁移冒烟**：用一个有 v1 `ai/` 目录的全新 fixture 跑 v2，确认 `ai.v1-backup-<ts>/` 出现，gitignore 被改，新 `kb/` 生成

本切片是 HITL，因为设计正确性只能由真正了解 pur-reconcile / pur-center 的人来判断。

## 验收标准

- [ ] pur-reconcile 跑通；用户 review `cdn-usage-reconcile.md` 后确认准确
- [ ] pur-center 跑通；跨模块 contract 和 INDEX.md 都符合预期
- [ ] 全仓文档总数被记录；超过 1500 时执行校准并重跑
- [ ] 多模态 PRD 抽样要么通过，要么明确登记为已知限制
- [ ] 新鲜度环路端到端跑通
- [ ] 从 v1 形态的 fixture 做迁移冒烟通过

## 决策依据

CONTEXT.md decision 25（验证 fixture）。ADR 0001 已知限制 §1、§3。

## 阻塞

- #1 至 #12 全部完成（这是演示门）
