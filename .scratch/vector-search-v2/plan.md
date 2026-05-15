# Project-Scan 向量搜索 V2 改进计划

## 背景

基于"结构化领域知识库驱动开发"理念，对 project-scan 插件的向量搜索能力进行全面升级。

核心理念：四层结构化知识库
- domain/（数据与规则：实体DDL、枚举、状态机、决策表）
- contracts/（接口契约：内部服务间、外部回调）
- flows/（流程编排：步骤、输入输出、异常处理）
- code/（实现索引：方法→行号→类→职责）

## 改进目标

让向量搜索感知四层结构，支持跨层关联查询，提升中文业务场景的搜索质量。

---

## 一、embed.js — Embedding 提供者改进

### 1.1 支持自定义 OpenAI 兼容 API

**现状**：只支持 Ollama（nomic-embed-text, 768维）和 OpenAI（text-embedding-3-small, 1536维），OpenAI endpoint 硬编码 `api.openai.com`。

**问题**：无法接入 bilibili 内部 API 或其他 OpenAI 兼容服务（如本地部署的 bge-m3）。

**改进**：
- 支持 `EMBEDDING_BASE_URL` 环境变量
- 支持 `EMBEDDING_MODEL` 环境变量覆盖默认模型
- 检测优先级改为：自定义 API > Ollama > OpenAI

### 1.2 中文 Token 估算修正

**现状**：`CHARS_PER_TOKEN = 4`（英文估算）。

**问题**：中文一个字≈1-2 token，用 4 严重低估中文 token 数，导致 chunk 过大。

**改进**：检测内容语言比例，中文为主时用 `CHARS_PER_TOKEN = 1.5`。

### 1.3 Ollama 批量并发

**现状**：Ollama 逐条串行请求。

**问题**：3500 chunks 全量索引极慢。

**改进**：加并发控制（5-10 并发），或使用 Ollama 新版 `/api/embed` 批量接口。

### 1.4 重试机制

**现状**：无重试，单条失败整体中断。

**改进**：指数退避重试（3次），单条失败记录日志但不中断。

### 1.5 Token 截断保护

**现状**：超长文本直接发给 API。

**改进**：按模型 max_tokens 截断（nomic 8192, OpenAI 8191, bge 8192）。

---

## 二、vector-index.js — 索引构建改进

### 2.1 支持更多文件类型

**现状**：只支持 `.java .kt .ts .tsx .js .jsx .vue .py .go .rs` + `.md .txt`

**改进**：加入 `.xml`（MyBatis mapper）、`.sql`（DDL）、`.yaml/.yml`、`.properties`、`.json`

### 2.2 Markdown 按标题切分

**现状**：Markdown 和代码用同一套方法边界切分逻辑。

**问题**：对知识库文档（如 state-machines/initiate-lifecycle.md）按方法正则切分无意义。

**改进**：对 `.md` 文件按 `##` 标题层级切分，每个 section 一个 chunk，保留父标题作为上下文。

### 2.3 Chunk 加上下文前缀

**现状**：每个 chunk 只有方法体本身。

**问题**：AI 看到一个方法片段，不知道它属于哪个 Service、依赖什么。

**改进**：每个代码 chunk 前缀加上 `package 声明 + 关键 import + class 声明头`（约 200-300 字符）。

### 2.4 加入 `layer` 语义标签

**现状**：只分 `code` 和 `business` 两个 collection。

**问题**：不感知四层结构，搜索时无法按 domain/contracts/flows/code 过滤。

**改进**：
- 自动检测文件所属层（基于路径和内容特征）
- 加 `layer` 字段：`domain` / `contract` / `flow` / `code` / `config` / `doc`
- 检测规则：
  - `domain/` 或包含 DDL/状态机/枚举定义 → domain
  - `contracts/` 或包含接口定义/回调规范 → contract
  - `flows/` 或包含流程步骤描述 → flow
  - 源码文件 → code
  - 配置文件 → config

### 2.5 丰富元数据

