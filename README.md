# project-scan v2.2

Claude Code skill — 扫描项目代码库，生成结构化知识库 + 向量索引 + 知识图谱。支持多项目、前后端一体化、跨系统串联、影响分析。

## v1 → v2 迁移

首次运行 v2 时，旧 `ai/` 目录自动备份到 `ai.v1-backup-<timestamp>/`。确认 v2 输出正确后可手动删除备份。

## 核心能力

### 后端（Java/Spring 完整四层）
- **Domain** — Entity（含 DDL 类型/长度/索引）、Enum、状态机（Mermaid 图）、业务规则候选、异常码索引
- **Contracts** — Controller 端点（HTTP/路径/参数/返回类型）、外部回调接口
- **Flows** — 调用链（深度 2）+ 事务标注 + 条件分支（层次 2，LM 辅助）
- **Code** — 方法索引（精确行号 + 注解列）

### 前端（React）
- 路由表、API 客户端、页面/组件索引、Zustand Store
- hermesDict 字典常量（含全部 code + 中文标签）
- 前端状态聚合映射（6 态 → 后端枚举）
- 字段联动逻辑（值传递/条件展示/级联清空/动态计算）— 层次 2 支持 AI 精准分析
- 节点 × 按钮 × 字段权限矩阵

### 跨项目
- 系统拓扑图（前端 → 网关 → 后端 → 外部系统）
- 前后端接口映射（前端函数 → 后端 flow 链接）
- 网关转发映射（Retrofit → pur-center）

### 知识图谱（GitNexus）
- Tree-sitter AST 解析 → 函数级调用图（86K+ 节点，213K+ 边）
- **影响分析** — "改了这个方法会影响哪些模块/流程"
- **符号上下文** — 调用方 + 被调方 + 所属执行流
- **变更检测** — git diff → 受影响的符号和流程
- 增量同步（commit 没变 1.5s 跳过，变了自动重建）

### 向量搜索
- 模型：bge-m3（多语言，中文一等公民，1024 维，8192 上下文）
- 跨项目统一搜索（一次查询命中前端 + 网关 + 后端）
- 5 并发 embedding，中文 token 估算优化

### 层次 2（AI 精准分析）
- **后端**：条件分支 + 异常码 + 事务边界 + 决策点表
- **前端**：完整字段联动 + 值传递 + 级联清空 + 动态计算 + 按钮权限
- 支持按项目/模块/app/方法粒度执行
- 完成后自动重建向量库

### 增量更新
- sources 反向索引（git diff → 精确定位过期文档）
- 人工编辑保护（body hash 检测 + human_edited 标记）
- 层次 1/2 分流（纯脚本 vs 需要 LM）
- GitNexus 图谱自动同步
- 12h 新鲜度检查 + feature 分支保护

## 命令

| 命令 | 说明 |
|------|------|
| `/project-scan` | 全量扫描（KB + 图谱 + 层次 2 引导 + 向量库） |
| `/project-scan setup` | 首次配置（交互式生成 scan-config.yaml） |
| `/project-scan update` | 增量更新 |
| `/project-scan update --force` | 强制重生成（含 human_edited 文档） |
| `/project-scan update --auto-lm` | 增量 + 自动 LM 重生成层次 2 |
| `/project-scan search <query>` | 跨项目语义搜索 |
| `/project-scan search <query> --project=X` | 只搜指定项目 |
| `/project-scan check` | 新鲜度检查 |
| `/project-scan verify` | 覆盖率校验 |
| `/project-scan level2` | 层次 2 生成（前后端都做） |
| `/project-scan level2 --backend` | 只做后端层次 2 |
| `/project-scan level2 --frontend` | 只做前端层次 2 |
| `/project-scan level2 --backend --project=X --module=Y` | 指定模块 |
| `/project-scan level2 --frontend --project=X --app=Y` | 指定 app |
| `/project-scan graph` | 构建/重建知识图谱 |
| `/project-scan graph --project=X` | 只索引指定项目 |
| `/project-scan graph --impact=<target>` | 影响分析 |
| `/project-scan graph --impact=<target> --downstream` | 下游影响 |
| `/project-scan graph --context=<symbol>` | 符号 360° 视图 |
| `/project-scan graph --detect-changes` | git diff 影响检测 |
| `/project-scan graph --web` | 启动 Web UI 查看图谱 |

## 技术栈支持

| 技术栈 | 支持程度 |
|--------|---------|
| Java/Spring Boot + MyBatis-Plus | 完整四层 |
| React + Zustand | 路由/API/Store/字典/联动/权限矩阵 |
| Java 网关（Retrofit 转发） | 转发映射 |
| Vue/Go/Python/Rust | method-index 索引（四层支持在 v2.x 路线图） |

## 配置

首次使用需要 `scan-config.yaml`：

```yaml
output_dir: /path/to/knowledge-base
embedding:
  model: bge-m3
projects:
  - name: my-backend
    type: java-spring
    source: /path/to/source
    branch: main
    modules: [...]
  - name: my-frontend
    type: react
    source: /path/to/source
    apps: [...]
```

## 依赖

