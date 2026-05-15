---
name: project-scan
description: Use when scanning a project codebase to generate knowledge base, when needing to understand a legacy project quickly, when the user says "scan project", "generate docs", "project knowledge", wants CLAUDE.md generated from code, or when searching code by semantic meaning ("search code", "find implementation", "locate logic", "vector search")
---

# Project Scan v2.1

扫描项目代码库，生成结构化知识库（KB）+ 向量索引。支持多项目、前后端一体化、跨系统串联。

## 版本分发

```
检测 scan-config.yaml 是否存在？（优先检查 output_dir，其次当前目录）
├── 存在 → v2 模式（按子命令分发）
│     ├── 无参数 → 全量扫描（scan-all.js）
│     ├── update → 增量更新
│     ├── search → 统一搜索
│     └── ...
└── 不存在 → 进入 setup 交互流程（生成 scan-config.yaml）
```

**重要**：当 `scan-config.yaml` 不存在时，不走 v1 兼容模式，直接进入 v2 setup 引导。

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

从 scan-config.yaml 的 `flow_level2.core_methods` 读取核心方法列表。
如果没有配置，自动检测：从已生成的 flow 文档中找调用链最长 + 有状态转移的 top-5 方法。

对每个核心方法：
1. 读取 Controller + Service 源码
2. 用 `flow-level2-builder.js` 构建分析 prompt
3. 当前 AI 会话直接分析代码，输出结构化的层次 2 文档
4. 写入 `kb/<module>/flows/<method>.md`（覆盖层次 1 版本）

### 前端层次 2 执行

自动检测核心表单组件：从前端 app 的 `pages/` 目录中找文件最大 + 含 `Form`/`Editor`/`FooterContent` 的 top-3 组件。

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

```bash
node scripts/incremental.js kb . [--force] [--auto-lm]
```

内部流程：
1. 检测人工编辑（body hash 比对）→ 自动标记 human_edited
2. git diff 找过期文档（sources 反向索引）
3. 分类：
   - 层次 1（纯脚本）→ 直接重生成
   - 层次 2（含条件分支/联动）→ 看 `scan-config.yaml` 的 `level2` 配置：
     - `level2.backend.auto_update: true` → 自动重生成后端层次 2
     - `level2.frontend.auto_update: true` → 自动重生成前端层次 2
     - 两者都为 false → 跳过层次 2（除非显式传 `--auto-lm`）
4. 跳过 human_edited 文档（除非 `--force`）
5. 重建向量库

## v2 搜索流程（`/project-scan search`）

```bash
node scripts/unified-search.js "查询内容" [--project=pur-center] [--top=10]
```

跨 3 个项目的向量库搜索，合并排序返回 top-K。

## 配置文件位置

```
/Users/a6667/bilibili/project-scan/scan-config.yaml
```

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

## v1 兼容模式（scan-config.yaml 不存在时）

## 初始化（每次执行 /project-scan 时首先运行）

```bash
# 检测并安装依赖
if [ ! -d "${CLAUDE_PLUGIN_ROOT}/node_modules/mysql2" ]; then
  echo "正在安装数据库依赖..."
  cd ${CLAUDE_PLUGIN_ROOT} && npm install --silent
fi
```

此步骤在插件启动时自动执行，确保后续数据库扫描可用。如果 npm install 失败则跳过，不影响其他功能。

## Argument Dispatch

| Argument | Mode | Output |
|----------|------|--------|
| (none) | Auto-detect | 检测当前目录决定模式（见下方规则） |
| `multi` | Multi-source scan | 强制进入多源扫描 Phase 0，无论当前目录状态 |
| `ai` | AI context only | 只生成 ai/ 目录文件 + CLAUDE.md |
| `human` | Human docs only | 只生成 project-knowledge.md |
| `update` | Incremental | 基于 .scan-state.json 增量更新所有过期模块，无交互 |
| `check` | Freshness check | 检查各模块是否过期，只输出报告，不执行更新 |
| `add-source` | Add source | 读取现有 .scan-state.json，追加新源或修改网关规则 |
| `reindex` | Vector reindex | 全量重建向量索引（切换 embedding 模型后使用） |
| `vector` | Vector index | 对已有知识库生成向量索引（首次启用向量检索时使用） |
| `auto-update` | Setup auto-update | 配置每日定时自动更新（需用户确认） |
| `auto-update off` | Disable auto-update | 关闭定时自动更新 |
| `auto-update status` | Check auto-update | 查看当前自动更新配置状态 |
| `search <query>` | Vector search | 语义检索代码和业务文档 |

### Auto-detect Logic (无参数时)

```
当前目录有 .scan-state.json？
├── 是 → 检查 mode 字段
│         ├── mode = "multi-source" 且有 modules → 根目录模式（见下方）
│         └── 其他 → 执行新鲜度检查（见下方），根据结果给出选项
├── 否 → 当前目录的子目录有 .scan-state.json？（向下找一层）
│         ├── 是 → 提示："检测到知识库在父目录 {path}，请在该目录下执行 /project-scan"
│         └── 否 → 当前目录有构建文件（pom.xml/build.gradle/package.json 等）？
│                   ├── 是 → 单项目扫描（现有 Phase 1-9 逻辑）
│                   └── 否 → 询问项目路径（见下方 Path Prompt）
```

#### 根目录模式（多模块知识库）

检测到 `.scan-state.json` 中 `mode = "multi-source"` 且有 `modules` 字段时，展示模块列表和操作菜单：

```
检测到多模块知识库（{知识库名}）

模块列表：
  {模块1} — 上次扫描：{lastScan}
  {模块2} — 上次扫描：{lastScan}

操作：
1. 检查所有模块新鲜度
2. 更新过期模块
3. 添加新模块（复用已有源码）
4. 生成/重建向量索引
5. 配置自动更新
6. 退出
```

STOP 等待用户回复。

用户选择后：
- 选 1（检查新鲜度）→ 对所有模块执行新鲜度检查，展示结果后再次给出操作菜单
- 选 2（更新过期模块）→ 检查新鲜度后自动更新所有过期模块，完成后展示后续操作菜单
- 选 3（添加新模块）→ 进入"添加新模块"流程（见下方）
- 选 4（向量索引）→ 询问对哪个模块操作，然后进入 Phase 19
- 选 5（配置自动更新）→ 进入 Phase 20
- 选 6（退出）→ 结束

#### 添加新模块（复用已有 code/）

从 `.scan-state.json` 的 `repos` 字段获取已 clone 的仓库路径，检测可用但尚未建立知识库的模块：

```bash
# 后端：从 settings.gradle / pom.xml 解析所有模块
# 前端：从 apps/ 或 packages/ 扫描所有应用
# 过滤掉 modules 中已有的模块
```

```
已有源码中检测到以下未扫描的后端模块：
- pur-order
- pur-supplier
- pur-payment

请选择要添加的模块（逗号分隔）：
```

STOP 等待用户回复。

```
为 {模块名} 选择关联的前端应用（逗号分隔，或跳过）：
- order-mng
- supplier-mng

```

STOP 等待用户回复。

选择完成后：
- 在 `.scan-state.json` 的 `modules` 中添加新模块配置
- 创建模块目录和 `prd/` 子目录
- 提示放入 PRD 后开始扫描

#### 已有知识库时的新鲜度检查

检测到 `.scan-state.json` 后，遍历 `modules` 中每个模块的 `sources`，检查新鲜度：

```bash
# 源码路径解析：repos[source.repo].path + "/" + source.subpath
# 例如：code/pur-center/app/pur-reconcile

# 对每个 backend 源
cd {repos[source.repo].path}
git fetch origin {repos[source.repo].branch} --quiet 2>/dev/null || true
git log -1 --format=%H origin/{branch} -- {source.subpath}
# 对比 modules[模块].commits[source.name]

# 对每个 frontend 源
cd {repos[source.repo].path}
git fetch origin {repos[source.repo].branch} --quiet 2>/dev/null || true
git log -1 --format=%H origin/{branch} -- {source.subpath}
# 对比 modules[模块].commits[source.name]

# 对每个 PRD 源（modules[模块].prd[]）
# type=file: stat -f "%m %z" {path}
# type=directory: find {path} -type f \( -name "*.md" -o -name "*.pdf" -o -name "*.docx" \) -newer {module}/ai/business/glossary.md
# 有新文件或修改文件 → 标记为过期
```

**如果全部最新：**
```
检测到已有知识库（上次扫描：{lastScan}）

正在检查新鲜度...
✓ backend/{module-1} — 最新
✓ backend/{module-2} — 最新
✓ frontend/{project} — 最新

知识库已是最新，无需更新。是否仍要：
1. 重新全量扫描
2. 追加新数据源
3. 生成向量索引
4. 配置自动更新
5. 退出
```

STOP 等待用户回复。

用户选择后：
- 选 1（重新全量扫描）→ 重新进入 Phase 0 源收集流程
- 选 2（追加新数据源）→ 进入 add-source 流程
- 选 3（生成向量索引）→ 直接进入 Phase 19
- 选 4（配置自动更新）→ 进入 Phase 20 自动更新配置流程
- 选 5（退出）→ 结束

**如果有过期模块：**
```
检测到已有知识库（上次扫描：{lastScan}）

正在检查新鲜度...
✓ backend/{module-1} — 最新
✗ backend/{module-2} — 过期（{N} commits behind）
✓ frontend/{project} — 最新
✗ document/{filename} — 过期（文件已修改）

建议操作：
1. 更新过期模块（增量更新）
2. 重新全量扫描
3. 追加新数据源
4. 生成向量索引
5. 配置自动更新
6. 退出
```

STOP 等待用户回复。

用户选择后：
- 选 1（更新过期模块）→ 执行增量更新逻辑（同 `/project-scan update`，但只更新过期的），完成后展示后续操作菜单
- 选 2（重新全量扫描）→ 重新进入 Phase 0 源收集流程
- 选 3（追加新数据源）→ 进入 add-source 流程
- 选 4（生成向量索引）→ 直接进入 Phase 19
- 选 5（配置自动更新）→ 进入 Phase 20 自动更新配置流程
- 选 6（退出）→ 结束

