# project-scan

Claude Code 插件 — 扫描项目代码库，自动生成 AI 知识库（CLAUDE.md）和人类可读文档。

让 AI 在 30 秒内理解你的整个项目。

## 为什么需要它

当你把一个已有项目交给 Claude Code 时，它需要花大量时间阅读代码才能理解上下文。project-scan 通过一次扫描，生成结构化的知识库文件，让 AI 后续对话中直接拥有完整的项目认知：架构、API、数据模型、业务流程，全部就位。

## 功能

- **单项目扫描** — Java/Spring、Node.js、Go、Python、Rust 项目的完整扫描
- **多源扫描** — 同时扫描前端（Vue/React）+ 后端 + PRD 文档 + 数据库，生成统一知识库
- **数据库直连** — 自动解析表结构、推断关系、采样测试数据
- **Mermaid 图表** — 自动生成 ER 图、时序图、状态图、业务流程图
- **增量更新** — 基于 git diff 只更新变更部分，保持知识库常新
- **自动保鲜** — AI 读取知识库时自动检测过期模块，提示更新

## 安装

```bash
# 1. 添加 marketplace
claude plugin marketplace add github:xinxin1112/project-scan

# 2. 安装插件
claude plugin install project-scan
```

## 更新

```bash
claude plugin update project-scan
```

## 使用

在 Claude Code 中输入：

```
/project-scan              # 自动检测模式（推荐）
/project-scan multi        # 强制多源扫描
/project-scan update       # 增量更新（基于 git diff）
/project-scan check        # 检查知识库新鲜度
/project-scan add-source   # 追加新数据源
```

## 输出结构

### 单项目模式

```
project-root/
├── CLAUDE.md                          ← AI 入口索引
└── docs/knowledge-base/
    ├── project-knowledge.md           ← 完整文档（架构、API、ER图、流程图）
    └── test-data/                     ← 采样的业务数据
```

### 多源模式

```
{output-dir}/
├── CLAUDE.md                          ← AI 入口索引
├── project-knowledge.md               ← 聚合文档（含 Mermaid 图）
├── ai/                                ← 拆分的 AI 上下文文件
│   ├── backend-api.md
│   ├── backend-architecture.md
│   ├── database-schema.md
│   ├── frontend-routes.md
│   ├── frontend-api-calls.md
│   ├── cross-reference.md
│   └── ...
├── test-data/                         ← 测试数据
└── .scan-state.json                   ← 扫描状态（用于增量更新）
```

## 自动检测逻辑

运行 `/project-scan` 时，插件会自动判断模式：

```
当前目录有 .scan-state.json？
├── 是 → 多源模式（提示：update / add-source / 重新扫描）
├── 否 → 当前目录有构建文件（pom.xml / build.gradle / package.json）？
│         ├── 是 → 单项目扫描
│         └── 否 → 询问项目路径，然后根据路径内容决定模式
```

可以在任意目录运行，插件会引导你输入项目路径。

## 支持的技术栈

| 后端 | 前端 | 数据库 |
|------|------|--------|
| Java / Spring Boot | Vue 2/3 | MySQL |
| Gradle / Maven | React / Next.js | PostgreSQL |
| MyBatis / JPA | Pinia / Vuex / Redux | — |
| Node.js / Go / Python / Rust | TanStack Query / RTK Query | — |

## 生成的图表示例

插件会自动生成以下 Mermaid 图表：

- **ER 图** — 数据库表关系
- **时序图** — 核心业务接口调用链
- **状态图** — 订单/审批等状态机
- **流程图** — 核心业务操作流程

## 工作原理

1. 扫描项目结构，识别技术栈和框架
2. 解析源码提取：路由、API、数据模型、状态管理
3. 连接数据库（可选）读取表结构和采样数据
4. 交叉引用前后端 API 调用关系
5. 生成结构化 Markdown 知识库 + CLAUDE.md 索引

## 增量更新

运行 `/project-scan update` 时，插件基于 `git diff` 分析变更文件，只重新扫描受影响的模块：

| 变更文件 | 触发更新 |
|----------|----------|
| Controller / Route | API 文档 |
| Entity / Model | 数据模型 + ER 图 |
| 前端路由配置 | 路由表 |
| API 调用层 | 前端 API + 交叉引用 |
| 数据库 migration | Schema + ER 图 |

## 配置

无需额外配置。插件通过交互式问答收集必要信息（数据库连接、源目录路径等）。

扫描状态保存在 `.scan-state.json` 中，支持后续增量更新和新鲜度检查。

## License

MIT
