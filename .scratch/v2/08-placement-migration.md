# [v2] 物理放置 + v1 → v2 迁移

**类型：** AFK
**Triage 标签：** ready-for-agent

## 要做什么

KB 不再是 skill 工作区里的副产物，而是落到用户真实的开发仓里。同时给 v1 老用户一条安全的迁移路径。

### 1. 输出路径解析

KB 写到 `<dev-repo>/kb/`，**不**写到 skill 工作区。

skill 自己的扫描副本仍然在 `~/.claude/skills/project-scan/<repo>/`（用户在那里跑 `git pull <主分支>`），但这只是**扫描源**，没有任何 KB 文件落到这里。

首次跑 v2 时，向用户提示一次"开发仓在哪里"，存到 `.scan-state.json` 里。后续不再问。

### 2. v1 → v2 首次迁移

检测到 `<dev-repo>/ai/` 存在时：
1. `mv <dev-repo>/ai/ <dev-repo>/ai.v1-backup-<timestamp>/`
2. 删除 `<dev-repo>/.scan-state.json`（v1 schema）
3. 在 `<dev-repo>/.gitignore` 中加入 `ai.v1-backup-*/`（如果还没有）
4. 生成全新的 `<dev-repo>/kb/` + v2 `.scan-state.json`
5. 打一行提示信息，**不**让用户确认

注意是 `mv` 不是 `rm -rf`：备份目录里是用户可能手改过的内容，不能直接销毁。备份对用户可见，他自己确认 v2 跑通之后再 `rm -rf ai.v1-backup-*/` 删掉。

### 3. `.scan-state.json` v2 schema

`.scan-state.json` 仍然 gitignored。schema：

```json
{
  "version": 2,
  "modules": { ... },
  "repos": { ... },
  "last_freshness_check": "<iso8601>"
}
```

每份文档的状态由 frontmatter 里的 `last_scan_commits` 维护，`.scan-state.json` 只管模块级元信息和新鲜度时间戳。

## 验收标准

- [ ] 首次跑 v2 时提示开发仓路径，存下来，KB 写到那里
- [ ] `<dev-repo>/ai/` 存在时被改名为 `ai.v1-backup-<ts>/`（mv，不是 rm）
- [ ] `.gitignore` 中出现 `ai.v1-backup-*/`
- [ ] 用户看到提示信息，但**没**被要求确认
- [ ] 后续 update 跳过迁移，直接写到 `kb/`

## 决策依据

CONTEXT.md decision 12、13、23、24。ADR 0003。

## 阻塞

- #7 导航（CLAUDE.md 注入器必须先存在，才能把 KB 完整放到开发仓里）
