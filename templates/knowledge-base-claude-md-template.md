# Knowledge Base CLAUDE.md Template

Output this file at `{output-dir}/CLAUDE.md`. It is the AI entry point for the multi-source knowledge base.

```markdown
# {knowledge-base-name}

Multi-source knowledge base covering:
{source-list-summary}

Last scan: {date}

## AI Files

| File | Content |
|------|---------|
| ai/backend-api.md | 后端 API 端点 + 请求/响应类型 |
| ai/backend-architecture.md | 后端分层、模块依赖、技术栈、配置 |
| ai/database-schema.md | 表结构、ER 关系 |
| ai/database-enums.md | 枚举/状态值含义 |
| ai/frontend-routes.md | 路由 + 页面组件 + 业务说明 + 构建配置 |
| ai/frontend-api-calls.md | 前端 API 调用层 |
| ai/frontend-state.md | 状态管理结构概览 |
| ai/frontend-components.md | 公共组件目录概览 |
| ai/cross-reference.md | 前后端 API 映射 |
| ai/business-flows.md | 状态机、业务流程 |
| ai/glossary.md | 业务术语表 |

## Test Data

Sampled business data by main table: `test-data/`

## Auto-Refresh

读取本知识库时，检查 .scan-state.json 中各源的新鲜度。
如有过期模块，提示用户选择是否更新。

<!-- scan-commit: {commit-sha} | scan-date: {YYYY-MM-DD} -->
```

## Rules

- Replace `{...}` placeholders with actual values from scan results
- `{knowledge-base-name}`: use output directory name or user-provided name
- `{source-list-summary}`: one line per source, format: `- [type] path → modules/directories (branch: xxx)`
- Remove rows from AI Files table if that file was not generated (e.g., no frontend → remove frontend rows)
- Total output MUST be ≤ 50 lines
- Do NOT put detailed content here — this is an index only