#### 增量更新完成后的后续操作

增量更新（从菜单选择或 Auto-Refresh 触发）完成后，展示后续操作菜单：

```
更新完成。还需要其他操作吗？

1. 生成向量索引
2. 配置自动更新
3. 追加新数据源
4. 重新全量扫描
5. 结束
```

STOP 等待用户回复。

注意：`/project-scan update` 直接调用时不展示此菜单（无交互模式）。

### Path Prompt（源收集）

当前目录无法识别为项目时，进入交互式源收集。**逐个询问，每个问题单独等待回复：**

```
请提供后端项目 git 地址或本地路径：
```

STOP 等待用户回复。

```
后端生产分支名称（如 main/master/release_prd/develop）：
```

STOP 等待用户回复。

```
前端项目 git 地址或本地路径（没有可输入"跳过"）：
```

STOP 等待用户回复。如果用户输入了前端地址，继续问：

```
前端生产分支名称（如 main/master/release_prd/develop）：
```

STOP 等待用户回复。

注意：生产分支名称**没有默认值**，必须让用户明确填写。不同项目生产分支命名差异大（main、master、prd、release_prd、develop 等），不可假设。

#### 输入格式识别

| 输入格式 | 处理方式 |
|----------|----------|
| `git@...` 或 `https://...*.git` | git clone 到知识库根目录下 |
| 绝对/相对路径 | 直接使用该路径 |

#### Clone 行为

- 知识库根目录名 = git 仓库名（如 `pur-center`、`srm-web`），自动从 git 地址解析
- clone 到 `{当前目录}/{知识库名}/code/{repo-name}/`
- 使用 `git clone --depth 1 --branch {生产分支名} {地址}` 浅克隆指定分支
- clone 完成后，对每个源执行 Auto-detect 判断类型（后端/前端）
- 如果 clone 失败，提示用户检查地址、分支名和权限，STOP 等待

生产分支名称用于：
- clone 时拉取该分支代码
- 增量更新时作为 git diff 的基准分支

#### 多模块检测

clone 完成后，**分别**检测后端和前端是否为多模块项目：

**后端多模块检测：**
- Gradle multi-module：根目录有 `settings.gradle(.kts)`，解析 `include` 语句
- Maven multi-module：根 `pom.xml` 有 `<modules>` 标签

**前端多模块检测：**
- Turborepo / pnpm workspace：检查 `turbo.json`、`pnpm-workspace.yaml`、根 `package.json` 的 `workspaces` 字段
- 扫描 `apps/` 或 `packages/` 目录下的子项目（每个有独立 `package.json` 的目录）

检测到多模块后，**分别询问**：

```
检测到后端多模块项目，包含以下模块：
- pur-order
- pur-reconcile
- pur-supplier
- ...

请选择要扫描的后端模块（逗号分隔，或输入 all）：
```

STOP 等待用户回复。收到回答后继续：

```
检测到前端多模块项目，包含以下应用：
- acceptance-mng
- order-mng
- reconcile-mng
- supplier-c
- ...

请选择要扫描的前端应用（逗号分隔，或输入 all，或跳过）：
```

STOP 等待用户回复。

用户选择模块后，**按后端模块名建立知识库子目录**，前端选择的应用作为该模块知识库中 `ai/frontend/` 的扫描范围。

#### PRD 目录

模块确定后，在每个模块的知识库目录下 **必须执行** `mkdir -p` 创建 `prd/` 目录，然后提示：

```
源代码已就绪。请将 PRD 文档放入对应模块的 prd/ 目录：
  {当前目录}/{知识库名}/{模块名}/prd/

支持格式：.md / .pdf / .docx / .png / .jpg
也可直接指定外部文档路径（文件或目录均可）。

放好后回复"继续"开始扫描，或直接回复"继续"跳过 PRD。
如需指定外部路径，直接输入路径即可。
```

STOP 等待用户回复。用户回复"继续"后：
- 检查各 `prd/` 目录是否有文件
- 有文件 → 纳入 Phase 16（PRD 提取）
- 无文件 → 跳过 Phase 16

#### 输出目录结构

知识库根目录以 git 仓库名命名，源码放在 `code/` 下，知识库按模块分目录：

```
{当前目录}/
├── {知识库名}/                        ← 以后端仓库名命名（如 pur-center）
│   ├── code/                          ← 源码目录
│   │   ├── pur-center/                ← 后端代码（git clone）
│   │   └── srm-web/                   ← 前端代码（git clone）
│   ├── {模块名-1}/                    ← 模块级知识库（如 pur-reconcile）
│   │   ├── prd/                       ← 该模块的 PRD 文档
│   │   ├── CLAUDE.md
│   │   ├── project-knowledge.md
│   │   ├── ai/
│   │   │   ├── backend/
│   │   │   │   ├── architecture.md
│   │   │   │   ├── api.md
│   │   │   │   ├── database-schema.md
│   │   │   │   └── business-flow.md
│   │   │   ├── frontend/
│   │   │   │   ├── routes.md
│   │   │   │   ├── api-calls.md
│   │   │   │   ├── state-management.md
│   │   │   │   └── components.md
│   │   │   ├── business/              ← 业务知识（业务+开发共用）
│   │   │   │   ├── glossary.md        ← 业务术语表（中英文对照）
│   │   │   │   ├── domain-rules.md    ← 业务规则（从代码逻辑提取）
│   │   │   │   ├── workflows.md       ← 业务流程（Mermaid 流程图）
│   │   │   │   ├── data-dictionary.md ← 数据字典（业务语言描述字段含义）
│   │   │   │   └── faq.md             ← 常见问题（从 PRD + 代码推断）
│   │   │   └── cross-reference.md
│   │   ├── test-data/
│   │   └── .vector-store/             ← 向量索引（可选）
│   ├── {模块名-2}/                    ← 另一个模块的知识库
│   │   └── ...
│   ├── .scan-state.json               ← 统一扫描状态（根目录唯一）
│   └── CLAUDE.md                      ← 根级索引
```

**注意：`.scan-state.json` 只存在于知识库根目录，模块子目录不再有独立的状态文件。**

#### .scan-state.json 格式（多模块）

```json
{
  "version": "1.7.0",
  "lastScan": "2026-05-08",
  "mode": "multi-source",
  "repos": {
    "pur-center": { "path": "code/pur-center", "branch": "release_prod", "type": "backend" },
    "srm-web": { "path": "code/srm-web", "branch": "release", "type": "frontend" }
  },
  "modules": {
    "pur-reconcile": {
      "lastScan": "2026-05-08",
      "sources": [
        { "type": "backend", "name": "pur-reconcile", "repo": "pur-center", "subpath": "app/pur-reconcile" },
        { "type": "frontend", "name": "reconcile-mng", "repo": "srm-web", "subpath": "apps/reconcile-mng" }
      ],
      "commits": { "pur-reconcile": "abc123...", "reconcile-mng": "def456..." },
      "phases": { "phase1-detection": { "status": "completed", "date": "2026-05-08" } }
    }
  },
  "gateway": { "rule": "/api/{path} → /{path}" },
  "database": { "type": "mysql", "host": "...", "port": 3306, "database": "...", "username": "..." }
}
```

字段说明：
- `repos` — 已 clone 的仓库列表（code/ 下的目录），添加新模块时复用
- `modules` — 各模块的扫描状态，每个模块记录自己的 sources、commits、phases
- `commits` — 各源的最新已扫描 commit hash，用于增量更新时判断是否过期
- 源码实际路径 = `{repos[repo].path}/{subpath}`（如 `code/pur-center/app/pur-reconcile`）

如果不是多模块项目（单模块），则不建子目录，知识库直接生成在知识库根目录下：

```
{当前目录}/
├── {知识库名}/
│   ├── code/
│   │   ├── backend-repo/
│   │   └── frontend-repo/
│   ├── prd/
│   ├── CLAUDE.md
│   ├── project-knowledge.md
│   ├── ai/
│   │   ├── backend/
│   │   ├── frontend/
│   │   └── cross-reference.md
│   ├── test-data/
│   └── .scan-state.json
```

### 单项目与多源模式共存

- 单项目扫描保持不变（向后兼容）
- 多源扫描是独立功能，通过 Phase 0 交互流程或 `multi` 参数触发
- 如果检测到源项目中已有 `docs/knowledge-base/`，在扫描摘要中提示："检测到 {project} 已有单项目知识库，多源知识库生成后建议删除旧的以避免信息冲突"
- `update`/`check`/`add-source` 通过当前目录是否有 `.scan-state.json` 判断是多源模式还是单项目模式

## User Interaction Protocol

When you need user input (datasource selection, module confirmation), output the question as plain text with numbered options. Then STOP — your response is complete. Wait for the user to reply before continuing. Do NOT guess or assume the answer.

## Execution Flow

- Multi-source mode (Phase 0 triggered): Execute Phase 0, then conditionally Phase 1-9 (backend), Phase 10-15 (frontend), Phase 16 (PRD), Phase 17 (cross-reference), Phase 18 (output).
- Single-project mode: Execute phases 1-9 in order, then generate output based on mode.

### Phase 0: Source Collection (Multi-Source Mode Only)

Executed when: `multi` argument, or auto-detect triggers multi-source mode.

**Step 1 — Main Branch Detection:**

For each source project, detect the main branch:
```bash
cd {project-path}
git fetch origin --quiet 2>/dev/null || true
git branch -r | grep -E "origin/(main|master|develop)" | head -5
```

Git fetch fallback logic:
```
git fetch origin {main-branch} --quiet
├── 成功 → git worktree add ... origin/{main-branch}
└── 失败（网络不通）→ 检查 origin/{main-branch} 是否存在
      ├── 存在 → 使用本地缓存的 origin/{main-branch}，提示"使用本地缓存的远程分支，可能不是最新"
      └── 不存在 → 使用本地 {main-branch}，提示"使用本地分支"
```

