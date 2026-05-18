---
name: project-scan
description: Use when scanning a project codebase to generate knowledge base, when needing to understand a legacy project quickly, when the user says "scan project", "generate docs", "project knowledge", wants CLAUDE.md generated from code, or when searching code by semantic meaning ("search code", "find implementation", "locate logic", "vector search")
---

# Project Scan v2.1

扫描项目代码库，生成结构化知识库（KB）+ 向量索引。支持多项目、前后端一体化、跨系统串联。

## 版本分发

```
检测 scan-config.yaml 是否存在？
├── 存在 → v2 模式（按子命令分发）
│     ├── 无参数 → Step 0 询问分支 → 全量扫描
│     ├── update → 增量更新（上次扫描的分支）
│     ├── update --branch=X → 增量更新指定分支
│     ├── search → 统一搜索（默认搜所有分支，--branch 指定）
│     ├── graph → 图谱操作
│     ├── level2 → 层次 2 生成
│     └── setup → 重新配置
└── 不存在 → 进入 setup 交互流程
```

**重要**：当 `scan-config.yaml` 不存在时，不走 v1 兼容模式，直接进入 v2 setup 引导。

## `/project-scan` 全量扫描完整流程（必须按顺序执行）

当用户跑 `/project-scan`（无参数或带 `--env`）时，按以下步骤**顺序执行**，每一步都不能跳过：

### Step 0 — 本地状态检测 + 分支选择

每次执行 `/project-scan` 时，先检测本地知识库状态：

```
检测 <output_dir> 下是否已有知识库：
├── 有 KB 文档 → 询问操作类型
└── 无 KB 文档 → 直接进入全量扫描
```

如果已有知识库，询问：
```
检测到已有知识库：
  - pur-center: 1004 份文档（release_prod，上次扫描：2026-05-18）
  - srm-web: 53 份文档（release，上次扫描：2026-05-18）
  - supplier-portal: 1 份文档（main，上次扫描：2026-05-18）

请选择操作：
1. 增量更新（更新已有项目的变更）
2. 新增项目（添加新的后端/前端项目）
3. 构建新分支（为其他分支构建知识库，不影响已有的）
4. 重建指定分支（只重建某个已有分支的知识库）
5. 全量重建（删除所有 KB，从头扫描所有项目所有分支）
```

STOP 等待用户回复。

**用户选 4（重建指定分支）**→ 列出已有分支让用户选：
```
已有的分支知识库：
1. prod（pur-center: release_prod, srm-web: release, supplier-portal: main）
2. test（pur-center: develop, srm-web: uat, supplier-portal: develop）

选择要重建的分支：
```
STOP 等待用户回复。

选择后确认：
```
确认重建 "{branch}" 分支的知识库？
这将删除该分支已有的 KB 和向量库，重新生成。不影响其他分支。
(y/n)
```
STOP 等待用户确认。

确认后删除该分支的 KB + 向量库，重新执行 Step 1 ~ Step 4（只针对该分支）。

**用户选 1（增量更新）**→ 等同于 `/project-scan update`，走增量更新流程。

**用户选 2（新增项目）**→ 进入新增项目引导：
```
新项目的 git 地址或本地路径：
```
STOP 等待用户回复。

```
项目名称（如 pur-settlement）：
```
STOP 等待用户回复。

```
分支名称：
```
STOP 等待用户回复。

```
项目类型：
1. 业务后端（Java/Spring，完整四层扫描）
2. 网关/转发层（只提取转发映射）
3. 前端（React，路由/API/Store/联动）
```
STOP 等待用户回复。

然后：
1. 追加到 scan-config.yaml 的 projects 列表
2. `git clone --depth 1 --branch <branch> <url> .sources/<name>`
3. 只扫描这个新项目（不动已有项目）
4. 构建该项目的向量库 + 图谱
5. 询问与已有项目的调用关系（追加到 relations）

**用户选 3（构建新分支）**→ 询问环境名：
```
选择要构建的环境：
1. test（测试环境）
2. 其他（手动输入环境名）

环境名对应 scan-config.yaml 的 branches 配置：
  branches:
    prod:                    ← --branch=prod
      pur-center: release_prod
      srm-web: release
      supplier-portal: main
    test:                    ← --branch=test
      pur-center: develop
      srm-web: uat
      supplier-portal: develop
```

