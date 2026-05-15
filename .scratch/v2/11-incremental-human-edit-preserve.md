# [v2] 增量更新 + 人工编辑保护

**类型：** AFK
**Triage 标签：** ready-for-agent

## 要做什么

让 update 又快（只改变化的）又安全（不毁人工编辑）。

### 1. sources 反向索引

每份 KB 文档的 frontmatter 里 `last_scan_commits` 记录了它依赖的源文件 + 扫描时的 commit。update 流程：

```
git diff <last_scan_commits[*].commit>..HEAD
   ↓
变更文件列表
   ↓
对每份文档：if any(source in changed_files for source in doc.sources) → 标过期
   ↓
只重新生成过期文档
```

**Mapper 不在 flow 文档的 sources 里**（已锁定决策），所以改 Mapper 只让 method-index 过期，不动 flow 文档。

**PRD 文件路径在 flow 文档的 sources 里**（已锁定决策），所以改 PRD 会让引用它的 flow 文档过期重生成。不需要单独的 PRD hash 跟踪机制 — 复用同一套 sources 反向索引。对于不在 git 里的 PRD 文件，用 mtime 检测变更。

### 2. body hash 检测

每次重新生成时把文档 body 的稳定 hash 写到 `last_scan_commits[*].body_hash`。规则：
- 排除 frontmatter
- 规范化空白
- 包含代码块内容

下次 update 时：当前 body hash 与存的 hash 不同 → 该文档被人工修改过。

### 3. human_edited 自动设置 + 跳过

第一次检测到 hash 不一致：
- 自动把 `human_edited: true` 写进 frontmatter
- 在 verify-report.md 里登记（"X 份人工编辑过的文档因源码变更被跳过"）

后续 update：
- 看到 `human_edited: true` → 即使 sources 变了也跳过
- 跑 `--force` 才会覆盖，并把 flag 清掉

### 4. 行为矩阵（来自 ADR 0004）

| sources 变了？ | `human_edited`？ | 行为 |
|---|---|---|
| 否 | 任意 | 跳过 |
| 是 | false / 缺省 | 重新生成，更新 body_hash |
| 是 | true | 跳过 + verify-report 登记 |
| 是 | 任意 + `--force` | 重新生成，清掉 `human_edited` |

## 验收标准

- [ ] 改 pur-reconcile 中一个 Service 文件 + 跑 update → 只有 sources 包含该文件的文档被重新生成（典型 ≤5 份）
- [ ] 改一个 Mapper 文件 → flow 文档**不**被重新生成（只 method-index 重新生成）
- [ ] 改一份 PRD 文件 → 引用该 PRD 的 flow 文档**被**重新生成
- [ ] 手动改一份生成的 entity 文档，再改对应的实体源码，跑 update → 文档被跳过 + `human_edited: true` 自动写入 + verify-report 登记
- [ ] `update --force` 重新生成同一份文档并清掉 `human_edited` flag
- [ ] body hash 对纯格式变化稳定（空白、行尾符）

## 决策依据

CONTEXT.md decision 7、8、26。ADR 0004。

## 阻塞

- #1 探路弹（frontmatter 合约和 body hash 格式必须先锁定）