**现状**：`file_path, line_start, line_end, class_name, method_name, language, module, source_type`

**改进**：加入：
- `package_name`：Java 包路径
- `annotations`：类/方法注解（@Service, @Controller, @RestController 等）
- `arch_layer`：架构层（controller / service / dao / entity）
- `layer`：知识库层（domain / contract / flow / code）
- `related_entities`：关联的实体名（从 import 和类型引用提取）

### 2.6 存储文本不截断

**现状**：`text` 字段截断到 2000 字符。

**改进**：存储完整文本（LanceDB 支持大字段），搜索结果展示时再截断。

---

## 三、vector-search.js — 搜索改进

### 3.1 降低默认阈值

**现状**：默认 threshold = 0.7。

**问题**：中文 embedding 的 cosine 相似度普遍偏低，大量相关结果被过滤。

**改进**：降到 0.45，或改为动态阈值（top_k 结果中最高分的 55%）。

### 3.2 混合搜索

**现状**：纯向量搜索。

**问题**：搜类名 `PayOverSeasCallbackServiceImpl` 用向量搜效果差。

**改进**：
- 向量搜索取 top 20
- 关键词搜索（对 text + file_path + class_name + method_name 做全文匹配）取 top 20
- 合并去重，加权排序（向量分 * 0.7 + 关键词分 * 0.3）

### 3.3 简单 Rerank

**现状**：无 rerank。

**改进**：对 top 20 结果做关键词加权：
- query 中的词出现在 chunk 的 class_name/method_name 中 → +0.15
- query 中的词出现在 chunk text 中 → +0.05 * 出现次数（上限 0.1）

### 3.4 结果去重

**现状**：同一方法可能因 overlap 出现两次。

**改进**：按 `file_path + line_start` 去重，保留分数高的。

### 3.5 跨层关联搜索

**现状**：搜索只返回单独的 chunk 列表。

**改进**：加 `--cross-layer` 模式：
- 搜索后，对每个结果检查是否有其他层的关联内容
- 关联规则：同一 module 下、相同实体名/方法名、文件路径有交叉引用
- 结果按层分组展示

### 3.6 上下文扩展

**现状**：只返回 snippet 前 500 字符。

**改进**：支持 `--expand` 参数，返回当前 chunk 的前后相邻 chunk 作为上下文。

### 3.7 更多过滤维度

**现状**：只支持 `--type=code|business`。

**改进**：加 `--module=`、`--lang=`、`--layer=`、`--class=` 过滤。

---

## 四、优先级排序

| 优先级 | 改进项 | 预期效果 | 工作量 |
|--------|--------|----------|--------|
| P0 | 1.1 支持自定义 API | 接入中文模型，搜索质量大幅提升 | 小 |
| P0 | 3.1 降低阈值 | 立刻减少漏召回 | 极小 |
| P0 | 1.2 中文 token 修正 | 分块更合理 | 极小 |
| P1 | 2.2 Markdown 按标题切分 | 知识库文档搜索质量提升 | 中 |
| P1 | 2.3 Chunk 加上下文前缀 | 搜索结果可读性提升 | 中 |
| P1 | 3.2 混合搜索 | 精确搜索场景覆盖 | 中 |
| P1 | 2.4 加 layer 标签 | 支持四层过滤和跨层关联 | 中 |
| P2 | 1.3 Ollama 批量并发 | 全量索引速度 3-5x | 小 |
| P2 | 1.4 重试机制 | 索引稳定性 | 小 |
| P2 | 3.3 简单 rerank | 搜索精度提升 | 中 |
| P2 | 2.1 更多文件类型 | 覆盖 MyBatis XML、SQL | 小 |
| P2 | 3.5 跨层关联搜索 | 实现四层联动查询 | 大 |

---

## 参考文档

- 现有设计文档：`docs/2026-05-08-vector-search-design.md`
- 四层知识库理念：`kb-driven-dev-sharing.md`
- 现有实现：`scripts/embed.js`、`scripts/vector-index.js`、`scripts/vector-search.js`
