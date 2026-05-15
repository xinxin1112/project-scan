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

**v2 仅为 Java/Spring 交付完整的四层路由。** 其他语言回退到降级模式：

- **前端（Vue/React）和非 Java 后端（Go/Python/Rust）**：扫描仅生成 `code/method-index.md`。不生成 `domain/`、`contracts/` 或 `flows/` 层。
- README 的技术栈表更新以反映此情况。v2.x 可以在设计和验证后添加每语言路由模板（`templates/routing/<lang>.md`）。

对于验证 fixture（Q15：pur-reconcile，然后 pur-center），这不是问题——两个目标都是 Java/Spring。

## 后果

- 仅有前端或 Go/Python 项目的 v1 用户得到的 v2 输出不如 v1 丰富。这是覆盖面的退步，但是正确性的提升——v1 的前端输出从未很好地基于四层模型。
- 该 skill 的定位变得更清晰："结构化 Java/Spring KB 生成器，为其他技术栈提供 code-index"。不做虚假宣传。
- 未来工作：每语言路由模板。Vue/React 可能映射到 `domain`（store）+ `flows`（route → component 树）+ `code`，这需要自己的四层解释。不在 v2 范围内。
