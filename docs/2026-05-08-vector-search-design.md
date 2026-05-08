# Vector Search 设计文档

## 概述

为 project-scan 知识库增加语义检索能力，通过向量化代码切片实现模糊搜索，让 Claude Code 能按语义定位代码实现。

## 架构

```
project-scan 插件（扫描 + 切片入库）
    ↓ 生成
知识库目录（ai/ + .vector-store/）
    ↑ 读取
vector-search 插件（语义检索）
```

两个独立 Claude Code 插件，通过知识库目录中的 `.vector-store/` 文件关联。

## 插件分工

### project-scan（现有插件，扩展）

- 扫描代码生成 ai/ 知识库文档（现有功能）
- 扫描完成后提示用户是否生成向量索引
- 检测 embedding 环境（Ollama / OpenAI）
- 执行切片 + embedding + 写入 `.vector-store/`
- `/project-scan update` 时同步更新向量库
- `/project-scan reindex` 全量重建向量索引
- 自动将 `.vector-store/` 追加到 .gitignore

### vector-search（新建插件）

- 提供 `/vector-search` 命令
- 读取 `.vector-store/` 执行语义检索
- 返回匹配的代码片段 + 文件路径 + 行号 + 相似度分数
- 支持 `--type=code|business` 过滤
- SKILL.md description 设置为自动触发（用户问"找代码""定位逻辑"时 Claude 自动调用）

## 技术选型

| 组件 | 选择 | 理由 |
|------|------|------|
| 向量数据库 | LanceDB (@lancedb/lancedb) | Node.js 原生绑定，本地文件存储，后期可迁移云端 |
| Embedding | 混合：Ollama 优先 → OpenAI 回退 | 不绑死依赖，适应不同用户环境 |
| Ollama 模型 | nomic-embed-text (768维) | 免费、本地、效果好 |
| OpenAI 模型 | text-embedding-3-small (1536维) | 便宜、快速、质量高 |
| 集成方式 | Skill + bash 脚本 | 安装简单，不需要 MCP 配置 |

## 存储结构

```
{知识库名}/
├── .vector-store/
│   ├── business/           ← 业务知识向量（给业务人员）
│   │   └── *.lance         ← LanceDB 数据文件
│   ├── code/               ← 代码切片向量（给开发者）
│   │   └── *.lance
│   └── meta.json           ← 索引元信息
├── ai/
├── CLAUDE.md
└── ...
```

### meta.json

```json
{
  "embedding_model": "ollama/nomic-embed-text",
  "dimensions": 768,
  "last_commit": "abc123",
  "chunk_count": 3500,
  "created_at": "2026-05-08",
  "updated_at": "2026-05-08"
}
```

## 切片策略

### 代码 collection 数据来源

- 原始源码文件（Java/Kotlin/TS/JS/Vue）
- ai/backend/ 技术文档
- ai/frontend/ 技术文档
- ai/backend/database-schema.md

### 业务 collection 数据来源

- ai/business/glossary.md
- ai/business/domain-rules.md
- ai/business/workflows.md
- ai/business/data-dictionary.md
- ai/business/faq.md
- prd/ 目录下的原始文档内容

### 切片规则

**文件 + 方法级混合策略：**

1. 短文件（<800 tokens）：整文件作为一个 chunk
2. 长文件：按方法/函数边界拆分
3. 超长方法（>1000 tokens）：硬切 1000 tokens + 200 tokens overlap
4. 每个 chunk 带上类名和 import 信息作为前缀

**方法边界检测（正则）：**
- Java/Kotlin: `(public|private|protected|internal).*\(`
- JS/TS: `(export\s+)?(function|const|class)\s+\w+`
- Vue: `<script>` 内按上述 JS/TS 规则

### Chunk metadata schema

```json
{
  "id": "uuid",
  "text": "chunk content",
  "file_path": "src/main/java/com/example/OrderService.java",
  "line_start": 45,
  "line_end": 92,
  "class_name": "OrderService",
  "method_name": "createOrder",
  "language": "java",
  "module": "order-service",
  "source_type": "code|doc",
  "vector": [...]
}
```

## Embedding 混合策略

### 检测优先级

```
1. curl http://localhost:11434/api/tags → 成功 → 用 Ollama nomic-embed-text
2. 检查 OPENAI_API_KEY 环境变量 → 有 → 用 text-embedding-3-small
3. 都没有 → 提示用户选择安装
```