- Node.js 18+
- Ollama（本地运行 bge-m3 模型）
- GitNexus（知识图谱，`npm install -g gitnexus`）
- MySQL（可选，用于获取 DDL）
- lancedb（向量存储）

```bash
# 安装 embedding 模型
ollama pull bge-m3

# 安装 Node 依赖
cd ~/.claude/skills/project-scan && npm install
```

## 输出结构

```
/path/to/knowledge-base/
├── scan-config.yaml
├── system-topology.md          ← 跨项目拓扑
├── frontend-backend-map.md     ← 前后端映射
├── .sources/                   ← git clone 源码副本
│   ├── <backend>/.gitnexus/   ← GitNexus 图谱数据
│   ├── <frontend>/.gitnexus/
│   └── <gateway>/.gitnexus/
├── <backend-project>/
│   ├── kb/
│   │   ├── <module>/
│   │   │   ├── domain/{entities,enums,state-machines,rules,error-codes}
│   │   │   ├── contracts/{internal,external}
│   │   │   ├── flows/
│   │   │   └── code/method-index.md
│   │   └── shared/domain/enums/
│   ├── .vector-store/
│   └── prd/                    ← PRD 文档（项目级，不分模块）
├── <frontend-project>/
│   ├── kb/<app>/{routes,api-client,stores,hermes-dict,field-linkage,...}
│   └── .vector-store/
└── <gateway-project>/
    ├── kb/api-mapping.md
    └── .vector-store/
```

## 补充能力：向量搜索

```bash
# 跨项目搜索
/project-scan search "确认对账单报错"

# 只搜后端
/project-scan search "状态转移" --project=pur-center

# 只搜前端
/project-scan search "下拉选项" --project=srm-web
```

## 安装

```bash
# 1. 克隆到 Claude Code skills 目录
git clone git@github.com:xinxin1112/project-scan.git ~/.claude/skills/project-scan

# 2. 安装 Node 依赖
cd ~/.claude/skills/project-scan && npm install

# 3. 安装 embedding 模型（向量搜索）
ollama pull bge-m3

# 4. 安装 GitNexus（知识图谱 + 影响分析）
npm install -g gitnexus
```

安装完成后，在任意项目目录下运行 `/project-scan` 即可使用。

## 更新

```bash
cd ~/.claude/skills/project-scan && git pull origin main && npm install
```

如果 embedding 模型有更新：

```bash
ollama pull bge-m3
/project-scan reindex  # 重建向量库
```

## 设计文档

- `CONTEXT.md` — 锁定的设计决策
- `docs/adr/` — 架构决策记录（5 份）
- `docs/session-notes.md` — 设计 grill 会话记录
- `docs/v2-implementation-plan.md` — 实施计划

## Changelog

### v2.2.0 (2026-05-18)

**New Features:**
- GitNexus 知识图谱集成（影响分析、符号上下文、变更检测）
- `/project-scan graph` 子命令族（impact/context/detect-changes/web）
- `/project-scan level2` 子命令（支持 --backend/--frontend/--project/--module/--app）
- `/project-scan setup` 交互式配置引导
- 前端层次 2（AI 精准分析字段联动 + 值传递 + 级联清空 + 动态计算）
- 项目/模块/app 自动检测（scan-config.yaml 不需要写 modules）
- 并行扫描（项目级 + 模块级 + app 级）
- Ollama embedding 5 并发

**Improvements:**
- 向量库只建一次（层次 2 完成后），不再重复构建
- 增量更新自动同步 GitNexus 图谱
- 跨项目文档 bug 修复（undefined → 正确的项目名）
- SKILL.md 删除 v1 兼容段（2000+ 行），避免 AI 走错路径

### v2.1.0 (2026-05-15)

**Fixes:**
- SKILL.md 移到根目录，修复 `/project-scan` 命令无法注册的问题
- 向量库构建加入交互式引导（检测 Ollama + bge-m3，用户可选跳过）

**Docs:**
- CONTEXT.md 同步实际实现（KB 位置、多项目、跨项目串联、层次 2 flow、CLAUDE.md 补丁废弃）
- ADR 0005 更新：React 前端有专属文档类型集（不是降级模式）
- README 加安装/更新命令

### v2.0.0 (2026-05-15)

**Breaking Changes:**
- 输出从 `ai/` 改为 `kb/`，按四层组织（domain / contracts / flows / code）
- 完整四层支持范围收窄到 Java/Spring；其他语言只生成 method-index
- 知识库物理位置从项目仓库内移到独立目录

**New Features:**
- 多项目扫描（一条命令扫前端 + 后端 + 网关）
- 前后端一体化（API 映射、字段校验、字典、联动规则、权限矩阵）
- 跨系统串联（system-topology + 统一搜索）
- 12h 新鲜度模型 + stale 标记 + 答案水印
- 人工编辑保护（update 不覆盖手改过的文档）
- 异常码索引（code + 抛出位置 + 触发条件）
- 层次 2 flow（条件分支 + 事务边界 + 异常码，LM 辅助）
- bge-m3 嵌入模型（中文优化，8192 上下文）
- verify-report.md 覆盖率校验
- 前端表单校验 vs 数据库约束比对

**Migration:**
- v1 `ai/` 在首次跑 v2 时自动备份到 `ai.v1-backup-<timestamp>/`
