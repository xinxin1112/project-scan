# CLAUDE.md Template

Output this file at project root. Keep under 50 lines. It is an index only.

```markdown
# {project-name}

{language} / {framework} {version} / {build-tool}

## Quick Commands

| Action | Command |
|--------|---------|
| Build | `{build-command}` |
| Test | `{test-command}` |
| Run | `{run-command}` |

## Modules

{module-table-or-single-line}

## Knowledge Base

Detailed project documentation lives in `docs/knowledge-base/`:

- [Project Knowledge](docs/knowledge-base/project-knowledge.md) — architecture, API, ER, tech stack
- [Test Data](docs/knowledge-base/test-data/) — sampled business data by main table

## Key Conventions

- Architecture: {MVC|DDD|Custom}
- ORM: {MyBatis|JPA|...}
- Base package: `{base.package.path}`

<!-- scan-commit: {HEAD-sha} | scan-date: {YYYY-MM-DD} -->
```

## Rules

- Replace `{...}` placeholders with actual values from scan results
- Module table: for multi-module use `| Module | Purpose |` table; for single-module omit section
- Quick Commands: detect from build tool (Maven → mvn, Gradle → gradle/gradlew). Check for wrapper scripts (`mvnw`/`gradlew`) first — prefer wrapper over bare commands
- `{build-command}`: see `references/java-spring-patterns.md` Build Tool Commands table
- `{run-command}`: for Spring Boot use `spring-boot:run` / `bootRun`; for Node use `npm start`; for Go use `go run .`
- `{test-command}`: if no test command detected, omit that row
- Total output MUST be ≤ 50 lines
- Do NOT put architecture details, API lists, or ER diagrams here — those go in project-knowledge.md