STOP 等待用户回复。

选择后执行：
```bash
node scripts/scan-all.js <config-path> --branch=test
```

脚本会：
1. 读 `config.branches.test` 获取每个项目的实际 git 分支
2. 使用 worktree 路径 `.sources/<project>-<env>/`（如不存在则自动 `git worktree add` 创建）
3. KB 输出到 `<project>/test/kb/`（目录名用环境名，不用 git 分支名）
4. 构建向量库 + 图谱
5. 完成后不切回（下次 update 时按 `.scan-state.json` 记录的分支更新）

**用户选 4（全量重建）**→ 确认后删除现有 KB，从头执行 Step 1 ~ Step 5。

### Step 1 — 执行 scan-all.js（KB 生成，层次 1）
```bash
cd <skill-dir> && node scripts/scan-all.js <config-path>
```
如果超时，KB 文档已生成，继续下一步。
注意：scan-all.js 不再构建向量库（向量库移到最后一步）。

### Step 2 — 构建 GitNexus 知识图谱
```bash
node scripts/graph-index.js <config-path>
```

先检测 GitNexus 是否安装：
```bash
which gitnexus
```
如果未安装，提示用户：
```
GitNexus 未安装。影响分析功能需要 GitNexus。

安装命令：npm install -g gitnexus

是否现在安装？
1. 是，自动安装
2. 否，跳过图谱构建（后续可用 /project-scan graph 补建）
```

STOP 等待用户回复。

用户选 1 → 执行 `npm install -g gitnexus` → 安装完成后继续构建图谱。
用户选 2 → 跳过 Step 2，继续 Step 3。

图谱构建耗时较长（2-3 分钟/项目），**应在后台执行**，不阻塞后续步骤：
```bash
# 后台执行，继续 Step 3
node scripts/graph-index.js <config-path> &
```
图谱构建完成后会自动生成 `.mcp.json`。
用于影响分析（"改了这个方法会影响哪些模块"）。约 2-3 分钟/项目。

图谱构建完成后，在用户的项目目录下生成 `.mcp.json`（如果不存在）：
```json
{
  "mcpServers": {
    "gitnexus": {
      "command": "gitnexus",
      "args": ["mcp"]
    }
  }
}
```
这样新会话启动时 Claude 自动加载 GitNexus MCP，可以直接查影响分析，不需要手动跑命令。

### Step 3 — 询问是否执行层次 2
**必须问这一步，不能跳过。** 见下方"层次 2 引导"段。
层次 2 会覆盖部分层次 1 文档，所以向量库放在层次 2 之后构建。

### Step 4 — 构建向量库（一次性，基于最终文档）
```bash
node scripts/kb-vector-index.js <kb-dir> <vector-store-dir>
```
在层次 2 完成后（或用户跳过层次 2 后）构建。只建一次，基于最终版本的文档。

**应在后台执行**（耗时较长，不需要交互）：
```bash
# 后台执行，不阻塞
node scripts/kb-vector-index.js <kb-dir> <vector-store-dir> &
```
完成后输出 chunk 数量。

### Step 5 — 输出扫描摘要
```
扫描完成：
  - pur-center: X 份文档，Y 个模块
  - srm-web: X 份文档，Y 个 app
  - supplier-portal: X 份文档
  - 向量库: 已构建 / 未构建
  - 层次 2: 已执行 / 跳过
```

## v2 子命令

