# project-scan

Claude Code 插件 — 扫描项目代码库，自动生成 AI 知识库（CLAUDE.md）和人类可读文档。

让 AI 在 30 秒内理解你的整个项目。

## 为什么需要它

当你把一个已有项目交给 Claude Code 时，它需要花大量时间阅读代码才能理解上下文。project-scan 通过一次扫描，生成结构化的知识库文件，让 AI 后续对话中直接拥有完整的项目认知：架构、API、数据模型、业务流程，全部就位。

## 功能

- **单项目扫描** — Java/Spring、Node.js、Go、Python、Rust 项目的完整扫描
- **多源扫描** — 同时扫描前端（Vue/React）+ 后端 + PRD 文档 + 数据库，生成统一知识库
- **数据库直连** — 自动解析表结构、推断关系、采样测试数据
- **业务知识提取** — 生成术语表、业务规则、流程图、数据字典（业务+开发共用）
- **向量索引 + 语义检索** — 代码切片 + embedding 入库，内置语义检索命令
- **Mermaid 图表** — 自动生成 ER 图、时序图、状态图、业务流程图
- **增量更新** — 基于 git diff 只更新变更部分，保持知识库常新
- **自动保鲜** — AI 读取知识库时自动检测过期模块，提示更新
- **定时自动更新** — 配置每日定时任务，自动检查生产分支变更并增量更新（macOS + Windows）

## 安装

```bash
# 添加 marketplace
claude plugin marketplace add xinxin1112/project-scan

# 安装插件
claude plugin install project-scan
```

## 更新

```bash
cd ~/.claude/plugins/marketplaces/project-scan-marketplace && git pull origin main
claude plugin install project-scan
```

## 使用

在 Claude Code 中输入：

```
/project-scan              # 自动检测模式（推荐）
/project-scan multi        # 强制多源扫描
/project-scan update       # 增量更新（基于 git diff）
/project-scan check        # 检查知识库新鲜度
/project-scan add-source   # 追加新数据源
/project-scan vector       # 生成向量索引
/project-scan reindex      # 全量重建向量索引
/project-scan search <query>  # 语义检索代码和文档
/project-scan auto-update     # 配置定时自动更新
/project-scan auto-update off # 关闭定时自动更新
/project-scan auto-update status # 查看自动更新状态
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

### 多源模式（多模块项目）

知识库以后端仓库名命名，源码放在 `code/` 下，按模块分目录生成知识库：

```
workspace/
├── pur-center/                        ← 知识库根目录（后端仓库名）
│   ├── code/                          ← 源码目录
│   │   ├── pur-center/                ← 后端代码
│   │   └── srm-web/                   ← 前端代码
│   ├── pur-reconcile/                 ← 模块 A 的知识库
│   │   ├── prd/                       ← 该模块的 PRD
│   │   ├── CLAUDE.md
│   │   ├── project-knowledge.md
│   │   ├── ai/
│   │   │   ├── backend/
│   │   │   ├── frontend/
│   │   │   └── cross-reference.md
│   │   ├── test-data/
│   │   └── .vector-store/             ← 向量索引
│   ├── pur-order/                     ← 模块 B 的知识库
│   │   └── ...
│   ├── .scan-state.json               ← 统一状态（repos + modules）
│   └── CLAUDE.md                      ← 根级模块索引
```

扫描完成后，插件会自动在源码仓库的 CLAUDE.md 中添加 External Knowledge Base 指针，让 AI 从源码目录自动发现知识库和向量索引。

## 典型使用流程

```
> /project-scan

请提供项目源：
1. 后端项目地址/路径：

> git@github.com:xxx/pur-center.git

2. 后端主分支名称（如 main/master/develop/release_prd）：

> release_prd

3. 前端项目地址/路径（没有可跳过）：

> git@github.com:xxx/srm-web.git

4. 前端主分支名称（如 main/master/develop/release_prd）：

> release_prd

正在 clone 源码（release_prd 分支）...

检测到多模块项目，包含以下模块：
- pur-order
- pur-reconcile
- pur-supplier
- ...

请选择要扫描的模块（逗号分隔，或输入 all）：

> pur-reconcile

源代码已就绪。请将 PRD 文档放入：
  ./pur-center/pur-reconcile/prd/
放好后回复"继续"开始扫描。

> 继续

扫描中...
```

## 自动检测逻辑

运行 `/project-scan` 时，插件会自动判断模式：

```
当前目录有 .scan-state.json？
├── 是 → 多源模式（提示：update / add-source / 重新扫描）
├── 否 → 当前目录有构建文件（pom.xml / build.gradle / package.json）？
│         ├── 是 → 单项目扫描
│         └── 否 → 询问 git 地址或项目路径
```

支持直接提供 git 仓库地址，插件会自动 clone 并扫描。

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

## 向量语义检索（可选）

扫描完成后，插件会提示是否生成向量索引。启用后可通过语义搜索定位代码：

**前置条件（二选一）：**
- Ollama 本地运行（`brew install ollama && ollama serve && ollama pull nomic-embed-text`）
- 设置 OpenAI API key（`export OPENAI_API_KEY=xxx`）

**使用方式：**

```
/project-scan search 退款超时处理逻辑
/project-scan search --type=business 对账流程
/project-scan search --type=code 用户权限校验
```

索引范围包括：
- 知识库文档（`ai/backend/`、`ai/frontend/`）
- 源码文件（从 `.scan-state.json` 中声明的源码路径自动解析）
- PRD 文档（`prd/` 目录）

## 定时自动更新（可选）

配置后每天定时检查生产分支变更，自动增量更新知识库和向量索引：

```
/project-scan auto-update          # 交互式配置（会询问是否启用、更新时间）
/project-scan auto-update off      # 关闭
/project-scan auto-update status   # 查看状态
```

支持 macOS（launchd）和 Windows（Task Scheduler）。

## 已知问题

- `claude plugin update project-scan` 不可用，请使用上方"更新"章节的手动方式

## License

MIT
