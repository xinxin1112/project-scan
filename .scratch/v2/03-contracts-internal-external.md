# [v2] contracts 层：内部接口 + 外部回调

**类型：** AFK
**Triage 标签：** ready-for-agent

## 要做什么

contracts 层回答「谁调谁、传什么」这个问题。本切片为 Java/Spring 模块生成 contracts 层的两类文档。

### 1. 内部接口（contracts/internal）

每个 Controller 类产出一份 `contracts/internal/<name>.md`，列出：
- 端点（path + HTTP method）
- 请求/响应结构（DTO 字段）
- 状态码（200 / 400 / 403 / 500 等的语义）

### 2. 外部回调（contracts/external）

两类源识别：
- **回调入口**：类名/注解包含 `*Callback*` / `*Webhook*` 关键字 → 第三方系统推回来的接口
- **出站客户端**：`*Client*` 命名的类 → 我方调用第三方的接口

每份外部 contract 文档列出：状态码集合、请求/响应、异常情况、重试策略（如果代码里能识别）。

### 第 5 类跳过规则

Constants、配置类（`*Constants.java`、`application.yml`）即使被 Controller 引用，也**不**产出独立 contract 文档。它们只在 method-index 里露面（#4 处理）。

### 注意范围

跨模块的 inbound contract（"模块 B 暴露给模块 A 的方法清单"）**不在本切片**。这是 #6 处理的内容。

## 验收标准

- [ ] pur-reconcile 中每个 Controller 都产出一份 `contracts/internal/` 文档
- [ ] 所有外部集成（回调、出站客户端）都产出 `contracts/external/` 文档
- [ ] 端点列表完整 — 与源码中 `@RequestMapping` 集合一致（由 #10 校验）
- [ ] frontmatter 与 #1 一致
- [ ] Constants / 配置类没有独立文档

## 决策依据

CONTEXT.md decision 2、32（第 5 类跳过规则）。

## 阻塞

- #1 探路弹（frontmatter 合约必须先锁定）