| 命令 | 说明 | 脚本 |
|------|------|------|
| `/project-scan` | 全量扫描所有项目 | `node scripts/scan-all.js` |
| `/project-scan update` | 增量更新（只重生成过期文档） | `node scripts/incremental.js` |
| `/project-scan update --force` | 强制重生成（含 human_edited） | `node scripts/incremental.js --force` |
| `/project-scan update --auto-lm` | 增量 + 自动调 LM 重生成层次2 flow | `node scripts/incremental.js --auto-lm` |
| `/project-scan search <query>` | 跨项目语义搜索 | `node scripts/unified-search.js <query>` |
| `/project-scan search <query> --project=X` | 只搜指定项目 | `node scripts/unified-search.js <query> --project=X` |
| `/project-scan check` | 新鲜度检查（交互式） | `node scripts/freshness.js --force` |
| `/project-scan verify` | 覆盖率校验 | `node scripts/verify.js` |
| `/project-scan level2` | 对核心方法/组件生成层次 2 | 交互式（前后端都做） |
| `/project-scan level2 --backend` | 只做后端层次 2 | 分析 Service 方法体 |
| `/project-scan level2 --frontend` | 只做前端层次 2 | 分析表单组件联动 |
| `/project-scan level2 --frontend --project=srm-web` | 指定前端项目 | 只分析该项目 |
| `/project-scan level2 --frontend --project=srm-web --app=reconcile-mng` | 指定 app | 只分析该 app |
| `/project-scan level2 --backend --project=pur-center` | 指定后端项目 | 只分析该项目 |
| `/project-scan level2 --backend --project=pur-center --module=pur-reconcile` | 指定模块 | 只分析该模块 |
| `/project-scan level2 --backend --method=confirm` | 指定方法 | 只分析该方法 |
| `/project-scan graph` | 构建/重建知识图谱（GitNexus） | `node scripts/graph-index.js` |
| `/project-scan graph --project=X` | 只索引指定项目 | `node scripts/graph-index.js --project=X` |
| `/project-scan graph --impact=<target>` | 影响分析（改了 target 会影响什么） | `node scripts/graph-query.js impact <target>` |
| `/project-scan graph --impact=<target> --downstream` | 下游影响（target 依赖什么） | `node scripts/graph-query.js impact <target> --direction=downstream` |
| `/project-scan graph --context=<symbol>` | 符号 360° 视图（调用方+被调方+所属流程） | `node scripts/graph-query.js context <symbol>` |
| `/project-scan graph --query=<search>` | 图谱语义搜索 | `node scripts/graph-query.js query <search>` |
| `/project-scan graph --detect-changes` | 检测 git diff 影响了哪些符号和流程 | `node scripts/graph-query.js detect-changes` |
| `/project-scan graph --web` | 启动 Web UI 查看交互式图谱 | `npx gitnexus serve` |

## v2 setup 交互流程（`/project-scan setup`）

当 `scan-config.yaml` 不存在，或用户显式调用 `/project-scan setup` 时执行。

### Step 1 — 输出目录

```
知识库输出目录（所有项目的 KB + 向量库都放这里）：
```

STOP 等待用户回复。默认建议当前目录或 `~/bilibili/project-scan`。

### Step 2 — 收集后端项目

```
后端项目 git 地址或本地路径：
（支持多个后端项目，逗号分隔或多次输入。输入"完成"结束）
```

STOP 等待用户回复。

对每个后端项目：

```
{项目名} 的生产分支名称（如 main/master/release_prd）：
```

STOP 等待用户回复。

```
{项目名} 的角色：
1. 业务后端（完整四层扫描）
2. 网关/转发层（只提取转发映射）
```

STOP 等待用户回复。

如果是业务后端，检测多模块：
```bash
# 从 settings.gradle 或 pom.xml 解析模块列表
```

```
检测到以下模块：
- pur-reconcile
- pur-order
- pur-supplier
- ...

请选择要扫描的模块（逗号分隔，或 all）：
```

STOP 等待用户回复。

对选中的每个模块，自动检测路径（entity_path、controller_path、enum_path 等）。如果检测不到，问用户：

```
模块 {name} 的 Entity 目录路径（相对于项目根）：
（检测到候选：app/{name}/src/main/java/.../entity/）
直接回车确认，或输入其他路径：
```

### Step 3 — 收集前端项目

```
前端项目 git 地址或本地路径（没有可输入"跳过"）：
```

STOP 等待用户回复。

如果有前端项目：

```
{项目名} 的生产分支名称：
```

STOP 等待用户回复。