If only one main/master branch → auto-use. If ambiguous → ask user:
```
项目 {project-name} 检测到以下远程分支：
1. origin/main
2. origin/develop
3. origin/release/v2.0

请选择作为知识库基准的生产分支：>
```

**Stop and wait for user reply.**

**Step 2 — Collect Sources:**

Interactive source collection loop:
```
请提供要扫描的源（输入编号选择类型，输入 done 结束）：

1. 后端项目（Java/Spring 模块）
2. 前端项目（Vue/React）
3. PRD/设计文档
4. 数据库连接（手动填写）

>
```

For each source type, collect path → detect main branch → select modules/directories.

**后端项目收集：**
```
后端项目路径：> /path/to/ehr-core
生产分支确认：origin/main ✓

检测到以下模块：
1. user-service
2. order-service
3. common

请选择要扫描的模块（逗号分隔，或 all）：>
```

**前端项目收集：**
```
前端项目路径：> /path/to/ehr-web
生产分支确认：origin/main ✓
检测到框架：Vue 3 + Vite + TypeScript

检测到以下目录结构：
1. src/views/user/    (12 files)
2. src/views/order/   (8 files)
3. src/components/    (25 files)

请选择要扫描的目录范围（逗号分隔，或 all）：>
```

**PRD/文档收集：**
```
文档路径（支持 PDF/Word/Markdown/图片，可指定文件或目录）：> /path/to/docs/prd/

检测到目录，包含以下文档：
  1. sku-price-management.md
  2. sku-management.md
  3. README.md (跳过)

将扫描 2 个文档。确认？(y/n)
```

路径规则：
- 指向文件 → 直接处理该文件
- 指向目录 → 扫描目录下所有支持格式的文件（`.md`、`.pdf`、`.docx`、`.png`、`.jpg`）
- 自动跳过 `README.md`、`CHANGELOG.md` 等非 PRD 文件
- 支持多次添加（输入多个路径，逗号分隔或多次选择"3. PRD/设计文档"）

**数据库收集：**
```
复用后端配置文件中的数据源，还是手动填写？
1. 从后端配置文件检测（基于生产分支的配置）
2. 手动填写连接信息

>
```

**Step 3 — Gateway Route Rule:**

When both frontend and backend sources exist:
```
检测到前端 API base URL: /api
后端模块路径前缀：user-service → /user, order-service → /order

网关路由规则（常见模式）：
1. /api/{module}/** → {module-service}/**    (如 /api/user/list → user-service /user/list)
2. /api/** → backend/**                      (统一前缀剥离)
3. 自定义规则（请描述）

选择或描述你的网关规则：>
```

**Step 4 — Output Directory & Summary:**

```
知识库输出目录：> /path/to/ehr-knowledge-base

扫描计划：
├── 后端: /path/to/ehr-core [user-service, order-service] (branch: main)
├── 前端: /path/to/ehr-web [src/views/user/, src/views/order/, src/components/] (branch: main)
├── PRD: /path/to/docs/prd/ (2 个文档)
├── 数据库: 从后端配置检测
├── 网关规则: /api/{module}/** → {module-service}/**
└── 输出: /path/to/ehr-knowledge-base/

确认开始扫描？(y/n)
```

**Stop and wait for user reply.**

### Phase 1: Project Detection

**Multi-source mode note:** In multi-source mode, Phase 1-9 execute inside a git worktree pointing to the main branch. The worktree is created in Phase 0 and removed after all backend phases complete. Only user-selected modules are scanned.

1. Check for build files (first match determines primary):
   - `pom.xml` → Maven/Java
   - `build.gradle` / `build.gradle.kts` → Gradle/Java or Kotlin
   - `package.json` → Node.js
   - `go.mod` → Go
   - `Cargo.toml` → Rust
   - `pyproject.toml` / `requirements.txt` → Python
2. Detect primary language: `find . -type f \( -name "*.java" -o -name "*.kt" -o -name "*.ts" -o -name "*.go" -o -name "*.py" -o -name "*.rs" \) | wc -l` (weighted by extension)
3. Detect framework from dependencies (read build file):
   - Java: spring-boot-starter → Spring Boot (extract version from parent or dependency)
   - Node: express/next/nestjs from package.json
   - Python: django/fastapi/flask from requirements
4. Detect Java/JVM version:
   - Maven: `<java.version>` or `<maven.compiler.source>` in `pom.xml` properties
   - Gradle Groovy: `sourceCompatibility` in `build.gradle`
   - Gradle Kotlin: `jvmTarget` in `build.gradle.kts` kotlin options, or `java.sourceCompatibility`

### Phase 2: Module Structure

1. **Maven multi-module**: parse root `pom.xml` for `<modules>` section
2. **Gradle multi-module**: parse `settings.gradle(.kts)` for `include` statements
3. **Single module**: treat project root as sole module
4. For each module, note its `artifactId` / directory name and purpose (infer from name)
5. Detect inter-module dependencies from each module's build file

### Phase 3: Architecture & Layering

**For Java projects** (read `${CLAUDE_PLUGIN_ROOT}/references/java-spring-patterns.md` for details):
1. Find base package: `find {module}/src/main/java {module}/src/main/kotlin -maxdepth 4 -type d 2>/dev/null` — locate the deepest common ancestor with multiple sub-packages
2. Scan 2 levels below base package
3. Classify packages by name keywords:
   - controller, api → API Layer
   - application, service, biz → Service/Application Layer
   - domain → Domain Layer
   - dao, mapper, repository → Data Access Layer
   - entity, model, po → Persistence Objects
   - dto, vo, request, response → Data Transfer Objects
   - config, configuration → Configuration
   - common, util, helper → Utilities
   - interceptor, filter, aspect → Cross-cutting
