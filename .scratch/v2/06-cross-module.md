# [v2] 跨模块：inbound contracts + 循环依赖警告

**类型：** AFK
**Triage 标签：** ready-for-agent

## 要做什么

pur-reconcile 调用 `pur-order.OrderService` 上的方法时，这条调用不能在 flow 文档里成为悬空的引用。本切片用 **inbound contract 模式**把模块连起来。

### 1. 跨模块调用识别

扩展 #5 的调用图：识别目标类位于其他模块的调用点，打标。

### 2. inbound contract 生成器

每个被调用模块产出**一份** `kb/<callee>/contracts/internal/inbound.md`（每个被调方一份文件，**不**按调用方拆多份；文件内部按调用方分 section）。

每个 section 内容：
- 暴露给这个调用方的方法清单
- 调用点（调用方的源文件 + 对应 flow 文档链接）
- 方法签名（来自被调方）

`sources` 字段同时记录两边（调用方的 Service 文件 + 被调方暴露的方法文件）。任一边变化都会让该文档过期。

### 3. flow 落到主驱动模块

跨模块的业务流程，flow 文档放在**入口 Controller 所在的模块**。flow 正文里跨模块那一步用链接指向 inbound.md 的对应 section，**不**直接链到被调方的代码。

特殊情况：事件驱动 / MQ 触发的流程，没有单一驱动方 → flow 落到 `<repo>/kb/cross-module-flows/`。

### 4. 循环依赖检测

跨模块调用图做循环检测。检测到循环**不阻断、不自动修**，在 INDEX.md 里登记一条警告：

```
Architectural smell: cyclic dependency between A and B
```

是架构问题，不是 KB 正确性问题。

## 验收标准

- [ ] pur-reconcile 调用 pur-order 时，`kb/pur-order/contracts/internal/inbound.md` 出现，包含 "Methods exposed to pur-reconcile" section
- [ ] pur-reconcile 中相关 flow 链接到 inbound 的对应 section（不是直接链到 pur-order 的代码）
- [ ] 改调用方源码或被调方签名 → 下次 update 时 inbound.md 过期重生成
- [ ] 如果 fixture 中存在循环依赖，INDEX.md 中以警告形式登记（不报错）
- [ ] 事件驱动的 flow（如果有）落到 `kb/cross-module-flows/`

## 决策依据

CONTEXT.md decision 16、17、18、19、29（inbound 单文件按调用方分 section）。

## 阻塞

- #5 flows 层（调用图和 flow 生成器是前置）
