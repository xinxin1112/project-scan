# [v2] flows 层：调用链 + 三路融合 + 降级链

**类型：** AFK
**Triage 标签：** ready-for-agent

## 要做什么

flows 层是 v2 重构的核心 — 让 Consumer Agent 拥有"顺一条链路看全貌"体验的关键文档类型。本切片包含三块：

### 1. 调用链构建器（深度 = 2）

静态分析产出 `Controller → Service → (Mapper / Client / 同模块 Service)` 的调用图。规则：
- Mapper 调用 → 标记为"持久化操作"，**不展开**
- 外部 Client → 标记 + 链接到 contract 文档，**不展开**
- 同模块 Service 跨调用 → **展开**到下一层
- 跨模块 Service 调用 → **标记为"跨模块边界"**，具体内容延后到 #6 处理

### 2. flow 触发条件检测器

不是所有 Controller 方法都生成 flow 文档。一个方法变成 flow 文档当且仅当：
- 调用了 ≥2 个不同的 Service / 外部 Client，**或**
- 触发了状态机转移（包含 `setStatus()` / `updateStatus()` 调用）

CRUD 方法（`getById`、`list`、`count` 等单 Service 调用、无状态变更）跳过。

### 3. 三路融合生成器 + 降级链

对每个被触发的方法，按以下顺序尝试生成：

```
PRD + 状态机 + 调用链   → 最完整（业务命名 + 状态转移 + 实现）
状态机 + 调用链         → 缺业务命名，仍可用
仅调用链                → 兜底，flow 名 = Controller 方法名
```

### 4. PRD ↔ 代码绑定机制

flow 生成器需要把 Controller 方法跟 PRD 段落配对。配对逻辑：

1. **检查 `kb/prd-mapping.yaml`**：如果有该方法的显式映射条目 → 直接用指定的 PRD 段落
2. **没有映射 → 向量召回**：用方法名 + Service 调用链拼 query → 在 PRD 向量库（source_type=prd）里召回 top-3 段落 → 喂给 LM 做融合
3. **召回结果置信度低**（top-1 score < 阈值）→ 视为"无 PRD"，降级到"状态机 + 调用链"

`prd-mapping.yaml` 格式：
```yaml
- prd_section: "对账匹配规则"
  prd_file: prd/reconcile.md#匹配规则
  driving_method: BillReconcileController.match
```

### 5. PRD 路径写进 sources

flow 文档的 frontmatter `sources` 不只列 Java 文件，**也列实际读取过的 PRD 文件路径**。这样 PRD 改了 → 增量 update 自动让该 flow 过期重生成（复用 #11 的反向索引机制，不需要单独的 PRD 跟踪逻辑）。

### 6. 代码优先原则

flow 生成器以代码（call-graph + 状态机）为骨架，PRD 只提供命名和业务背景。**不**用 PRD 内容覆盖代码事实。如果 PRD 说"< 5元"但代码守卫是 `diff < 1`，flow 文档写代码事实（1元），冲突由 #10 的 verify-report 标记。

每份 flow 文档的 `sources` 记录的是真正读取过的源文件（Controller + Service + PRD），**不包含 Mapper**。这意味着改 Mapper 不会触发 flow 重新生成（由 method-index 兜底）。

## 验收标准

- [ ] pur-reconcile 中每个满足触发条件的 Controller 方法都生成一份 `flows/` 文档
- [ ] CRUD 方法（`getById`、`list` 等）不生成 flow 文档
- [ ] 至少一份 flow 体现了三路融合（文档正文里能看到 PRD 内容）
- [ ] 至少一份 flow 走到了"仅调用链"兜底路径，且仍然可用
- [ ] `sources` 字段不包含 Mapper（验证方式：改一个 Mapper 文件，跑 update，确认 flow 文档**没**被重新生成）
- [ ] `sources` 字段**包含**实际读取的 PRD 文件路径（验证方式：改 PRD 文件，跑 update，确认 flow 文档被重新生成）
- [ ] `prd-mapping.yaml` 有映射条目时，flow 使用指定的 PRD 段落（不走向量召回）
- [ ] 用户 review `cdn-usage-reconcile.md`，确认与脑里对该流程的理解一致

## 决策依据

CONTEXT.md decision 3（三路融合 + 降级）、4（深度 = 2）、5（触发条件）、8（sources 不含 Mapper）。

## 阻塞

- #2 Domain 层（flow 引用的状态机转移来自这里）
- #3 Contracts 层（flow 步骤引用的外部 contract 文档来自这里）
- #4 method-index（flow 文档的"实现入口"链接需要 method-index 存在）
