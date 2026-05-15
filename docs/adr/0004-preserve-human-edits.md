# 0004 — 跨再生成保留人工编辑

## 背景

两个已锁定的决策存在张力：

- **frontmatter `sources` 反向索引**（ADR/CONTEXT）驱动自动再生成：当被跟踪的源文件变更时，扫描器再生成受影响的文档。
- **kb-driven §6.2 "知识自动演进"** 假设 KB 随时间接收人工编辑——LM 扫描器自身永远无法产生的修正、澄清和补充。

如果 `update` 在 `sources` 变更时盲目再生成，每次代码提交都会静默销毁所有人工编辑。

## 决策

每个再生成器检测文档自上次扫描以来是否被手动修改过，并据此标记或跳过。

两种机制配合使用：

1. **正文哈希检查。** 文档生成时，扫描器将文档正文（不含 frontmatter）的哈希记录到 `last_scan_commits[*].body_hash`。`update` 时，如果当前正文哈希与记录的不同，则该文档被视为人工编辑过。

2. **显式 frontmatter 标志。** 一旦检测为人工编辑，扫描器在下次 `update` 时在 frontmatter 中设置 `human_edited: true`。后续 `update` 运行尊重此标志并跳过该文档，即使 sources 发生变更。手动重置（删除该标志）重新启用自动再生成。`--force` 可覆盖。

行为矩阵：

| sources 变更？ | `human_edited`？ | 行为 |
|------------------|-----------------|-----------|
| 否 | 任意 | 跳过 |
| 是 | false（或缺失） | 再生成，更新 body_hash |
| 是 | true | 跳过，在 `verify-report.md` 中记录通知（"X 个人工编辑的文档尽管 source 变更仍被跳过"） |
| 是 | 任意，带 `--force` | 再生成，移除 `human_edited` 标志 |

## 后果

- 扫描器必须计算稳定的正文哈希（规范化空白、排除 frontmatter、包含代码围栏内容）。实现在 `scripts/regenerate.js` 中。
- 用户可以放心手动编辑生成的文档——kb-driven 的自动演进循环变得安全。
- 代价：标记为 `human_edited: true` 的文档可能在无警告的情况下偏离 sources。`verify-report.md` 通知浮现此情况，以便用户定期审查和重新合并。