检测前端 apps：
```
检测到以下前端应用：
- reconcile-mng (apps/reconcile-mng)
- supplier-c (apps/supplier-c)
- ...

请选择要扫描的应用（逗号分隔，或 all）：
```

STOP 等待用户回复。

检测共享资源：
```
检测到字典文件：packages/dictionary/src/generated/dictConstants.ts
检测到 API 生成目录：packages/service/src/generated/
确认？(y/n)
```

### Step 4 — 项目间关系

如果有多个项目：

```
请描述项目间的调用关系：

已收集的项目：
- pur-center (业务后端)
- srm-web (前端)
- supplier-portal (网关)

前端应用 reconcile-mng 调用哪个后端？
1. 直连 pur-center
2. 经过 supplier-portal 转发到 pur-center
3. 其他

前端应用 supplier-c 调用哪个后端？
1. 直连 pur-center
2. 经过 supplier-portal 转发到 pur-center
3. 其他
```

STOP 等待用户回复。

### Step 5 — 数据库（可选）

```
是否配置数据库连接？（用于获取 DDL 字段类型/索引信息）
1. 是
2. 否（从代码推断）
```

STOP 等待用户回复。

如果选是：
```
数据库类型：mysql / postgresql
Host:
Port:
Database:
Username:
Password 环境变量名（如 PUR_DB_PASSWORD，实际密码通过 export 设置）：
```

STOP 等待用户回复。

### Step 6 — 生成配置文件

收集完所有信息后，调用脚本生成 `scan-config.yaml`：

```bash
node ${SKILL_DIR}/scripts/generate-config.js \
  --output-dir="{用户指定的输出目录}" \
  --config='{收集到的 JSON 配置}'
```

输出：
```
✓ 配置文件已生成：{output_dir}/scan-config.yaml

下一步：
  /project-scan          ← 开始全量扫描
  /project-scan search   ← 扫描完成后可用
```

### Step 7 — Clone 源码（如果是 git 地址）

对每个 git 地址的项目：
```bash
mkdir -p {output_dir}/.sources
git clone --depth 1 --branch {branch} {git_url} {output_dir}/.sources/{project_name}
```

如果是本地路径，在 config 里直接引用该路径（不 clone）。

## v2 向量库配置（首次运行时交互）

全量扫描完成后，询问用户是否构建向量库：

```
扫描完成，共生成 X 份文档。

是否构建向量索引？（支持语义搜索，如"确认对账单报错"）
  1. 是，构建向量库（需要 Ollama + bge-m3 模型，约 1.2GB）
  2. 否，只保留 markdown 文档（后续可用 /project-scan reindex 补建）

用户选 1 →
  检测 Ollama 是否运行：
    ├─ 未运行 → 提示："请先启动 Ollama：ollama serve"，等待用户确认后重试
    └─ 已运行 → 检测 bge-m3 模型：
        ├─ 已安装 → 直接构建向量库
        └─ 未安装 → 提示：
            "embedding 模型 bge-m3 未安装（约 1.2GB）。
             是否自动拉取？
               1. 是，自动拉取（ollama pull bge-m3）
               2. 否，我手动安装后再运行 /project-scan reindex"
            用户选 1 → 执行 ollama pull bge-m3 → 等待完成 → 构建向量库
            用户选 2 → 跳过向量库，扫描结束

用户选 2 → 跳过向量库，扫描结束
```

### 向量库相关命令

| 命令 | 说明 |
|------|------|
| `/project-scan reindex` | 重建所有项目的向量库（切换模型后使用） |
| `/project-scan search <query>` | 跨项目语义搜索（需要向量库已构建） |

### 环境变量覆盖

```bash
# 使用自定义 embedding 模型（如内部部署的模型）
export EMBEDDING_MODEL=bge-m3
export EMBEDDING_BASE_URL=http://127.0.0.1:11434  # 默认 Ollama 地址

# 使用 OpenAI 兼容 API
export EMBEDDING_BASE_URL=https://your-api.example.com/v1
export EMBEDDING_MODEL=text-embedding-3-small
```

## v2 层次 2 引导（向量库构建完成后）

向量库构建完成后，询问用户是否对核心方法/组件生成层次 2 文档：