4. Detect architecture style:
   - Has `domain/` + `application/` + `infrastructure/` → DDD
   - Has `controller/` + `service/` + `dao/` → MVC
   - Otherwise → Custom (describe what's found)

**For non-Java projects**:
- Scan top-level directories: routes/, controllers/, models/, services/, lib/, utils/, middleware/
- Infer layering from directory structure

### Phase 4: Dependencies & Tech Stack

Parse build file and categorize dependencies:

| Category | Examples |
|----------|----------|
| Framework | spring-boot, express, django |
| ORM | mybatis, jpa/hibernate, sequelize, sqlalchemy |
| Cache | spring-data-redis, jedis, lettuce, ioredis |
| MQ | spring-kafka, rocketmq-client, amqplib |
| Database | mysql-connector, postgresql, h2 |
| HTTP Client | feign, resttemplate, okhttp, axios |
| Serialization | jackson, gson, fastjson |
| Testing | junit, mockito, jest, pytest |
| Monitoring | micrometer, prometheus, actuator |

Extract version numbers where available. For Gradle projects, also check:
- `gradle.properties` for version variables (e.g., `springBootVersion=3.2.0`)
- `gradle/libs.versions.toml` (version catalog) for centralized version declarations
- `buildSrc/` for custom version constants

### Phase 5: API Endpoints

**Java/Spring**:
```bash
grep -rn "@\(Rest\)\?Controller\|@RequestMapping\|@GetMapping\|@PostMapping\|@PutMapping\|@DeleteMapping" {module}/src/main/java/ {module}/src/main/kotlin/ 2>/dev/null
```

For each controller:
- Extract class-level `@RequestMapping` base path
- Extract method-level mappings: HTTP method + path + method name
- Note request/response types from method signature

**Other frameworks**: scan route definitions (Express router, Django urls.py, Go gin routes)

### Phase 6: Database

Two-pass approach: first scan code artifacts, then connect to test database for live schema, infer relationships, then sample data.

**Execution order:** 6A → 6B(Step 1-4) → 6C → 6B(Step 5-6) → 6D → 6E

#### 6A: Code Artifact Scan

1. Scan for entity annotations:
   ```bash
   grep -rn "@Entity\|@Table\|@TableName" {module}/src/main/java/ {module}/src/main/kotlin/ 2>/dev/null
   ```
2. For each entity: extract table name, key fields (@Id, @Column)
3. Extract code-level relationships:
   - JPA: `@ManyToOne`, `@OneToMany`, `@ManyToMany`, `@JoinColumn`
   - MyBatis: `<association>`, `<collection>` in mapper XML
4. Check for MyBatis XML mappers: `find . -path "*/mapper/*.xml" -o -path "*/mybatis/**/*.xml"`
5. Check for migrations: `find . -path "*/db/migration/*" -o -path "*/changelog/*"`
6. **Enum/Constant scan** — find status value meanings from code:
   ```bash
   grep -rn "enum\|public static final" {module}/src/main/java/ {module}/src/main/kotlin/ 2>/dev/null | grep -i "status\|state\|type\|level\|flag"
   ```
   For each enum class: extract field name → value → comment/label mapping.
   Use these labels to annotate status values found in database (Step 4).

#### 6B: Database Direct Connection (Java projects with MySQL/PostgreSQL)

**数据库查询使用插件自带脚本（mysql2 已在初始化阶段安装）：**

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/db-query.js <host> <port> <user> <password> <database> "<SQL>"
```

**如果连接失败（网络不通、密码错误等）：**

提示用户选择：
```
数据库连接失败：{错误信息}

1. 重新输入连接信息
2. 从代码推断（解析 Entity 类、MyBatis XML、migration 文件）
3. 跳过数据库扫描
```

STOP 等待用户回复。

**Step 1 — Parse datasource config:**

Scan `application.yml` (or `application-dev.yml` / `application-test.yml`) for datasource config.

Detect database type from JDBC URL prefix:
- `jdbc:mysql://` → MySQL (default port: 3306)
- `jdbc:postgresql://` → PostgreSQL (default port: 5432)

**Custom format:**
```yaml
mysql:
  {datasource-name}:
    url: jdbc:mysql://host:port/database?params
    username: xxx
    password: xxx

postgresql:
  {datasource-name}:
    url: jdbc:postgresql://host:port/database?params
    username: xxx
    password: xxx
```

**Standard Spring format:**
```yaml
spring:
  datasource:
    url: jdbc:mysql://host:port/database
    # or: jdbc:postgresql://host:port/database
    username: xxx
    password: xxx
```

Extract: host, port, database name, username, password, **database type** from each datasource.

**重要：密码提取注意事项：**
- password 字段必须完整读取，不可截断或替换
- 密码可能是长字符串（如 `JAcp9GnzqEUxuayx4xTVHydnSoyYbIkz`），不要与 username 混淆
- 如果 password 字段引用了环境变量（如 `${DB_PASSWORD}`），提示用户手动输入密码
- 传参给 db-query.js 时，密码必须用单引号包裹防止 shell 解析特殊字符

**Step 2 — Confirm with user:**

Always confirm before connecting to any database, regardless of how many datasources are found.

确认时**必须显示密码（脱敏）**让用户核实：

**If datasource(s) found in config:**
```
检测到以下数据源：
1. {name} → {type} {database}@{host}:{port} (user: {username}, password: {前4位}***{后4位})
2. {name} → {type} {database}@{host}:{port} (user: {username}, password: {前4位}***{后4位})

请输入要扫描的编号（逗号分隔），或 all 全部扫描，或 skip 跳过数据库扫描：
```

**If no datasource found in config (e.g., config center, env variables, or unrecognized format):**
```
未在配置文件中检测到数据源连接信息。

如需扫描数据库，请提供连接信息：
- 数据库类型 (mysql/postgresql)
- Host:Port
- Database name
- Username
- Password

输入 skip 跳过数据库扫描。
```

**Stop and wait for user reply.**

**Step 3 — Schema scan (per datasource):**

**MySQL:**
```bash
mysql -h {host} -P {port} -u {user} -p'{password}' {database} -e "
  SELECT TABLE_NAME, TABLE_COMMENT, TABLE_ROWS
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = '{database}' AND TABLE_TYPE = 'BASE TABLE'
  ORDER BY TABLE_NAME;
"
```

For each table:
```bash
mysql -h {host} -P {port} -u {user} -p'{password}' {database} -e "
  SHOW FULL COLUMNS FROM {table};
"
```

Index scan:
```bash
mysql -h {host} -P {port} -u {user} -p'{password}' {database} -e "
  SHOW INDEX FROM {table};
"
```

**PostgreSQL:**
```bash
PGPASSWORD='{password}' psql -h {host} -p {port} -U {user} -d {database} -c "
  SELECT tablename AS table_name,
         obj_description((schemaname||'.'||tablename)::regclass) AS table_comment
  FROM pg_tables
  WHERE schemaname = 'public'
  ORDER BY tablename;
"
```

For each table:
```bash
PGPASSWORD='{password}' psql -h {host} -p {port} -U {user} -d {database} -c "
  SELECT column_name, data_type, character_maximum_length,
         is_nullable, column_default,
         col_description('{table}'::regclass, ordinal_position) AS comment
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = '{table}'
  ORDER BY ordinal_position;
"
```

Index scan:
```bash
PGPASSWORD='{password}' psql -h {host} -p {port} -U {user} -d {database} -c "
  SELECT indexname, indexdef
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = '{table}';
"
```

Row count estimate (PostgreSQL):
```bash
PGPASSWORD='{password}' psql -h {host} -p {port} -U {user} -d {database} -c "
  SELECT relname AS table_name, reltuples::bigint AS row_estimate
  FROM pg_class
  WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace
  ORDER BY relname;
"
```

**Step 4 — Status/Enum field detection:**

For columns whose name contains keywords (`status`, `state`, `type`, `level`, `flag`, `category`):
- MySQL: columns with type `tinyint`, `smallint`, or `varchar(≤20)`
- PostgreSQL: columns with type `smallint`, `integer`, or `character varying(≤20)`

**MySQL:**
```bash
mysql -h {host} -P {port} -u {user} -p'{password}' {database} -e "
  SELECT DISTINCT {column} FROM {table} LIMIT 50;
"
```

**PostgreSQL:**
```bash
PGPASSWORD='{password}' psql -h {host} -p {port} -U {user} -d {database} -c "
  SELECT DISTINCT {column} FROM {table} LIMIT 50;
"
```

Record distinct values as enum candidates. Cross-reference with 6A enum scan results to attach meaning labels (e.g., `1=待支付, 2=已支付`).

**↓ Execute 6C (Relationship Inference) here before continuing to Step 5 ↓**

**Step 5 — Business data sampling (based on relationships from 6C):**

Sampling follows the relationship chain, not individual tables. Data is sampled for automated testing consumption.

**5.1 — Table classification:**

| 类型 | 识别规则 | 采样策略 |
|------|----------|----------|
| 业务主表 | 有 status/state 列 | 按 status + type 分组采样 |
| 字典/配置表 | 表名含 dict/config/setting/param | 全量导出（≤200 行），超出则采样 50 行 |
| 基础数据表 | 被 3+ 张表引用（从 6C 关系推断） | 全量导出（≤100 行），超出则采样 20 行 |
| 其他表 | 不属于以上三类 | 不主动采样，仅作为引用完整性补采 |

**5.2 — Time column detection (for ORDER BY):**

优先级：
1. 列名匹配 `create_time` / `created_at` / `ctime` / `gmt_create`（类型为 datetime/timestamp）
2. 列名匹配 `update_time` / `updated_at` / `gmt_modified`
3. 回退到主键 `id DESC`（自增 ID 隐含时间顺序）

**5.3 — Sampling dimensions (业务主表):**

| 维度 | 采样数量 | SQL 模式 |
|------|----------|----------|
| status 每种值 | 3 条 | `WHERE status={val} ORDER BY {time_col} DESC LIMIT 3` |
| type/category 每种值 | 2 条 | `WHERE {type_col}={val} ORDER BY {time_col} DESC LIMIT 2` |
| 数值边界 MIN | 1 条 | `ORDER BY {numeric_col} ASC LIMIT 1` |
| 数值边界 MAX | 1 条 | `ORDER BY {numeric_col} DESC LIMIT 1` |
| 空关联 | 1 条 | 主表记录在子表中无对应数据 |

type/category 字段识别：列名含 `type`/`category`/`kind`/`level`，且类型为 tinyint/smallint/varchar(≤20)。

**采样上限：**
- 单表 fixture 记录数上限：50 条（超出时优先保留 status 维度，裁剪低频 type 值）
- 单表 scenario 组合数上限：15 组
- 在 `_coverage.md` 中标注被裁剪的组合

**5.4 — Follow relationships to get complete chain:**
```sql
-- For each sampled main record, query related tables
SELECT * FROM {child_table} WHERE {main_table}_id = {sampled_id};
```

**5.5 — Reference integrity (补采父表记录):**

采样主表记录后，提取所有 `*_id` 字段的值，检查被引用的表是否已在 fixture 集合中：
- 已有 → 跳过
- 没有 → 补采该记录（只采被引用的那条，不展开它的子表）
- 补采上限：30 条/表

**5.6 — Large field handling:**

| 字段类型 | 处理策略 |
|----------|----------|
| JSON/JSONB（≤500 字符） | 完整保留 |
| JSON/JSONB（>500 字符） | 保留第一层 key，值截断为 `"..."` |
| TEXT/LONGTEXT（≤200 字符） | 完整保留 |
| TEXT/LONGTEXT（>200 字符） | 截断 + `"[truncated, original length: {N}]"` |
| BLOB/BINARY | 跳过，标注 `"[binary, size: {N}]"` |

**5.7 — Output as business scenario:**
```
-- Scenario: order status=1 (待支付)
order: {id=123, user_id=456, status=1, ...}
  └─ order_item: [{id=1, order_id=123, sku_id=789, ...}, ...]
  └─ payment: [] (empty - not yet paid)
```

**Step 6 — Test data storage (per main table):**

Store sampled data in `docs/knowledge-base/test-data/` directory:

**Multi-source mode:** Output to `{output-dir}/test-data/` instead of `docs/knowledge-base/test-data/`. The `_coverage.md` table adds a "来源模块" column. The `_meta.json` `dataSources` entries include a `"fromModule"` field. Database dedup: if multiple backend modules connect to same database (same host:port/database), scan only once.

```
docs/knowledge-base/test-data/
├── _coverage.md          ← coverage overview (human-readable)
├── _meta.json            ← machine-readable metadata (relationships, insert order, field types)
├── fixtures/             ← pure JSON for test framework consumption
│   ├── {table_1}.json
│   ├── {table_2}.json
│   └── ...
├── scenarios/            ← reserved for test skill to fill
│   └── _README.md        ← format spec for test skill
├── {main_table_1}.md     ← human-readable: main table + relationship chain data
├── {main_table_2}.md     ← human-readable: main table + relationship chain data
└── ...
```

**_meta.json format:**
```json
{
  "dataSources": {
    "{source-name}": {"host": "...", "port": 3306, "database": "...", "type": "mysql"}
  },
  "tables": {
    "{table}": {
      "dataSource": "{source-name}",
      "primaryKey": "id",
      "autoGenerated": ["id", "create_time", "update_time"],
      "timeColumn": "create_time",
      "type": "business|dict|base"
    }
  },
  "insertOrder": {
    "{source-name}": ["{table_1}", "{table_2}", "..."]
  },
  "deferredUpdates": [
    {"table": "{table}", "field": "{field}", "references": "{other_table}.{id}"}
  ],
  "relationships": {
    "{child_table}.{fk_field}": "{parent_table}.{pk_field}"
  }
}
```

**`insertOrder` 规则：**
- 按数据源分组（不同库之间无外键依赖）
- 通过拓扑排序确定顺序（父表先于子表）
- 如果检测到循环依赖，将环中的外键字段放入 `deferredUpdates`（先插 null，后 UPDATE）

**fixtures/{table}.json format:**
```json
{
  "_meta": {
    "table": "{table_name}",
    "dataSource": "{source-name}",
    "primaryKey": "id",
    "autoGenerated": ["id", "create_time", "update_time"]
  },
  "scenarios": {
    "status_{N}_{label}": [
      {"id": 123, "field": "value", ...}
    ],
    "type_{N}_{label}": [...],
    "boundary_min_{field}": [...],
    "boundary_max_{field}": [...],
    "empty_children": [...]
  }
}
```

**scenarios/_README.md content:**
```markdown
# Test Scenarios

This directory is reserved for test-generation skills to write business test scenarios.
project-scan does NOT write to this directory.

## Format

Each scenario file: `{scenario-name}.md`
- Describe preconditions, actions, expected results
- Reference fixture data by: `fixtures/{table}.json → scenarios.{scenario_key}[{index}]`
```

**_coverage.md format:**
```markdown
# Test Data Coverage

| 主表 | 数据源 | 类型 | 已覆盖状态 | 已覆盖类型 | 未覆盖 | 裁剪 | 最后采集 |
|------|--------|------|-----------|-----------|--------|------|----------|
| {table} | {db}@{host}:{port} | business | {values} | {values} | {values} | {trimmed} | {date} |

## 字典/配置表

| 表名 | 数据源 | 行数 | 全量/采样 | 最后采集 |
|------|--------|------|----------|----------|
| {table} | {db}@{host}:{port} | {count} | 全量 | {date} |

## 基础数据表

| 表名 | 数据源 | 被引用次数 | 行数 | 全量/采样 | 最后采集 |
|------|--------|-----------|------|----------|----------|
| {table} | {db}@{host}:{port} | {ref_count} | {count} | 全量 | {date} |
```

**{main_table}.md format:**
```markdown
# {MainTable} 测试数据

- **数据源:** {database}@{host}:{port}
- **关联表:** {child_table_1}, {child_table_2}, ...
- **状态覆盖:** {status_value}={meaning}, ...
- **类型覆盖:** {type_value}={meaning}, ...

## status={value} ({meaning})

### Record #{N}
| 表 | 数据 |
|---|---|
| {main_table} | {json row} |
| {child_table} | {json rows} |
```

**Incremental update rule:**
- On `update` mode: re-run `SELECT DISTINCT status` and `SELECT DISTINCT {type_col}` on main tables
- If new status/type values found that are not in `_coverage.md` → sample new scenarios, append to existing files
- Never delete previously sampled data — only add new scenarios
- Update `_coverage.md`, `_meta.json`, and `fixtures/*.json` with new data
- Update timestamp

#### 6C: Relationship Inference (no foreign keys)

Tables do NOT have foreign key constraints. Infer relationships from two sources:

**Source 1 — Column naming convention:**

Match `*_id` columns to tables using priority order:
1. **Full prefix match**: `order_item_id` → check if table `order_item` or `order_items` exists
2. **Truncated match** (if step 1 fails): progressively remove leading segments — `order_item_id` → try `item` / `items`
3. **Self-reference**: columns named `parent_id`, `self_id`, or `{current_table_name}_id` → self-referencing relationship (points to same table)

Validate: target table must exist in the scanned schema. Discard if no matching table found.

**Source 2 — Code annotations/queries:**
- JPA: `@ManyToOne` / `@OneToMany` with `@JoinColumn`
- MyBatis: `<association>` / `<collection>` with referenced resultMap

**Cross-validation:**
- Naming + Code match → **confirmed relationship** (solid line in ER diagram)
- Naming only → **suspected relationship** (dashed line in ER diagram)
- Code only → **confirmed relationship** (solid line)

#### 6D: Cross-Reference Code ↔ Database

Compare code entities with actual database tables:
- Tables in DB but no matching entity class → flag as "unmapped table"
- Entity class but table not in DB → flag as "obsolete entity or different datasource"

#### 6E: Output

- Connection info can be written to output files as-is (test environment data, no masking needed)
- If password contains special characters, properly escape for shell when constructing mysql/psql commands
- **Generate Mermaid ER diagram** in `project-knowledge.md`:
  - Confirmed relationships → solid line (`||--o{`)
  - Suspected relationships → dashed line (use `..` notation)
  - Include table name, key columns, and relationship labels
  - **每张表必须包含**：表中文注释（`table_name["注释"]`）、所有字段的类型和注释
  - 字段格式：`{type} {field_name} {constraint} "{comment}"`
  - constraint 可选值：PK / FK / UK，无约束则省略
  - 示例：
    ```
    order_main["订单主表"] {
        bigint id PK
        varchar order_code UK "订单编号"
        varchar status "状态"
        bigint user_id FK "用户ID"
        datetime ctime "创建时间"
    }
    ```

**ER diagram grouping strategy:**
- Tables ≤ 15: generate one complete ER diagram
- Tables > 15: split into multiple diagrams by business domain
  1. Group tables by relationship chain: each main table (has `status` column) + its related tables (from 6C) = one group
  2. Tables not belonging to any chain → put in a "公共表" (common tables) group
  3. Each group generates its own ER diagram with a `### {group_name} ER 图` header
  4. Add a summary diagram showing only inter-group relationships (main tables only, no columns)

**Non-Java projects**: scan for ORM model definitions, migration files, schema files. Database direct connection not supported (different config formats vary too much).

### Phase 7: Business Flow & External Dependencies

**Java/Spring — Entry points:**
```bash
grep -rn "@Scheduled\|@EventListener\|@KafkaListener\|@RabbitListener\|@RocketMQMessageListener\|CommandLineRunner\|ApplicationRunner" {module}/src/main/java/ {module}/src/main/kotlin/ 2>/dev/null
```

For each entry point: extract class, method, trigger condition (cron expression, event type, topic name).

**External service dependencies:**
```bash
grep -rn "@FeignClient\|@DubboReference\|@DubboService\|RestTemplate\|WebClient\|OkHttpClient" {module}/src/main/java/ {module}/src/main/kotlin/ 2>/dev/null
```

For each external call:
- `@FeignClient`: extract service name, base URL, interface methods
- `@DubboReference`: extract interface class, version, group
- RestTemplate/WebClient: extract URL patterns from code

**Generate in `project-knowledge.md`:**
- Business flow state diagrams (Mermaid `stateDiagram-v2`) for each main table's status transitions
  - Infer transitions from service layer code: search for `setStatus()`, `updateStatus()`, or direct field assignments that change status values
  - Match enum values from 6A to label each state
  - If transitions cannot be determined from code, generate a flat state list (no arrows) and mark as "transitions unconfirmed"
- Module dependency diagram (Mermaid `flowchart`) showing inter-module and external service calls
- Sequence diagrams for key business flows (optional, if clear from code)

**Other**: scan for cron jobs, event handlers, CLI commands, queue consumers.

### Phase 8: Configuration

1. Find config files: `find . \( -name "application*.yml" -o -name "application*.properties" -o -name "bootstrap*.yml" \)`
2. Identify profiles from filenames (application-dev.yml, application-prod.yml)
3. Scan for external service connections:
   - Datasource: `spring.datasource.url`
   - Redis: `spring.redis.host`
   - MQ: `spring.kafka.bootstrap-servers`, `rocketmq.name-server`
4. Detect config center: check for `apollo` / `nacos` / `spring.cloud.config` in dependencies or config
5. For non-Java: scan .env files, config directories

### Phase 9: Supplementary Sources (optional)

If `docs/knowledge-base/sources/` directory exists, read files inside to extract business context that code cannot provide.

**Supported formats:**
- Images (PNG/JPG): use Read tool directly — describe and extract structure from diagrams
- PDF: use Read tool directly (supports PDF reading with page ranges) — extract business terms, workflows, decisions
- Word (.docx): convert first with `textutil -convert txt {file}` (macOS), then extract content

**Extract and merge into `project-knowledge.md`:**
- Business terminology / domain glossary
- State machine / workflow transitions
- Architecture decisions and rationale
- Upstream/downstream service relationships
- Any business rules not derivable from code

**Git exclusion:**
- Automatically append `docs/knowledge-base/sources/` to `.gitignore` if not already present
- Source files stay local only; extracted knowledge lives in `project-knowledge.md` (tracked by git)

### Phase 10: Frontend Detection (Multi-Source Only)

For each frontend source, create a git worktree pointing to main branch:
```bash
cd {frontend-path}
git fetch origin {main-branch} --quiet 2>/dev/null || true
git worktree add /tmp/scan-frontend-{timestamp} origin/{main-branch}
```

Read `package.json` to detect framework:
- `vue` (3.x) + `vite` → Vue 3 + Vite
- `vue` (2.x) + `@vue/cli-service` → Vue 2 CLI
- `react` + `next` → Next.js
- `react` + `vite` → React + Vite

Extract: framework version, build tool, UI component library (element-plus/antd/arco), TypeScript version.

### Phase 11: Frontend Routes & Pages

Read `${CLAUDE_PLUGIN_ROOT}/references/frontend-vue-patterns.md` or `${CLAUDE_PLUGIN_ROOT}/references/frontend-react-patterns.md` based on detected framework.

**Locate route files:**
```bash
find {frontend-path}/src -name "router*" -o -name "routes*" | grep -E "\.(ts|js)$"
```

**Route parsing rules:**
- Recursively expand children, concatenate parent+child path for full route
- Preserve dynamic params as-is (`:id`, `[id]`)
- Skip pure Layout route nodes (only have children, no actual component)
- For `() => import(...)` extract actual component path

Output to `ai/frontend-routes.md` with frontmatter:
```markdown
---
last-scan: {YYYY-MM-DD}
sources: [frontend:{selected-directories}]
main-branch: {branch}
commit: {sha}
---

| 路由 | 页面组件 | 权限 | 业务说明 |
|------|----------|------|----------|
```

### Phase 12: Frontend API Layer (Core)

This is the most important frontend phase.

**Step 1 — Locate API files:**
```bash
find {frontend-path}/src -path "*/api/*" -o -path "*/services/*" -o -path "*/request/*" | grep -E "\.(ts|js)$"
```

**Step 2 — Extract axios/fetch instance config:**
```bash
grep -rn "baseURL\|VITE_API\|VUE_APP_API\|NEXT_PUBLIC_API" {frontend-path}/src/ {frontend-path}/.env*
```

**Step 3 — Extract each API function:**
For each API file, extract: exported function name, HTTP method, URL path, request param type, response type.

**Step 4 — Track call relationships:**
```bash
grep -rln "{apiFunction}" {frontend-path}/src/views/ {frontend-path}/src/pages/
```

**Step 5 — TypeScript type extraction:**
If `types/` or `interfaces/` directory exists alongside API files, extract request/response interfaces. If file has `auto-generated`/`swagger` comment → only record generation source.

Output to `ai/frontend-api-calls.md`.

### Phase 13: Frontend State Management

**Vue (Pinia/Vuex):**
```bash
find {frontend-path}/src -path "*/stores/*" -o -path "*/store/*" | grep -E "\.(ts|js)$"
```
Extract: store name → state fields → actions list.

**React (Redux Toolkit / Zustand):**
```bash
find {frontend-path}/src -path "*/store*" -o -path "*/slices/*" | grep -E "\.(ts|js)$"
```
Extract: slice name → initialState → reducers/actions.

Output to `ai/frontend-state.md` (lightweight structure overview only).

### Phase 14: Frontend Components (Lightweight)

Directory overview and component usage only:
```bash
find {frontend-path}/src/components -maxdepth 2 -name "*.vue" -o -name "*.tsx" 2>/dev/null
```

Count references per component:
```bash
grep -rln "{ComponentName}" {frontend-path}/src/views/ | wc -l
```

Output to `ai/frontend-components.md`.

### Phase 15: Frontend Build & Config

Extract key config:
- Proxy config (vite.config / vue.config) → validate gateway rule
- Path alias (@ → src/)
- Environment variables with API addresses

Output merged into `ai/frontend-routes.md` Config section header.

### Phase 16: PRD/Document Extraction (Multi-Source Only)

**文档来源：**

1. 模块 `prd/` 目录下的文件
2. 用户在 Phase 0 指定的外部文档路径（文件或目录）
3. 源码仓库中的 `docs/prd/` 目录（如存在，自动检测）

**目录扫描规则：**
```bash
find {prd-path} -type f \( -name "*.md" -o -name "*.pdf" -o -name "*.docx" -o -name "*.png" -o -name "*.jpg" \) | grep -v -E "(README|CHANGELOG|node_modules)"
```

**文件格式处理：**

| 格式 | 处理方式 |
|------|----------|
| .md | 直接 Read |
| .pdf | 直接 Read（使用 pages 参数分页读取，每次最多 20 页） |
| .docx | 先转 PDF：`textutil -convert pdf {file.docx}`，再 Read 生成的 PDF |
| .png / .jpg | 直接 Read（Claude 会识别图片内容） |

**重要：不要用 textutil -convert txt**，txt 转换会丢失所有图片内容。必须转 PDF 保留图片。

**转换步骤（.docx）：**
```bash
# 转换为 PDF（macOS 自带，保留图片和格式）
textutil -convert pdf "{prd-dir}/文件名.docx"
# 生成的 PDF 在同目录：{prd-dir}/文件名.pdf
```

转换后用 Read 工具读取 PDF，包括其中的图片（流程图、截图、表格等）。

**大文件处理：**
- PDF 超过 20 页时，分批读取：`pages: "1-20"`、`pages: "21-40"` ...
- 每批读取后提取关键信息，不需要记住全部原文

**Freshness tracking** (PRD not in git, use mtime + file size):
```bash
# 单文件
stat -f "%m %z" {prd-path}  # macOS: mtime + size
# 目录：对每个文件分别 stat，任一文件变化即视为过期
find {prd-dir} -type f \( -name "*.md" -o -name "*.pdf" -o -name "*.docx" \) -exec stat -f "%N %m %z" {} \;
```

**Extract content and distribute to:**
- Business terms → `ai/business/glossary.md`
- Business flows/state machines → `ai/business/workflows.md`
- Business rules → `ai/business/domain-rules.md`
- Page function descriptions → merge into `ai/frontend/routes.md` "业务说明" column
- Architecture decisions → `ai/backend/architecture.md` (if relevant)
- 图片中的流程图/架构图 → 用 Mermaid 重新绘制到对应文件中

### Phase 17: Cross-Reference (Multi-Source Only)

Only executed when BOTH frontend and backend sources exist.

**Step 1 — API Path Matching:**

From `ai/backend-api.md` extract backend endpoint list.
From `ai/frontend-api-calls.md` extract frontend call list.

Apply gateway route rule for path transformation:
```
Frontend call: GET /api/user/list
Gateway rule: /api/{module}/** → {module-service}/**
Transformed:  GET /user/list → match user-service UserController.list()
```

Match priority:
1. Exact match (method + transformed path identical)
2. Path param match (`/user/:id` ↔ `/user/{id}`)
3. Fuzzy match (path similarity > 80%) → mark as "待确认"

**Step 2 — Output Mapping Table:**

Output to `ai/cross-reference.md`, grouped by frontend project:
```markdown
---
last-scan: {YYYY-MM-DD}
gateway-rule: {rule}
---

## {frontend-project-name} 映射

### 已确认
| 后端端点 | Controller 方法 | 前端 API 函数 | 前端页面 |
|----------|----------------|--------------|----------|

### 待确认
| 端点/函数 | 来源 | 可能的匹配 | 原因 |
|-----------|------|-----------|------|

### 未匹配端点（所有前端项目均未调用）
| 端点 | Controller 方法 | 说明 |
|------|----------------|------|
```

**Step 3 — Data Flow Trace:**

For confirmed core API mappings, trace full chain:
```
Frontend page → Store Action → API function → [Gateway] → Controller → Service → DAO → DB table
```
Output as Mermaid sequence diagram in `project-knowledge.md`.

**Step 4 — Business Flow Diagrams:**

Generate Mermaid flowcharts for key business processes identified from cross-reference analysis:
- User operation flows (e.g., login → dashboard → CRUD operations)
- Multi-step business processes (e.g., order creation → payment → fulfillment)
- Permission/role-based access flows

Output as Mermaid `flowchart TD` diagrams in `project-knowledge.md`.

### Phase 17B: Business Knowledge Generation (业务知识提取)

基于前面所有 Phase 的扫描结果，生成面向业务人员的知识文件。输出到 `ai/business/` 目录。

#### glossary.md（业务术语表）

从以下来源提取术语：
- 数据库表名、字段名及注释（Phase 6）
- Entity 类的中文注释和 JavaDoc
- PRD 文档中的专有名词（Phase 16）
- API 接口路径中的业务词汇（Phase 5）
- 前端页面标题和菜单名称（Phase 11）

格式：
```markdown
| 术语 | 英文/代码标识 | 含义 | 所属模块 |
|------|--------------|------|----------|
| 对账单 | reconcile_bill | 供应商与采购方核对账目的单据 | pur-reconcile |
```

#### domain-rules.md（业务规则）

从代码逻辑中提取业务规则：
- Service 层的 if/else 判断逻辑和校验规则
- 枚举类中的状态定义和状态流转
- 注解中的约束（@NotNull, @Size, 自定义校验）
- 异常抛出条件（什么情况下操作会失败）

格式：
```markdown
## {业务场景}

### 规则列表
1. {规则描述，用业务语言}
   - 触发条件：...
   - 结果：...
   - 代码位置：{类名#方法名}
```

#### workflows.md（业务流程）

基于 Phase 7 的业务流程分析，用业务语言重新描述：
- 每个流程用 Mermaid flowchart 可视化
- 节点用业务术语命名（不用代码方法名）
- 标注每步的操作人角色
- 标注异常分支和回退路径

#### data-dictionary.md（数据字典）

基于 Phase 6 的数据库 schema，用业务语言描述：
```markdown
## {表中文名}（{table_name}）

{表的业务用途描述}

| 字段 | 类型 | 业务含义 | 示例值 | 备注 |
|------|------|----------|--------|------|
| bill_no | varchar(32) | 对账单编号 | RC202401001 | 自动生成，规则：RC+年月+序号 |
```

#### faq.md（常见问题）

从 PRD、代码逻辑、业务流程中推断常见问题：
- 某个操作的前置条件是什么？
- 某个状态为什么不能流转？
- 某个字段是怎么计算的？
- 某个流程的参与角色有哪些？

格式：
```markdown
## Q: {问题}

**A:** {回答，引用具体规则或流程}

相关：[规则名](domain-rules.md#xxx) | [流程名](workflows.md#xxx)
```

### Phase 18: Output Generation (Multi-Source Only)

**AI output (ai/ directory):**

Each file uses unified frontmatter:
```markdown
---
last-scan: {YYYY-MM-DD}
sources: [{type}:{module-or-directory}, ...]
main-branch: {branch-name}
commits:
  {module-1}: {sha}
  {module-2}: {sha}
---
```

**Knowledge base CLAUDE.md:**

Use template `${CLAUDE_PLUGIN_ROOT}/templates/knowledge-base-claude-md-template.md` to generate `{output-dir}/CLAUDE.md`.

**Human output (project-knowledge.md):**

Aggregate from ai/ files, including:
- Project overview (all sources summary)
- Mermaid architecture diagram (module dependencies, `flowchart`)
- Mermaid ER diagram (database relationships, `erDiagram`)
- Mermaid state machine diagram (business flows, `stateDiagram-v2`)
- Mermaid sequence diagram (core API data flow, `sequenceDiagram`)
- Mermaid flowchart (user operation flows, multi-step business processes, `flowchart TD`)
- API mapping table
- Tech stack summary

**Bridging (让 AI 发现知识库):**

After scan, perform these bridging steps to ensure AI tools can discover the knowledge base from source code directories:

1. **Source repo CLAUDE.md pointers** — For each source repo in `.scan-state.json`, append (or update) a pointer block in its CLAUDE.md. Use `<!-- MANUAL ADDITIONS START/END -->` markers to avoid conflicts with other tools:

```markdown
<!-- MANUAL ADDITIONS START -->
## External Knowledge Base
- [{module-name} 知识库]({relative-path-to-module}/CLAUDE.md)
<!-- MANUAL ADDITIONS END -->
```

The relative path must be computed from the source repo root to the module knowledge base directory. Example: if source is at `code/pur-center/` and knowledge base is at `pur-reconcile/`, the path is `../../pur-reconcile/CLAUDE.md`.

If the source repo CLAUDE.md doesn't exist, create a minimal one with just the pointer block.

2. **Root CLAUDE.md** — Create/update `{knowledge-base-root}/CLAUDE.md` as a module index containing:
   - Module table (name, description, link to module CLAUDE.md)
   - Source repo table (name, path, branch, type)
   - Brief vector search usage note

3. **Update existing pointers** — If the marker block already exists, replace its content rather than appending a duplicate.

**.scan-state.json (root-level, unified format):**

Write scan state to `{knowledge-base-root}/.scan-state.json`:
```json
{
  "version": "1.7.0",
  "lastScan": "2026-05-08",
  "mode": "multi-source",
  "repos": {
    "repo-name": { "path": "code/repo-name", "branch": "main", "type": "backend" }
  },
  "modules": {
    "module-name": {
      "lastScan": "2026-05-08",
      "sources": [
        { "type": "backend", "name": "source-name", "repo": "repo-name", "subpath": "app/module" }
      ],
      "prd": [
        { "path": "module-name/prd/", "type": "directory" },
        { "path": "code/repo-name/docs/prd/feature.md", "type": "file" }
      ],
      "commits": { "source-name": "abc123def" },
      "phases": { "phase1-detection": { "status": "completed", "date": "2026-05-08" } }
    }
  },
  "gateway": { "rule": "...", "description": "..." },
  "database": { "type": "mysql", "host": "...", "port": 3306, "database": "...", "username": "..." }
}
```

`prd` 字段说明：
- `path`：相对于知识库根目录的路径
- `type`：`"file"` 或 `"directory"`
- 目录类型会扫描其下所有支持格式的文件

Module-level `.scan-state.json` files are NOT created — all state lives at the root.

## Output Generation

After all phases complete, generate output files using templates.

**Read templates from:**
- AI output: `${CLAUDE_PLUGIN_ROOT}/templates/claude-md-template.md`
- Human output: `${CLAUDE_PLUGIN_ROOT}/templates/project-knowledge-template.md`

**Output locations:**

**Single module:**
- `CLAUDE.md` → project root (index only, ≤50 lines: project type, key commands, pointers to knowledge-base)
- `docs/knowledge-base/project-knowledge.md` → full project documentation (architecture, API, ER, tech stack)
- `docs/knowledge-base/test-data/` → test data directory (one file per main table)
- `docs/knowledge-base/sources/` → user-provided supplementary materials (local only, gitignored)

**Multi-module:**
- `CLAUDE.md` → project root (index only: module list, pointers to each module's knowledge-base)
- `docs/knowledge-base/project-knowledge.md` → global architecture doc (module dependencies, shared datasources, cross-module ER)
- `{module}/docs/knowledge-base/project-knowledge.md` → per-module detailed documentation
- `{module}/docs/knowledge-base/test-data/` → per-module test data directory

**Multi-source mode (output to dedicated knowledge base directory):**
- `{output-dir}/CLAUDE.md` → AI entry point (from template)
- `{output-dir}/project-knowledge.md` → human-readable aggregate doc
- `{output-dir}/ai/` → split AI context files:
  - `backend-api.md` — 后端 API 端点 + 请求/响应类型
  - `backend-architecture.md` — 后端分层、模块依赖、技术栈、配置
  - `database-schema.md` — 表结构、ER 关系（含表注释、字段类型、字段注释）
  - `database-enums.md` — 枚举/状态值含义
  - `frontend-routes.md` — 路由 + 页面组件 + 业务说明 + 构建配置
  - `frontend-api-calls.md` — 前端 API 调用层
  - `frontend-state.md` — 状态管理结构概览
  - `frontend-components.md` — 公共组件目录概览
  - `cross-reference.md` — 前后端 API 映射
  - `business-flows.md` — 状态机、业务流程
  - `glossary.md` — 业务术语表
- `{output-dir}/test-data/` → test data directory
- `{output-dir}/.scan-state.json` → scan state tracking

Append commit marker at end of each file:
```html
<!-- scan-commit: {current-git-HEAD-sha} | scan-date: {YYYY-MM-DD} -->
```

## Update Mode

When argument is `update`:

1. **Prerequisite check**: verify current directory is a git repository (`git rev-parse --is-inside-work-tree`). If not, abort with message: "Update mode requires a git repository. Use full scan instead."
2. Read existing output files, extract `scan-commit` SHA from bottom
3. If no marker found, fall back to full scan
4. Run: `git diff --stat {saved-sha}..HEAD`
5. Map changed files to affected phases:
   - `pom.xml` / `build.gradle` changed → re-run Phase 1, 2, 4
   - Files in `controller/` or `api/` changed → re-run Phase 5
   - Files in `entity/` or `mapper/` changed → re-run Phase 6
   - Files in `service/`, `task/`, `listener/`, `consumer/` changed → re-run Phase 7
   - `application*.yml` / `bootstrap*.yml` changed → re-run Phase 6B + Phase 8
   - New Java/Kotlin files added under base package → re-run Phase 3
6. Re-run only affected phases
7. Replace corresponding sections in output files (match by `##` headers)
8. Update commit marker

## Add-Source Mode

When argument is `add-source`:

**Step 1 — Load existing state:**

Read `.scan-state.json`, display current sources:
```
当前知识库包含以下源：
1. [后端] /path/to/ehr-core → user-service, order-service (branch: main)
2. [前端] /path/to/ehr-web → src/views/user/, src/views/order/ (branch: main)
3. [文档] /path/to/docs/prd/ (3 个文档)

操作：
1. 追加新源
2. 修改网关规则（当前: /api/{module}/** → {module-service}/**）
3. 取消

>
```

**Step 2 — Collect new source:** Enter Phase 0 Step 2 interactive flow.

**Step 3 — Execute scan for new source only:**
- New backend → Phase 1-9 (only new modules)
- New frontend → Phase 10-15 (only new frontend)
- New PRD → Phase 16

**Step 4 — Cross-Reference check:**
After scan, check if `.scan-state.json` has BOTH frontend and backend:
- Yes → re-execute Phase 17 (regardless of whether it existed before)
- No → skip

**Step 5 — Update outputs:**
- Update `.scan-state.json`
- Update `project-knowledge.md` (append new source section)
- Update knowledge base CLAUDE.md
- If Phase 17 executed → update `ai/cross-reference.md`

**Modify gateway rule:**
If user selects "修改网关规则":
1. Display current rule
2. Accept new rule
3. Update `.scan-state.json`
4. Re-execute Phase 17
5. Update `ai/cross-reference.md` and `project-knowledge.md` mapping table

## Auto-Refresh Mechanism

Triggered when AI reads the knowledge base (via CLAUDE.md External Knowledge Base pointer).

**Step 1 — Read .scan-state.json**

**Step 2 — Freshness check (all sources):**

Always check ALL sources (just a few git/stat commands, low overhead).

Backend (per-module):
```bash
cd {source-path}
git fetch origin {main-branch} --quiet 2>/dev/null || true
git log -1 --format=%H origin/{main-branch} -- {module-path}
```

Frontend (single commit):
```bash
cd {source-path}
git fetch origin {main-branch} --quiet 2>/dev/null || true
git log -1 --format=%H origin/{main-branch} -- {scannedPaths...}
```

Document (mtime + size):
```bash
# 单文件
stat -f "%m %z" {document-path}
# 目录：检查是否有比上次扫描更新的文件
find {document-dir} -type f \( -name "*.md" -o -name "*.pdf" -o -name "*.docx" \) -newer {module-ai-dir}/business/glossary.md
```

**Step 3 — Report & User Choice:**
```
知识库新鲜度检查：
✓ backend/user-service — 最新
✗ backend/order-service — 过期（3 commits behind）
✓ frontend/ehr-web — 最新
✗ document/ehr-prd.pdf — 过期（文件已修改）

是否更新过期模块？
1. 全部更新
2. 选择更新（输入编号）
3. 跳过

>
```

**Stop and wait for user reply.**

**Step 4 — Incremental Update:**

Use `git diff {saved-commit}..origin/{main-branch} -- {paths} --name-only` to determine affected phases, then re-run only those phases.

### update / check / Auto-Refresh 行为区分

| 入口 | 行为 |
|------|------|
| `update` | fetch → detect stale → auto-update all, no interaction |
| `check` | fetch → detect stale → report only, no updates |
| Auto-Refresh | fetch → detect all → list stale, user chooses which to update |

## Error Handling (Multi-Source Mode)

Best-effort + report strategy:

**Source-level failure** (path not found, not a git repo, permission denied):
- Skip that source, continue others
- List skipped sources with reason in final report

**Phase-level failure** (database unreachable, file parse error):
- Skip that phase, continue subsequent phases
- Mark in output file: `<!-- 未扫描：{reason} -->`

**Final report:**
```
扫描完成：
✓ backend/user-service — Phase 1-9 全部成功
✓ frontend/ehr-web — Phase 10-15 全部成功
✗ backend/order-service — 跳过（路径不存在）
△ database — Phase 6B 跳过（连接超时）

知识库已生成: {output-dir}/
```

No automatic retry or rollback.

### Phase 19: Vector Indexing (Optional)

**触发条件：**
- 所有扫描 Phase 完成后自动提示
- 用户执行 `/project-scan vector` 直接进入
- 用户在新鲜度检查菜单中选择"生成向量索引"

当参数为 `vector` 时，跳过所有扫描 Phase，直接执行以下步骤。前提是当前目录有 `.scan-state.json` 或知识库目录存在。如果找不到知识库，提示："未找到知识库，请先运行 /project-scan 生成知识库。"

所有扫描 Phase 完成后，提示用户是否生成向量索引：

```
知识库已生成。是否生成向量索引以启用语义检索？(y/n)
```

STOP 等待用户回复。

**用户选 y 时：**

**Step 1 — 检测 embedding 环境：**

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/embed.js detect
```

如果检测失败，显示：
```
检测 embedding 环境：
✗ Ollama — 未检测到（localhost:11434 无响应）
✗ OpenAI — 未检测到 OPENAI_API_KEY 环境变量

请选择：
1. 启动 Ollama（brew install ollama && ollama serve && ollama pull nomic-embed-text）
2. 设置 OpenAI key（export OPENAI_API_KEY=xxx）
3. 跳过向量索引生成
```

STOP 等待用户回复。

**Step 2 — 执行切片入库：**

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/vector-index.js index {知识库目录}
```

脚本会自动：
- 收集源码文件 + ai/ 文档 + business/ 文档 + prd/ 文档
- 按方法级切片（短文件整文件，长文件按方法拆，超长方法硬切 1000 tokens + 200 overlap）
- 调用 embedding（Ollama 优先，OpenAI 回退）
- 写入 `.vector-store/`（code + business 两个 collection）
- 生成 `.vector-store/meta.json`

**Step 3 — gitignore 处理：**

```bash
# 确保 .vector-store/ 被 gitignore
if ! grep -q ".vector-store/" {知识库目录}/.gitignore 2>/dev/null; then
  echo ".vector-store/" >> {知识库目录}/.gitignore
fi
```

**Step 4 — 完成提示：**

```
向量索引生成完成（{chunk_count} chunks）。

安装 vector-search 插件启用语义搜索：
  claude plugin marketplace add xinxin1112/vector-search
  claude plugin install vector-search

使用方式：
  /vector-search 退款超时逻辑
  /vector-search --type=business 对账流程
```

#### reindex 模式

当参数为 `reindex` 时：

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/vector-index.js reindex {知识库目录}
```

全量清除 `.vector-store/` 并重建。用于：
- 切换 embedding 模型后
- 向量数据损坏时
- 手动触发全量重建

#### update 模式中的向量同步

`/project-scan update` 执行完知识库更新后，如果 `.vector-store/` 存在，自动增量更新向量库：

```bash
# 获取变化文件列表
git diff {saved-commit}..HEAD --name-only > /tmp/changed-files.txt

# 增量更新向量
node ${CLAUDE_PLUGIN_ROOT}/scripts/vector-index.js index {知识库目录} --incremental --changed=/tmp/changed-files.txt
```

如果 `.vector-store/` 不存在则跳过（用户未启用向量索引）。

### Phase 20: Auto-Update Setup (Optional)

当用户执行 `/project-scan auto-update` 时，进入此流程。

**交互流程：**

```
是否启用知识库自动更新？

启用后，系统会每天在指定时间自动检查生产分支变更并增量更新知识库（含向量索引）。
你也可以选择不启用，手动执行 /project-scan update 来更新。

1. 启用自动更新
2. 不启用（保持手动更新）
```

STOP 等待用户回复。

如果用户选择 2（不启用），输出提示后结束：
```
好的，保持手动更新模式。需要更新时执行 /project-scan update 即可。
```

如果用户选择 1（启用），继续询问时间：

```
每天什么时间执行自动更新？（格式 HH:MM，如 09:00）

建议选择非工作高峰时段，如早上开工前或午休时间。
```

STOP 等待用户回复。

收到时间后，执行配置脚本：

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/setup-auto-update.js on "{知识库目录}" --time={用户输入的时间}
```

输出结果：
```
✓ 自动更新已配置
  更新时间：每天 {HH:MM}
  知识库路径：{知识库目录}
  平台：{macOS launchd / Windows Task Scheduler}

更新内容包括：
- 检查各源生产分支的最新提交
- 增量更新过期模块的知识库文件
- 更新向量索引（如已启用）

查看状态：/project-scan auto-update status
关闭更新：/project-scan auto-update off
```

**关闭自动更新（`/project-scan auto-update off`）：**

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/setup-auto-update.js off "{知识库目录}"
```

**查看状态（`/project-scan auto-update status`）：**

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/setup-auto-update.js status "{知识库目录}"
```

注意：`{知识库目录}` 从 `.scan-state.json` 的 `output` 字段获取，或使用当前目录。

### Vector Search（`/project-scan search <query>`）

语义检索代码和业务文档。当用户描述功能、业务场景或逻辑时，用自然语言找到对应代码。

**用法：**

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/vector-search.js "<query>" [--type=code|business] [--top=5] [--dir=<project-dir>]
```

| 参数 | 说明 | 默认值 |
|------|------|--------|
| query | 搜索内容（自然语言） | 必填 |
| --type | 过滤类型：code（代码）或 business（业务） | 不限 |
| --top | 返回结果数 | 5 |
| --dir | 项目目录（用于定位 .vector-store） | 当前目录 |

**示例：**

```bash
# 搜索代码实现
node ${CLAUDE_PLUGIN_ROOT}/scripts/vector-search.js "退款超时处理逻辑" --type=code

# 搜索业务规则
node ${CLAUDE_PLUGIN_ROOT}/scripts/vector-search.js "对账流程" --type=business

# 搜索所有内容
node ${CLAUDE_PLUGIN_ROOT}/scripts/vector-search.js "用户权限校验"
```

**返回格式：** JSON 数组，每条结果包含 score、file_path、line_start/line_end、class_name、method_name、module、source_type、snippet。

**向量库定位逻辑（自动）：**

1. 读当前目录 CLAUDE.md → 提取 "External Knowledge Base" 路径 → 找 `.vector-store/`
2. 检查当前目录 `.scan-state.json` → 读取 output 路径 → 找 `.vector-store/`
3. 检查当前目录下是否直接有 `.vector-store/`
4. 检查父目录
5. 都没有 → 提示用户运行 `/project-scan vector`

**何时使用：**
- 用户问"某个功能的代码在哪"
- 用户描述业务场景，需要找到对应实现
- grep 关键词搜索不到（用户用自然语言描述，不是代码标识符）

**何时不使用：**
- 已知确切文件名或类名 → 直接 Read
- 已知确切关键词 → 直接 grep

The knowledge base generated by this skill is designed to be consumed by other skills:

- **Vector search (built-in)**: `/project-scan search <query>` — 语义检索代码和业务文档
  - 支持 `--type=code|business` 过滤
  - 发现机制：从 CLAUDE.md 的 External Knowledge Base 指针定位 `.vector-store/`
- **Test generation skill**: reads `docs/knowledge-base/test-data/` (single-project) or `{output-dir}/test-data/` (multi-source) to construct automated tests:
  - `_meta.json` → FixtureLoader generation (insert order, relationships, deferred updates)
  - `fixtures/*.json` → test data fixtures (directly insertable)
  - `scenarios/` → test skill writes business test scenarios here
  - `*.md` → AI reference for understanding business context
- **java-review skill**: reads test-data for unit test construction (TODO: not yet implemented)
- **Other skills**: can read `docs/knowledge-base/project-knowledge.md` or `{output-dir}/project-knowledge.md` for project context

Data format in `fixtures/*.json` is structured for machine parsing: JSON objects grouped by scenario key, with `_meta` header for table metadata.

## Common Mistakes

- Scanning too deep into packages (limit to 2 levels below base package)
- Missing multi-module detection (always check for settings.gradle / parent pom first)
- Generating overly long CLAUDE.md (it's an index only, keep under 50 lines)
- Forgetting to handle single-module projects (no module confirmation needed)
- Running Step 5 (data sampling) before 6C (relationship inference) — must infer relationships first
- Writing database credentials into CLAUDE.md (keep them only in test-data files)
- PostgreSQL 密码含特殊字符时，PGPASSWORD 赋值需用单引号包裹并转义内部单引号
- PostgreSQL 项目可能使用非 public schema，Step 3 查询前先检查 `spring.jpa.properties.hibernate.default_schema` 或 `search_path` 配置
- Forgetting to remove git worktree after scan (`git worktree remove` must always run in finally block)
- Running Phase 17 when only one side (frontend or backend) exists
- Not deduplicating database scans when multiple modules share the same database

## Quick Reference

| What | Command |
|------|---------|
| Find build tool | `ls pom.xml build.gradle package.json go.mod Cargo.toml 2>/dev/null` |
| Count by language | `find . -type f \( -name "*.java" -o -name "*.kt" -o -name "*.ts" \) \| wc -l` |
| Find controllers | `grep -rln "@RestController" src/main/java/ src/main/kotlin/ 2>/dev/null` |
| Find entities | `grep -rln "@Entity\|@Table\|@TableName" src/main/java/ src/main/kotlin/ 2>/dev/null` |
| Find scheduled | `grep -rn "@Scheduled" src/main/java/ src/main/kotlin/ 2>/dev/null` |
| Find config files | `find . \( -name "application*.yml" -o -name "bootstrap*.yml" \)` |
| Find Vue routes | `find src -name "router*" -o -name "routes*" \| grep -E "\.(ts\|js)$"` |
| Find React routes | `grep -rln "Route\|createBrowserRouter" src/ \| head -20` |
| Find API files | `find src -path "*/api/*" -o -path "*/services/*" \| grep -E "\.(ts\|js)$"` |
| Find stores | `find src -path "*/stores/*" -o -path "*/store/*" \| grep -E "\.(ts\|js)$"` |
