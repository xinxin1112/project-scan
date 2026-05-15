# [v2] 新鲜度：12 小时定时 + 引用前校验 + stale 标记 + 答案水印

**类型：** AFK
**Triage 标签：** ready-for-agent

## 要做什么

KB 是主分支某个 commit 的快照。本切片让这个快照不会腐坏，并让 Consumer Agent 知道自己读到的数据有多新。

### 1. 12 小时定时拉取

复用现有的 `scripts/auto-update.js` + `setup-auto-update.js`（macOS launchd / Windows Task Scheduler）。改成每 12 小时跑一次：
- 在 skill 的扫描副本里跑 `git fetch origin <主分支>`
- 如果 commit 与 frontmatter 的 `last_scan_commits` 有偏离，跑增量 update

### 2. 引用前校验（reference-time check）

任何 KB 读操作之前挂一个钩子：
- 看 `.scan-state.json` 里的 `last_freshness_check` 是不是 > 12 小时
- 是 → 同步跑 `git fetch origin <主分支>`
- 有偏离 → 跑增量 update
- 任一步失败（网络、git 凭证）→ 不报硬错，继续用现有 KB，但把受影响的文档 frontmatter 标 `stale: true` + `stale_reason: "..."`

### 3. feature 分支保护

如果用户当前本地 working tree 在 feature 分支且与主分支有偏离 → 静默路径**不**自动 update，保留之前的主分支快照。

KB 的语义是"主分支基线"，feature 分支的差异由 Consumer Agent 自己看 `git diff` 处理。

### 4. `/project-scan check` 是唯一交互入口

只有用户主动跑 `check` 时才会弹确认提示。定时和引用前校验这两条静默路径**永远不**弹提示。

### 5. 答案水印

#7 已经在 `<repo>/CLAUDE.md` 注入了 system 指令，告诉 Consumer Agent 引用 KB 时渲染 `(KB version: <commit>, last update: <time>)`，frontmatter 有 `stale: true` 时加警告。

本切片确保水印需要的数据（commit hash、时间戳、stale 标记）被正确写入和传播。

## 验收标准

- [ ] 用户系统上能看到 12 小时定时任务（launchd plist 或 Task Scheduler 项）
- [ ] 手动把 `last_freshness_check` 改成 > 12 小时前 → 触发 KB 读 → 同步 fetch + update
- [ ] 故意让 fetch 失败（短暂吊销 git 凭证）→ 受影响文档 frontmatter 出现 `stale: true`，**不**报硬错
- [ ] 切到与主分支有偏离的 feature 分支 → 静默路径**不**覆盖 KB
- [ ] `/project-scan check` 弹确认；静默路径不弹
- [ ] 抽样让 Consumer Agent 引用 KB → 水印行渲染正确（手动 smoke test）

## 决策依据

CONTEXT.md decision 14、15。ADR 0002。

## 阻塞

- #8 物理放置 + 迁移（新鲜度作用在已放置的 KB 上，开发仓路径必须先解析好）