### 模型切换处理

每次入库或查询前检查 meta.json 中记录的模型是否与当前可用模型一致：
- 一致 → 正常执行
- 不一致 → 提示："embedding 模型已变更（{旧} → {新}），需要重建索引。执行 reindex？(y/n)"

### 环境缺失提示

```
检测 embedding 环境：
✗ Ollama — 未检测到（localhost:11434 无响应）
✗ OpenAI — 未检测到 OPENAI_API_KEY 环境变量

请选择：
1. 启动 Ollama（brew install ollama && ollama serve && ollama pull nomic-embed-text）
2. 设置 OpenAI key（export OPENAI_API_KEY=xxx）
3. 跳过向量索引生成
```

## 检索参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| top_k | 5 | 返回结果数 |
| threshold | 0.7 | 相似度阈值，低于此值过滤 |
| type | 不限 | code / business 过滤 |

### 返回格式

```json
[
  {
    "score": 0.89,
    "file_path": "src/main/java/com/example/RefundService.java",
    "line_start": 67,
    "line_end": 95,
    "class_name": "RefundService",
    "method_name": "handleTimeout",
    "module": "order-service",
    "source_type": "code",
    "snippet": "public void handleTimeout(Order order) {\n    if (order.getStatus() == OrderStatus.PENDING_PAYMENT) {\n        ..."
  }
]
```

## 增量更新

### /project-scan update 时

```
git diff {.vector-store/meta.json.last_commit}..HEAD --name-only
→ 过滤出源码文件和 ai/ 文档
→ 删除这些文件对应的旧向量（按 file_path 匹配）
→ 重新切片 + embed + 入库
→ 更新 meta.json（last_commit, chunk_count, updated_at）
```

### /project-scan reindex 时

```
清空 .vector-store/ 下所有数据
→ 全量重新切片 + embed + 入库
→ 重写 meta.json
```

## 发现机制

vector-search 插件定位 .vector-store/ 的逻辑：

```
1. 读当前目录 CLAUDE.md → 提取 "External Knowledge Base" 路径
2. 去该路径下找 .vector-store/
3. 找不到 → 检查当前目录有没有 .scan-state.json → 读取 output 路径
4. 都没有 → 提示"未找到向量索引，请先运行 /project-scan"
```

## 用户流程

### 首次使用

```
1. claude plugin marketplace add xinxin1112/project-scan
2. claude plugin install project-scan
3. /project-scan → 扫描完成
4. 提示"是否生成向量索引？" → y
5. 检测 Ollama/OpenAI → 切片入库（显示进度条）
6. 完成提示：安装 vector-search 插件启用语义搜索
7. claude plugin marketplace add xinxin1112/vector-search
8. claude plugin install vector-search
9. /vector-search 退款超时逻辑 → 返回相关代码
```

### 日常更新

```
/project-scan update → 更新知识库 + 同步更新向量库
```

### 重建索引

```
/project-scan reindex → 全量重建（换模型后使用）
```

## 性能预期

| 场景 | Ollama (M1 Mac) | OpenAI API |
|------|-----------------|------------|
| 全量入库 (3000 chunks) | ~6 分钟 | ~3 分钟 |
| 增量更新 (100 chunks) | ~12 秒 | ~6 秒 |
| 单次查询 | <1 秒 | <2 秒 |

入库时显示进度：`[1234/3500] 35% — 预计剩余 3 分 42 秒`

## .gitignore 处理

project-scan 生成向量索引后自动追加：

```bash
echo ".vector-store/" >> {知识库目录}/.gitignore
```

## 错误处理

| 场景 | 处理 |
|------|------|
| LanceDB 安装失败 | 报错 + 提示系统环境要求 |
| Ollama 未运行 | 回退 OpenAI，都没有则提示三选一 |
| OpenAI key 无效 | 报错 + 提示检查 key |
| 切片过程中断 | 下次 reindex 重建，不做断点续传 |
| .vector-store/ 损坏 | 提示执行 reindex |

## 后期扩展路径

1. **远程部署**：vector-search.js 逻辑抽成 HTTP API 或 MCP server
2. **LanceDB Cloud**：本地 LanceDB 无缝迁移到云端
3. **Web 问答**：基于同一个 .vector-store/ 数据，加一个 Web 前端
4. **更多 embedding 模型**：支持 Cohere、本地 ONNX 模型等
