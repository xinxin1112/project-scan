# [v2] code 层：method-index — 机械提取 + 批量 LM 摘要

**类型：** AFK
**Triage 标签：** ready-for-agent

## 要做什么

每个模块产出一份 `kb/<module>/code/method-index.md`，按类分 section，列出全部 public 方法。

### 关键约束：分两段走，不要让 LM 写行号

method-index 的内容由两部分组成，必须严格分开：

**机械提取部分**（**不**走 LM）：
- 方法名
- 文件路径
- 起止行号
- 所属类
- 来源：tree-sitter / regex 静态解析

**LM 部分**：
- 每个方法的一句话"职责"摘要
- 调用方式：批量请求，每批 10–50 个方法

行号交给 LM 写**一定会出错**（幻觉），这是已知反模式。机械提取保证行号准确，LM 只补语义摘要。

### 第 5 类规则在这里**反过来**

#3 里说 Constants / 配置 / Util 类**不**产出独立 contract 文档。但在 method-index 里它们**要**收录 — 这是它们露面的唯一地方。method-index 不漏方法，但其他层的文档不为它们生成专用文件。

frontmatter 遵循 #1 合约；`sources` 列出索引扫过的所有源文件。

## 验收标准

- [ ] pur-reconcile 模块下**恰好**一份 `code/method-index.md`
- [ ] 模块所有 public 方法都出现在索引里，行号正确
- [ ] 抽查 5 个方法：行号与源码完全一致（无 LM 幻觉）
- [ ] 每个方法都有一句话"职责"摘要
- [ ] Constants / 配置 / Util 类的方法**出现**在索引里（不被跳过）
- [ ] LM 调用走批量路径；总调用次数 ≪ 方法数（验证方式：日志中 LM 请求计数）

## 决策依据

CONTEXT.md decision 9、27（机械提取 + 批量摘要）、32（第 5 类索引但不成文档）。

## 阻塞

- #1 探路弹（frontmatter 合约必须先锁定）
