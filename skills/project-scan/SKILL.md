---
name: project-scan
description: Use when scanning a project codebase to generate knowledge base, when needing to understand a legacy project quickly, when the user says "scan project", "generate docs", "project knowledge", or wants CLAUDE.md generated from code
---

# Project Scan

Scan any project codebase and generate a dual-format knowledge base: AI context (CLAUDE.md) + human-readable documentation (docs/project-knowledge.md).

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

### Auto-detect Logic (无参数时)

```
当前目录有 .scan-state.json？
├── 是 → 多源模式（提示：已有知识库，是否 update / add-source / 重新扫描）
├── 否 → 当前目录有构建文件（pom.xml/build.gradle/package.json 等）？
│         ├── 是 → 单项目扫描（现有 Phase 1-9 逻辑）
│         └── 否 → 询问项目路径（见下方 Path Prompt）
```

### Path Prompt（源收集）

当前目录无法识别为项目时，进入交互式源收集。逐步询问：

```
请提供项目源（支持 git 地址或本地路径，可多个）：

1. 后端项目地址/路径：
2. 后端主分支名称（如 main/master/develop/release_prd）：
3. 前端项目地址/路径（没有可跳过）：
4. 前端主分支名称（如 main/master/develop/release_prd）：
```

注意：主分支名称**没有默认值**，必须让用户明确填写。不同项目主分支命名差异大（main、master、prd、release_prd、develop 等），不可假设。

用户回复后，STOP 等待。

#### 输入格式识别

| 输入格式 | 处理方式 |
|----------|----------|
| `git@...` 或 `https://...*.git` | git clone 到知识库根目录下 |
| 绝对/相对路径 | 直接使用该路径 |

#### Clone 行为

- 知识库根目录名 = git 仓库名（如 `pur-center`、`srm-web`），自动从 git 地址解析
- clone 到 `{当前目录}/{知识库名}/code/{repo-name}/`
- 使用 `git clone --depth 1 --branch {主分支名} {地址}` 浅克隆指定分支
- clone 完成后，对每个源执行 Auto-detect 判断类型（后端/前端）
- 如果 clone 失败，提示用户检查地址、分支名和权限，STOP 等待

主分支名称用于：
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

放好后回复"继续"开始扫描，或直接回复"继续"跳过 PRD。
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
│   │   │   ├── frontend/
│   │   │   └── cross-reference.md
│   │   ├── test-data/
│   │   └── .scan-state.json
│   ├── {模块名-2}/                    ← 另一个模块的知识库
│   │   └── ...
│   └── .scan-state.json               ← 项目级扫描状态
```

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

请选择作为知识库基准的主分支：>
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
主分支确认：origin/main ✓

检测到以下模块：
1. user-service
2. order-service
3. common

请选择要扫描的模块（逗号分隔，或 all）：>
```

**前端项目收集：**
```
前端项目路径：> /path/to/ehr-web
主分支确认：origin/main ✓
检测到框架：Vue 3 + Vite + TypeScript

检测到以下目录结构：
1. src/views/user/    (12 files)
2. src/views/order/   (8 files)
3. src/components/    (25 files)

请选择要扫描的目录范围（逗号分隔，或 all）：>
```

**PRD/文档收集：**
```
文档路径（支持 PDF/Word/Markdown/图片）：> /path/to/ehr-prd.pdf
```

**数据库收集：**
```
复用后端配置文件中的数据源，还是手动填写？
1. 从后端配置文件检测（基于主分支的配置）
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
├── PRD: /path/to/ehr-prd.pdf
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

**Prerequisite check**: 检测 `mysql` 或 `psql` CLI 是否可用（`which mysql` / `which psql`）。

- CLI 可用 → 使用直连方式（下方 Step 1-5）
- CLI 不可用 → 提示用户选择：

```
未检测到 mysql/psql 客户端。数据库扫描有以下选项：

1. 从代码推断（解析 Entity 类、MyBatis XML、migration 文件，无需安装任何工具）
2. 跳过数据库扫描
```

STOP 等待用户回复。

如果用户选择"从代码推断"，则仅使用 Phase 6A 的结果（Entity/Model 解析），不执行直连。生成的 ER 图基于代码中的注解和关联关系推断，在知识库中标注"（基于代码推断，未直连数据库验证）"。

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

**Step 2 — Confirm with user:**

Always confirm before connecting to any database, regardless of how many datasources are found.

**If datasource(s) found in config:**
```
检测到以下数据源：
1. {name} → {type} {database}@{host}:{port} (user: {username})
2. {name} → {type} {database}@{host}:{port} (user: {username})

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

Use Read tool to read PRD files (PDF/Word/Markdown/Image).

**Freshness tracking** (PRD not in git, use mtime + file size):
```bash
stat -f "%m %z" {prd-path}  # macOS: mtime + size
```

Extract content and distribute to:
- Business terms → `ai/glossary.md`
- Business flows/state machines → `ai/business-flows.md`
- Page function descriptions → merge into `ai/frontend-routes.md` "业务说明" column
- Architecture decisions → `ai/backend-architecture.md` (if relevant)

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

After scan, append to each source project's CLAUDE.md:
```markdown
## External Knowledge Base
- [{knowledge-base-name}]({output-dir}/CLAUDE.md)
```

**.scan-state.json:**

Write scan state to `{output-dir}/.scan-state.json`:
```json
{
  "sources": [
    {
      "type": "backend",
      "path": "/path/to/ehr-core",
      "modules": ["user-service", "order-service"],
      "mainBranch": "main",
      "commits": {
        "user-service": "abc123",
        "order-service": "def456"
      }
    },
    {
      "type": "frontend",
      "path": "/path/to/ehr-web",
      "selectedDirectories": ["src/views/user/", "src/views/order/"],
      "scannedPaths": ["src/views/user/", "src/views/order/", "src/api/", "src/stores/", "src/router/"],
      "mainBranch": "main",
      "commit": "ghi789"
    },
    {
      "type": "document",
      "path": "/path/to/ehr-prd.pdf",
      "mtime": "2026-05-08T10:30:00",
      "size": 2048576
    }
  ],
  "gatewayRule": "/api/{module}/** → {module-service}/**",
  "output": "/path/to/ehr-knowledge-base",
  "lastScan": "2026-05-08"
}
```

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
  - `database-schema.md` — 表结构、ER 关系
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
3. [文档] /path/to/ehr-prd.pdf

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
stat -f "%m %z" {document-path}
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

## Cross-Skill Integration

The knowledge base generated by this skill is designed to be consumed by other skills:

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
