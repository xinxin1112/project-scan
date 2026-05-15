# 0003 — v1 → v2 迁移：备份后清理 ai/，重新生成 kb/

## 背景

v2 更改了 KB 输出位置（`ai/` → `kb/`）和组织方式（按角色 → 按层并带跨模块入站契约）。两种结构没有干净的 1:1 映射——一个 v1 文件如 `ai/backend/<service>.md` 可能对应四个 v2 文件（`domain/state-machines/`、`domain/rules/`、`contracts/internal/`、`code/method-index.md`）。尝试以编程方式将 v1 输出转换为 v2 输出比重新扫描工作量更大。

根据 kb-driven §6.2 "知识自动演进"模型，KB 预期随时间接收人工编辑。v1 用户可能手动编辑了 `ai/business/glossary.md` 或在 `ai/` 中添加了自定义笔记。`rm -rf ai/` 会静默销毁这些工作。

## 决策

在已存在 `ai/` 的仓库中首次运行 v2 时：

1. 将 `ai/` 移动到 `ai.v1-backup-<timestamp>/`（使用 `mv`，不是复制——快速、原地重命名）。
2. 删除 `<repo>/.scan-state.json`（v1 状态与 v2 基于 frontmatter 的真实来源不兼容）。
3. 如果尚未覆盖，将 `ai.v1-backup-*/` 添加到 `<repo>/.gitignore`。
4. 通过全量扫描生成全新的 `<repo>/kb/` 和新的 `.scan-state.json`。
5. 打印信息消息：
   `"Detected legacy ai/. Backed up to ai.v1-backup-<timestamp>/. Generated new kb/ from scratch. Remove the backup once v2 output is verified: rm -rf ai.v1-backup-*"`

**不询问用户确认**。迁移是每个仓库一次性的，且备份使其可逆。

## 后果

- v2 首次运行比稳态更重（全量扫描，无增量）。
- 如果用户忘记删除，备份目录可能堆积——可接受，gitignore 行使它们不会进入提交。
- 明确不构建编程式 v1→v2 转换工具。如果用户在 `ai/` 中有大量自定义编辑，他们需要在 v2 生成基线后手动将其重新应用到新的 `kb/` 结构中。
- 版本号升至 2.0.0 以标示破坏性变更。
