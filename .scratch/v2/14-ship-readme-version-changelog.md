# [v2] 上线：README 重写 + 版本号 + changelog

**类型：** AFK
**Triage 标签：** ready-for-agent

## 要做什么

v2.0.0 发布的非代码部分。

### 1. README 重写

软改文案，不大砍内容：
- **技术栈段**：改为"Java/Spring 完整四层支持；Vue/React/Go/Python/Rust 生成 method-index 索引；完整四层支持在 v2.x 路线图"。不要直接砍语言列表，而是明确范围
- **输出结构段**：把 `ai/` 例子全部换成 `kb/` 四层结构例子
- **search 段**：降级到 README 末尾的"补充能力"小节
- **v1 → v2 迁移提示**：放在 README 顶部附近 — "v1 用户首次跑 v2 时，旧 ai/ 目录自动备份到 ai.v1-backup-<ts>/"
- **新命令补全**：
  - `/project-scan check`（已存在，明确写出来）
  - `/project-scan config --no-instruction-injection`（新 opt-out 开关）
  - `/project-scan update --fix-coverage`（新）
  - `/project-scan update --force`（新，覆盖 human_edited 文档）

### 2. ADR 互链

- CONTEXT.md 中每条决策反向引用所属 ADR
- ADR 之间相互引用（例：0004 引用 0002 — 新鲜度模型触发 stale flag；0005 引用 0001 — 语言范围影响 search）

### 3. package.json 升 2.0.0

按 SemVer 这是 breaking change：输出位置（ai/ → kb/）和组织方式（按角色 → 按层）都变了。

### 4. CHANGELOG 段

写在 README 或单独 CHANGELOG.md，v2.0.0 highlight：
- **Breaking**：输出从 `ai/` 改为 `kb/`，按四层组织（domain / contracts / flows / code）
- **Breaking**：完整四层支持范围收窄到 Java/Spring；其他语言只生成 method-index
- **新增**：跨模块 inbound contracts
- **新增**：12 小时新鲜度模型 + stale 标记 + 答案水印
- **新增**：人工编辑保护（update 不会覆盖手改过的文档）
- **新增**：`verify-report.md` 和 `--fix-coverage`
- **迁移**：v1 ai/ 在首次跑 v2 时自动备份

## 验收标准

- [ ] README 准确描述 v2 范围（Java/Spring 完整，其他降级）
- [ ] 没有任何地方提 v1 旧 `ai/` 结构是当前输出
- [ ] 5 个新命令 / 标志都被记录
- [ ] CONTEXT.md 和 ADR 之间互链整洁
- [ ] `package.json` 显示 `"version": "2.0.0"`
- [ ] CHANGELOG / 发布说明描述 breaking change 和迁移路径

## 决策依据

CONTEXT.md decision 24（版本升级）、28（Java/Spring 范围）、31（指令注入 opt-out）。ADR 0005（语言范围）、ADR 0003（迁移）、ADR 0001（search 降级）。

## 阻塞

- #13 fixture 验收（验证门没过之前不上线）