```
向量库构建完成。

是否对核心业务方法和表单组件生成「层次 2」文档？

层次 2 是什么：
  - 层次 1（已生成）：机械提取的调用链/字段列表，适合简单接口和页面
  - 层次 2（可选）：AI 读源码后输出完整的业务逻辑文档，适合核心复杂逻辑

后端层次 2（条件分支 + 异常码 + 事务边界）：
  示例（confirm.md 片段）：
  | 步骤 | 条件 | 走向 | 异常码 |
  | 1 | reconcileStatus != SUPPLIER_CONFIRMED | 抛异常 | RECONCILE_USAGE_STATUS_NOT_ALLOWED |
  | 2 | isFlowRequest = true | 走审批流程 | — |

前端层次 2（完整字段联动 + 值传递 + 级联清空 + 动态计算）：
  示例（field-linkage-detail.md 片段）：
  | 触发 | 效果 | 条件 |
  | 修改采购类别 | 弹确认框 → 清空明细行旧类别字段 | 已有明细行 |
  | 修改账单月份 | 调接口获取汇率 → 重算每行人民币金额 | 有非 CNY 币种 |

选择：
  1. 是，对核心方法和组件生成层次 2（约 2-5 分钟/个）
  2. 只做后端层次 2
  3. 只做前端层次 2
  4. 否，后续手动执行
```

STOP 等待用户回复。

### 后端层次 2 执行

**重要：源码路径规则**
- prod 环境 → 读 `.sources/<project>/` 的代码
- test 环境 → 读 `.sources/<project>-test/` 的代码（worktree）
- **不要切分支**，直接读对应 worktree 目录的源码

从 scan-config.yaml 的 `flow_level2.core_methods` 读取核心方法列表。
如果没有配置，**通过 GitNexus 图谱快速检测**（< 1 秒）：

```bash
gitnexus cypher -r <project> "
  MATCH (m:Method)
  WHERE (m.filePath CONTAINS '/application/impl/' OR m.filePath CONTAINS '/application/')
    AND NOT m.filePath CONTAINS '/test/'
    AND NOT m.name CONTAINS 'get' AND NOT m.name CONTAINS 'query'
    AND NOT m.name CONTAINS 'list' AND NOT m.name CONTAINS 'count'
  WITH m
  MATCH (m)-[call:CodeRelation {type: 'CALLS'}]->(target)
  WITH m, count(DISTINCT target) as callCount
  WHERE callCount >= 5
  RETURN m.name, m.filePath, callCount
  ORDER BY callCount DESC
"
```

按模块分组取 top-2，排除纯导出/查询方法。确保每个有 Controller 的模块至少有 1 个方法被选中。

如果 GitNexus 图谱不可用，回退到源码扫描（慢）：从 flow 文档中找满足以下任一条件的方法：
- 调用了 ≥3 个不同的 Service/Client
- 有状态转移（setStatus/updateStatus）
- 有事务注解（@Transactional）
- 调用链深度 ≥ 3 层
- 整条调用链的方法体总行数 ≥ 100 行

对每个核心方法：
1. 读取 Controller + Service 源码（从对应环境的 worktree 路径读）
2. 用 `flow-level2-builder.js` 构建分析 prompt
3. 当前 AI 会话直接分析代码，输出结构化的层次 2 文档
4. 写入 `<project>/<branch>/kb/<module>/flows/<method>.md`（覆盖层次 1 版本）

### 前端层次 2 执行

**源码路径同上**：读对应环境的 worktree 目录，不切分支。

自动检测核心表单组件：对每个有 `pages/` 目录的前端 app，找文件最大 + 含 `Form`/`Editor`/`FooterContent`/`Drawer`/`Modal` 的 **top-2** 组件（预计 8-12 个组件）。

对每个核心组件：
1. 读取组件完整源码（含关联的 hooks/constants）
2. AI 分析输出结构化文档，包含：
   - **值传递**：A 字段变化 → B 字段怎么变（触发/效果/条件）
   - **条件展示**：什么角色/状态/类型下哪些字段可见
   - **条件禁用**：什么模式下哪些字段不能编辑
   - **动态必填**：后端返回控制哪些字段必填
   - **级联清空**：改了什么会清空什么（含确认提示文案）
   - **动态计算**：公式 + 触发时机
   - **按钮权限**：什么节点/模式下显示什么按钮
