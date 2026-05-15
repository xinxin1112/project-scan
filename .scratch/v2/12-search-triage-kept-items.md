# [v2] search 子命令分流：保留 v2-plan 中与生成器对齐的项

**类型：** AFK
**Triage 标签：** ready-for-agent

## 要做什么

按 ADR 0001，search 在 v2 里降级为辅助 — 不投入"纯检索质量"的优化。但 `.scratch/vector-search-v2/plan.md` 里有一小部分项与生成器目标对齐，本切片把这些做掉。

### 保留的项

来自 v2 plan：

- **1.1 自定义 OpenAI 兼容 API**：支持 `EMBEDDING_BASE_URL` 和 `EMBEDDING_MODEL` 环境变量；优先级：自定义 > Ollama > OpenAI。B 站内部模型接入需要这个，跟 search 没关系
- **默认 embedding 模型从 `nomic-embed-text` 换成 `BAAI/bge-m3`**（Ollama 拉取名 `bge-m3`）：
  - **为什么换**：`nomic` 中文是英文训练顺带支持，混合中英文场景检索质量明显不足；`bge-m3` 100+ 语言训练，中文是一等公民，且代码标识符（英文）也处理良好
  - **指标对比**：维度 768 → 1024（区分度更细）；上下文 2048 → 8192（长方法/长文档不截断）
  - **部署**：`ollama pull bge-m3`，无云端依赖、完全免费
  - **场景吻合**：B 站内部无可用模型 + 项目中英文混合 + 不能外发代码 → 本地 bge-m3 是当前最优解
  - **备选**：bge-m3 拉不到时降级到 `multilingual-e5-large`；纯英文项目可用 `jina-embeddings-v2-base-code`
- **1.2 中文 token 估算修正**：检测内容中文比例，中文为主时用 `CHARS_PER_TOKEN = 1.5`。影响所有切片（包括 method-index 用到的批量请求）
- **1.3 Ollama 批量并发**：5–10 并发请求 `/api/embed`，或用新版批量端点。全仓索引提速 3–5x
- **2.1 文件类型扩展**：接受 `.xml`（MyBatis mapper）、`.sql`（DDL）、`.yaml` / `.yml`、`.properties`。生成器扫这些文件也需要
- **2.4 vector store 中加 `kb_layer` 元数据**：indexer 读 frontmatter 的 `kb_layer`，存为可查询字段。为未来的 `--layer` 过滤打基础（不重建索引）

### 明确**不**做

按 ADR 0001 暂停的项：v2 plan 中的 2.2（markdown 标题切分）、2.3（chunk 上下文前缀）、2.5（丰富元数据）、2.6（不截断存储），以及 3.1–3.7（阈值、混合搜索、rerank、去重、跨层搜索、上下文扩展、过滤维度）。

这些留在 `.scratch/vector-search-v2/plan.md` 里以后再看。

## 验收标准

- [ ] `EMBEDDING_BASE_URL=https://internal.example.com/v1` 设置后，embedding 调用走自定义 API
- [ ] **默认模型切换为 `bge-m3`**：`ollama pull bge-m3` 后无需额外配置即可使用
- [ ] 中文为主的模块产出的 chunk token 数合理（不会过分切割）
- [ ] pur-reconcile 全量索引比 v1 串行版本至少快 3 倍
- [ ] `.xml` / `.sql` 文件被接受并索引
- [ ] vector store 表里有 `kb_layer` 列，从 frontmatter 填充
- [ ] **抽查中文查询效果**：`/project-scan search 对账匹配规则` 的命中率明显优于换前的 nomic 基线（人工对比抽样）

## 决策依据

CONTEXT.md decision 11。ADR 0001 保留清单。

## 阻塞

- #1 探路弹（kb_layer frontmatter 合约必须先锁定）
