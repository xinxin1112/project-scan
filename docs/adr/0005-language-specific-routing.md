# 0005 — 层路由是语言特定的；v2 仅交付 Java/Spring

## 背景

锁定的设计（CONTEXT.md）使用路径 glob 作为第一轮、LM 判断作为第二轮，将源文件路由到四个 KB 层——`domain`、`contracts`、`flows`、`code`。设计中内置的路径 glob 规则是 Java/Spring 风格的：`**/controller/**`、`**/entity/**`、`**/service/**`、`*.sql migration`、用于 verify 的 `@RequestMapping` 注解解析等。

README（v1）宣传支持 Vue、React、Go、Python、Rust。现实是：

- **Go**：没有 Controller/Service/Mapper。有 Handler、Repository、Struct、自由函数。
- **React/Vue**：根本没有 domain 层（数据在后端）。它有的是 route、component、store——更接近 `flows + code` 视图。
- **Python**：至少三种流行框架风格（FastAPI、Django、Flask），各有不同约定。
- **Rust**：通常没有 service 层，往往基于模块。

四个 KB 层源自 Java/Spring 后端心智模型（kb-driven 文档的示例领域）。将它们强加于前端或非 Java 后端会产生形状错误的 KB。

## 决策

**v2 仅为 Java/Spring 交付完整的四层路由。** 其他语言有各自的扫描策略：

- **React 前端**：不走四层模型（domain/contracts/flows/code），而是有自己的文档类型集：
  - `routes.md` — 路由表
  - `api-client.md` — API 函数列表（从自动生成的 TS 文件提取）
  - `api-types.md` — 接口 Req/Res 类型定义
  - `stores.md` — Zustand store 的 state + action
  - `hermes-dict.md` — 字典常量（从 hermesDict 生成文件提取，含全部 code + 中文标签）
  - `frontend-enums.md` — 前端状态聚合映射（展示态 → 后端枚举集合）
  - `field-linkage-rules.md` — 字段联动规则（隐藏/禁用/动态必填）
  - `node-button-field-matrix.md` — 节点×按钮×字段权限矩阵
  - `backend-mapping.md` — 前端函数 → 后端 flow 文档链接
  - `field-consistency-report.md` — 前端 Req vs 后端 DTO 字段比对
- **Java 网关（role: gateway）**：只生成 `api-mapping.md`（Retrofit 转发路径表 + 鉴权说明）
- **非 Java 后端（Go/Python/Rust）**：仅生成 `code/method-index.md`。v2.x 可添加每语言路由模板。
- README 的技术栈表更新以反映此情况。

对于验证 fixture（Q15：pur-reconcile，然后 pur-center），这不是问题——两个目标都是 Java/Spring。

## 后果

- React 前端获得了丰富的扫描输出（不是降级模式），但文档类型集跟后端完全不同——不强行套四层模型。
- 前后端通过 `backend-mapping.md` 和 `field-consistency-report.md` 串联，支持一体化排查。
- 该 skill 的定位变为："Java/Spring 完整四层 + React 前端专属扫描 + 跨项目串联"。
- 未来工作：Vue 前端支持（类似 React 的文档类型集）；Go/Python 的四层路由模板。