3. 写入 `kb/<app>/field-linkage-detail.md` 和 `kb/<app>/node-button-field-matrix.md`（覆盖脚本生成的简化版）

### 完成后

全部完成后，自动重建向量库（层次 2 文档已变更，向量库需要同步）：
```bash
node scripts/kb-vector-index.js <kb-dir> <vector-store-dir>
```
输出："✓ 层次 2 生成完成（后端 X 份 + 前端 Y 份），向量库已同步更新"

用户选 4 → 跳过，扫描结束。提示：
```
好的。后续需要时执行：
  /project-scan update --auto-lm    ← 自动对所有核心方法/组件生成层次 2
  或在对话中说"帮我分析 confirm 方法的条件分支" ← 单个方法手动生成
  或在对话中说"帮我分析 DetailForm 的字段联动" ← 单个组件手动生成
```

---

```bash
cd /Users/a6667/.claude/skills/project-scan
export PUR_DB_PASSWORD=<从环境变量读>
node scripts/scan-all.js /Users/a6667/bilibili/project-scan/scan-config.yaml
```

内部流程：
1. 读 `scan-config.yaml`
2. 对每个 project 按 type 分发：

### Java/Spring 后端（type: java-spring）
对每个 module 生成：
- `domain/entities/` — 从 Entity.java + DDL（连 MySQL）生成字段表（含类型/长度/非空/默认值/索引）
- `domain/enums/` — 从 @HermesLocalDict 枚举生成 code + 描述表
- `domain/state-machines/` — 从 setStatus/updateStatus 调用提取状态转移 + Mermaid 图
- `domain/rules/` — 定位含决策逻辑的方法（if-else 密度 ≥ 2）
- `domain/error-codes.md` — 从异常码枚举 + Asserts.check 调用提取码值 + 抛出位置 + 触发条件
- `contracts/internal/` — 从 Controller 的 @RequestMapping 提取端点列表
- `contracts/external/` — 从 Callback/Webhook Controller 提取
- `flows/` — 调用链（深度 2，接口→实现类映射）+ 事务/异步注解标注
- `code/method-index.md` — 全部 public 方法（精确行号 + 注解列）
- `shared/domain/enums/` — pur-common 共享枚举（不归属单一模块）

### Java/Spring 网关（type: java-spring, role: gateway）
只生成：
- `api-mapping.md` — 从 Retrofit @GET/@POST 注解提取转发路径表 + 鉴权说明

