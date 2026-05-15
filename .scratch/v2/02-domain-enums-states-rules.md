# [v2] domain 层：枚举、状态机、规则

**类型：** AFK
**Triage 标签：** ready-for-agent

## 要做什么

#1 探路弹只生成了 entity 文档，本切片把 domain 层的另外三类文档铺开。所有产出复用 #1 锁定的 frontmatter 合约。

### 1. 枚举（enums）

每个枚举类生成一份文档，落到 `domain/enums/` 下：状态枚举、类型枚举、错误码枚举等。

### 2. 状态机（state machines）

检测 `setStatus()` / `updateStatus()` 调用模式 + migration 文件中的 status 字段定义，每个有状态字段的实体生成一份 `domain/state-machines/<entity>-status.md`，包含：
- 状态转移表（FROM → TO）
- 守卫条件（什么情况下允许转移）
- 副作用（转移时还触发了什么，比如更新关联表、发通知）

### 3. 规则（rules）

从 Service 层的业务规则代码中提取决策表，落到 `domain/rules/`。例如「金额差异 < 1 元自动匹配」这种规则，从 if-else 块翻译成决策表格式。

### 重要：一个源文件可产生多份文档

`BillReconcileServiceImpl` 这种 800 行的 Service 类可能同时贡献：
- 一份 `state-machines/bill-reconcile-status.md`（它包含状态转移逻辑）
- 一份 `rules/auto-match.md`（它包含自动匹配规则）
- 加上 method-index 中的方法记录（#4 处理）

不要试图"一个源文件 → 一个文档"。

## 验收标准

- [ ] pur-reconcile 中每个枚举类都产出 `enums/` 文档
- [ ] 每个有状态字段的实体都产出 `state-machines/` 文档，包含转移表
- [ ] Service 层有决策逻辑的类产出 `rules/` 文档，包含决策表
- [ ] frontmatter 与 #1 的合约一致
- [ ] 当 #10 落地后，`verify-report.md` 能体现这些文档的覆盖率

## 决策依据

CONTEXT.md decision 2、3。

## 阻塞

- #1 探路弹（frontmatter 合约和路径路由必须先锁定）
