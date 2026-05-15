# [v2] 校验：覆盖率 + flow 检查 + verify-report + --fix-coverage

**类型：** AFK
**Triage 标签：** ready-for-agent

## 要做什么

程序化自检 — kb-driven 文档第 5 节那个"代码必须贴合文档"的循环，单 Agent 模式（不上 LM 语义校验，单 Agent 自审是已知反模式）。

### 1. 覆盖率校验（`scripts/verify.js`）

三项硬覆盖检查：
- **entity 覆盖率**：entity 文档的字段集 ⊇ DDL 字段集（从 migration SQL 解析）
- **contract 覆盖率**：contract 文档的端点集 ⊇ `@RequestMapping` 注解集
- **method-index 覆盖率**：method-index ⊇ 源码 public 方法集

### 2. flow 检查（弱）

flow 跨多类，没法 1:1 对照事实集。做两项检查：
- **状态转移一致性**：flow 步骤里提到的状态转移 ⊆ 源码里的 `setStatus()` 调用集
- **PRD/代码冲突检测**：flow 文档引用的 PRD 段落中的数值/条件 vs 代码中的实际守卫条件。不一致时标记为冲突警告（不是错误）

不做：步骤数 vs 调用层数检查、sources 完整性检查。这俩误报率高。

### 3. verify-report.md

`<repo>/kb/verify-report.md` 包含：
- 每项检查的覆盖率百分比
- 每份文档的差距列表（例：`bill-reconcile.md missing fields: amount_diff, match_remark`）
- 修复建议命令（`/project-scan update --fix-coverage`）
- 通知段：`X 份人工编辑过的文档因源码变更被跳过`（来自 #11）

### 4. --fix-coverage 子命令

读 verify-report.md → 只重新生成被标记有覆盖率差距的文档 → **不**尝试语义修复。

为什么不做语义修复：同样的 prompt + 同样的 LM，第二次跑大概率还是漏。语义层差距让人工 review，不让 LM 反复尝试。

## 验收标准

- [ ] 扫完 pur-reconcile 后，`verify-report.md` 存在，含覆盖率百分比
- [ ] 手动从 entity 文档删一个字段，重跑 verify → 出现差距记录
- [ ] 给 Controller 加一个新端点但不重扫 → 下次 verify 出现差距记录
- [ ] PRD 写"< 5元"但代码守卫是 `diff < 1` → verify-report 出现 PRD/代码冲突警告
- [ ] 跑 `--fix-coverage` 后只重生成被标记的文档（用 mtime / hash 比对）
- [ ] pur-reconcile fixture 上覆盖率 ≥ 90%

## 决策依据

CONTEXT.md decision 20、21、22。

## 阻塞

- #5 flows 层（flow 检查需要 flow 文档存在）