### React 前端（type: react）
对每个 app 生成：
- `routes.md` — 路由表（从 router/ 目录提取 path）
- `api-client.md` — API 函数列表（从 generated/*.ts 提取 export const）
- `api-types.md` — 接口 Req/Res 类型定义（从 *.types.ts 提取 namespace + interface）
- `page-index.md` — 页面 + 共享组件索引
- `stores.md` — Zustand store 的 state + action
- `hermes-dict.md` — 全部 hermesDict 字典常量（code + 中文标签，按业务域分组）
- `frontend-enums.md` — 前端状态聚合映射（6 态 → 后端枚举，含 getDisplayStatus 函数）
- `field-linkage-rules.md` — 字段联动规则（隐藏/禁用/动态必填，从 useMemo + hiddenFields + disabledFields + requiredFieldMap 提取）
- `node-button-field-matrix.md` — 节点×按钮×字段权限矩阵（从 useOperator + AuthOperate + permissionOperate 提取）
- `backend-mapping.md` — 前后端函数级映射（前端 API 函数 → 后端 flow 文档链接）

### 跨项目
- `system-topology.md` — 从 scan-config.yaml 的 relations 自动生成调用拓扑图
- `frontend-backend-map.md` — 从 relations 生成前后端路由总表
- 每个前端 app 的 `backend-mapping.md` — 自动匹配前端函数名 → 后端 flow 文件

### 向量库
每个项目独立建 `.vector-store/`（lancedb + bge-m3），支持跨项目统一搜索。

## v2 增量更新流程（`/project-scan update`）

### 分支选择

检测已有哪些分支的 KB：
```
├── 只有 1 个分支 → 直接更新，不询问
└── 有多个分支 → 询问：
    "检测到以下分支的知识库：
      1. release_prod（上次更新：2026-05-18）
      2. develop（上次更新：2026-05-16）
      3. 全部更新
    请选择要更新的分支："
    STOP 等待用户回复。
```

### 执行

```bash
node scripts/incremental.js kb . [--force] [--auto-lm]
```

内部流程：
1. 确定源码路径：prod → `.sources/<project>/`，test → `.sources/<project>-test/`（worktree，不切分支）
2. 在对应 worktree 里 `git pull` 拉最新代码
3. 检测人工编辑（body hash 比对）→ 自动标记 human_edited
2. git diff 找过期文档（sources 反向索引）
3. 分类：
   - 层次 1（纯脚本）→ 直接重生成
   - 层次 2（含条件分支/联动）→ 看 `scan-config.yaml` 的 `level2` 配置：
     - `level2.backend.auto_update: true` → 自动重生成后端层次 2
     - `level2.frontend.auto_update: true` → 自动重生成前端层次 2
     - 两者都为 false → 跳过层次 2（除非显式传 `--auto-lm`）
4. 跳过 human_edited 文档（除非 `--force`）
5. 重建向量库（只重新 embed 变化的文档）
6. GitNexus 图谱同步：`npx gitnexus analyze <source-dir> --index-only`
   - commit 没变 → 1.5 秒跳过
   - commit 变了 → 全量重建图谱（约 2.5 分钟）

## v2 搜索流程（`/project-scan search`）

```bash
node scripts/unified-search.js "查询内容" [--project=pur-center] [--top=10]
```

跨 3 个项目的向量库搜索，合并排序返回 top-K。

## 配置文件位置

```
/Users/a6667/bilibili/project-scan/scan-config.yaml        ← 默认（生产）
/Users/a6667/bilibili/project-scan/scan-config.test.yaml   ← 测试环境（可选）
```

## 多分支支持

同一个 `scan-config.yaml`，通过 **git worktree** 支持多分支（每个分支独立目录，图谱不互相覆盖）：

```
/project-scan                    ← 询问操作后执行
/project-scan update             ← 更新（单分支直接跑，多分支让用户选）
/project-scan search "xxx" --branch=test  ← 搜索指定分支的知识库
/project-scan graph --impact=X --branch=prod  ← 指定分支的图谱
```

物理结构（使用 git worktree）：
```
<output_dir>/
├── scan-config.yaml
├── .sources/
│   ├── pur-center/              ← release_prod（主 worktree）
│   │   └── .gitnexus/          ← prod 图谱
│   ├── pur-center-test/         ← develop（worktree）
│   │   └── .gitnexus/          ← test 图谱
│   ├── srm-web/                 ← release（主 worktree）
│   ├── srm-web-test/            ← uat（worktree）
│   ├── supplier-portal/         ← main（主 worktree）
│   └── supplier-portal-test/    ← develop（worktree）
├── pur-center/
│   ├── prod/kb/ + .vector-store/
│   └── test/kb/ + .vector-store/
├── srm-web/
│   ├── prod/kb/ + .vector-store/
│   └── test/kb/ + .vector-store/
└── supplier-portal/
    ├── prod/kb/ + .vector-store/
    └── test/kb/ + .vector-store/
```

构建新分支时自动创建 worktree：
```bash
cd .sources/<project>
git worktree add ../<project>-<env> <branch>
```

scan-all.js 的 `--branch=test` 会读 `.sources/<project>-test/` 作为源码路径。

## 知识库物理位置

```
/Users/a6667/bilibili/project-scan/
├── scan-config.yaml
├── system-topology.md
├── frontend-backend-map.md
├── pur-center/kb/ + .vector-store/
├── srm-web/kb/ + .vector-store/
└── supplier-portal/kb/ + .vector-store/
```

---
