# WebMCP 工具包 — 调研与定位（决策稿）

> 日期：2026-10-03 · 状态：待拍板
> 上游参考：`../docs/cdn-agent-widget-prior-art.md`（2026-09-23，讲的是"页面内跑 LLM 的 agent widget"，
> 与本文不是同一条线——本文是**无 LLM 的纯工具提供方**）

---

## 0. TL;DR

1. **构想里的"管道"已经全部存在，且有 MIT 现成件**：`@mcp-b/*`（polyfill + 页面内 MCP server +
   localhost relay + Chrome 扩展）已经解决了"页面里的工具 → 外部 coding agent"这两跳，5.1.0，MIT，
   2026-10-01 还在更新。**这一层不要自己造。**
2. **空白在"功能面 / 工具包"，不在传输层**：现有件里 DOM 读取有 `@mcp-b/smart-dom-reader`，通用浏览器
   自动化有 `chrome-devtools-mcp`（52.9k★，59 个工具）。但它们都不是"**给 coding agent 做 Web UI 开发
   /debug 的工具包**"。
3. **最大的差异化候选：元素 → 源码 `file:line`**（React fiber / Vue / Svelte）+ 组件 props/state +
   console/network 归因。这是唯一能让 coding agent 闭环（看到 UI → 定位到代码 → 改 → 复验）的能力，
   目前只有一堆"扩展/书签/daemon"形态的近邻在做，**没有 CDN script + WebMCP 形态的**。
4. **但**：近邻已经很挤（reticle、clickcontext、uaiselect…），且 chrome-devtools-mcp 是免费、成熟、
   Google 维护的巨兽。**"我们做通用 DOM 操作工具"这条路没有胜算**，必须要有一个它结构上做不到的点。
5. 有一组必须先定的问题（见 §6），其中最关键的是：**目标 agent 到底是谁**——浏览器原生 agent，
   还是外部 CLI coding agent？这决定了整个交付形态。

---

## 1. 标准现状（WebMCP）

来源：[CG Draft 2026-10-02](https://webmachinelearning.github.io/webmcp/) ·
[spec-status](https://docs.mcp-b.ai/explanation/design/spec-status-and-limitations.md)

- **Draft Community Group Report，不是 W3C Standard。** 会变。
- 接口面是 `document.modelContext`（**不是** `navigator.modelContext`——issue
  [#173](https://github.com/webmachinelearning/webmcp/issues/173)/[PR #184](https://github.com/webmachinelearning/webmcp/pull/184)
  因为 about:blank 跨导航泄漏而收窄到 Document）。
- 当前 IDL（要点）：
  - `registerTool(tool, { signal, exposedTo })`
  - `getTools({ fromOrigins })` / `executeTool(tool, inputObject, { signal })`
  - **没有** `unregisterTool` / `provideContext` / `clearContext`——**生命周期靠 `AbortSignal`**。
  - 事件：`ontoolchange` / `ontoolactivated` / `ontoolcancel`。
  - 注解：`readOnlyHint` / `untrustedContentHint` / `consequentialHint` / `debugging`。
- **门控**：policy-controlled feature `"tools"`，默认 allowlist `'self'`；跨域 iframe 要 `allow="tools"`；
  跨域共享走 `exposedTo` ↔ `fromOrigins`。
- **落地**：Chrome 149 Origin Trial（本地 `about:flags#enable-webmcp-testing`）、Edge 150 OT。
  Chrome 原生 consumer 是内置 agent（Gemini），**实现自定**，不保证走 MCP 框架。
- **用户确认不由规范强制**：`consequentialHint` 只是"信号"。`Permissions-Policy: tools=()` 是官方
  推荐的关停开关。

---

## 2. 现成积木（直接用，别造）

| 层 | 现成件 | 协议 | 说明 |
|---|---|---|---|
| 注册/发现 API | [`@mcp-b/webmcp-polyfill`](https://www.npmjs.com/package/@mcp-b/webmcp-polyfill) 5.1.0 | MIT | `document.modelContext` polyfill（上游 vendored，官方说未来会移除，届时切 `webmachinelearning/webmcp-polyfill`） |
| 页面内完整 MCP server | [`@mcp-b/global`](https://www.npmjs.com/package/@mcp-b/global) 5.1.0 | MIT | 有 **IIFE CDN 入口** `dist/index.iife.js`；含 transport / prompts / resources / outputSchema |
| **两跳桥（关键）** | [`@mcp-b/webmcp-local-relay`](https://www.npmjs.com/package/@mcp-b/webmcp-local-relay) 5.1.0 | MIT | 页面 embed iframe → `ws://127.0.0.1:9333` → **stdio MCP server** → Claude Code / Cursor / Desktop。`webmcp_list_sources` / `webmcp_list_tools` + 动态工具 |
| 扩展形态 | [`@mcp-b/webmcp-extension`](https://www.npmjs.com/package/@mcp-b/webmcp-extension) 5.1.0 | MIT | MV3 模板 + isolated-world client；另有 Chrome 商店的 Rook |
| TS 类型 | `@mcp-b/webmcp-types` / 官方 [`webmcp-types`](https://www.npmjs.com/package/webmcp-types) | MIT | |
| DOM 读取 | [`@mcp-b/smart-dom-reader`](https://www.npmjs.com/package/@mcp-b/smart-dom-reader) 5.1.0 | MIT | token 高效 DOM 抽取、稳定 CSS selector 排序、shadow DOM + iframe、**零依赖**、有 bundle 入口 |
| 通用浏览器工具 | [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) | Apache-2.0 | **52.9k★**，59 工具（input/nav/perf/network/debug/memory/WebMCP 2 个）。走 CDP；WebMCP 分类需 Chrome 150+ + `--enable-features=WebMCP` |
| 本仓自己的 | `poc/src/browser-env.ts`（P5） | 自有 | `dom` / `act` / `js_eval` / `logs` / `storage` 工具面，含真实踩坑注释（value 截断要显式标注等） |
| 本仓自己的 | `upstream/gui-agent`（MIT） | MIT | WebMCP registry + mirror、`read_page`/`click`/`fill`/`select_option`/`wait_for_text`、**跨快照稳定 ref**、真实 pointer 序列合成 click、React-aware 受控输入写入 |

**结论：传输、polyfill、页面↔外部 agent 的桥、DOM 序列化——四层全有现成 MIT 件。**

---

## 3. 近邻地图

### 3.1 "页面内 agent"（会自己跑 LLM，不是我们）

- [alibaba/page-agent](https://github.com/alibaba/page-agent) 29k★ MIT — CDN 一行脚本，页面内 ReAct loop，
  end-user operator 定位。
- [aralroca/gui-agent](https://github.com/aralroca/gui-agent) 16★ MIT — WebMCP 生产者**和**消费者，
  in-page LLM loop，DOM fallback 工具。**是我们代码复用价值最高的一家**。

### 3.2 "外部 coding agent + 浏览器"（我们的正面战场）

- chrome-devtools-mcp（见上）——免费、成熟、巨大。**通用场景已经被它吃掉。**
- [Playwright MCP](https://github.com/microsoft/playwright-mcp) — 自建浏览器 profile，不是开发者的真实 tab。

### 3.3 "元素 → 源码" 近邻（差异化候选，但很挤）

| 项目 | 协议 | 形态 | 说明 |
|---|---|---|---|
| [reticlehq/reticle](https://github.com/reticlehq/reticle) | **Apache-2.0 + FSL** ⚠️ | `reticle init` 装 dev SDK + 云 dashboard + 登录 | 定位"验证 AI 说 done 是真的"，返回 pass/fail/couldn't tell + `file:line`。**FSL 非 OSI 开源，勿抄码** |
| [clickcontext](https://github.com/gautham-psnl/clickcontext) | MIT | 书签小工具 + 本地 daemon + dev config patch | 点元素 → DOM/a11y/React 组件栈(props+hooks)/file:line → 本地 MCP |
| [uaiselect-mcp](https://github.com/Dearxia1/UaiSelect) | MIT | 扩展 → MCP | 浏览器 inspector → Cursor/Claude Code |
| [@domscribe/mcp](https://www.npmjs.com/package/@domscribe/mcp) | 无 license | MCP server | runtime context → 编辑器/agent |
| [claude-code-inspector](https://github.com/nemone81/claude-code-inspector) | — | 扩展 + Node 桥 | 可视化选元素 → 派 prompt 给 Claude Code |
| [web-source-inspect](https://github.com/shaojie-li/web-source-inspect) | — | 零集成扩展 | React DOM → JSX/TSX 源位置 |

**共性：全是"每个开发者装一次"（扩展/书签/daemon/dev-server patch），没有一个是 CDN `<script>` drop-in +
WebMCP 生产者。这是真实的形态空白。**

---

## 4. 空白与差异化候选

按"可持续性"排序：

1. **元素 → 源码 `file:line` + 组件 props/state，以 CDN script + WebMCP 形态交付。**
   需要 runtime（CDN script）+ build 期（bundler plugin / `data-source-location` / React `_debugSource`）两半。
   chrome-devtools-mcp 有 console 的 source-mapped stack，但**没有 element→source**；近邻有，但都不是 drop-in。
   → 对 coding agent 的闭环价值最高：*看到 UI → 定位代码 → 改 → 复验*。
2. **应用自定义工具（WebMCP 的原生能力）。**
   应用自己注册 `reset_test_data` / `go_to_checkout_step3` / `get_cart_total`。
   外部 agent 靠 DOM 猜不出来的领域知识，一旦结构化暴露，可靠性量级提升。
   **这是 chrome-devtools-mcp 结构上做不到的（它只能看到 DOM，看不到你的领域意图）。**
3. **dev 诊断面**：console + network + 未捕获错误 + storage + 性能标记，
   并且**归因到源码位置和组件**（对比：page-agent 完全没有，chrome-devtools-mcp 有但不归因到组件）。
4. **验证/断言面**：让 agent 自己验证 patch（对应近邻 reticle 的定位，但我们不做云）。
5. 一个**纯 JS、无 UI、无 LLM** 的 bundle（用户明确要的形态）。

---

## 5. 问题与风险（直接回答"有没有问题"）

**P1 — 「目标 agent 是谁」没定，这决定一切。**
WebMCP 的原生消费者是**浏览器内置 agent**（Chrome 149 OT，flag 后面）；外部 CLI coding agent
（Claude Code / DSH / Cursor）**够不到 `document.modelContext`**，必须走第二跳。
三种第二跳都已存在但摩擦不同：
- `@mcp-b/webmcp-local-relay`：要 `npx` 跑 relay + 配 MCP client（**但这是唯一"只要 script tag 就能被发现"的**）
- chrome-devtools-mcp / PaulKinlan relay：CDP，要 Chrome 150+ + flag
- Chrome 扩展：要装扩展
**"CDN 一行 script" 解决的是页面侧零摩擦，不解决外部 agent 侧的接入摩擦。** 这个 gap 必须正视。

**P2 — 通用 DOM/JS 工具面没有胜算。**
`js_eval` 一类工具本质就是 CDP `Runtime.evaluate`，chrome-devtools-mcp 免费且成熟 59 个工具。
如果我们的工具包只是"click/fill/snapshot/eval"，开发者没有理由换。
**必须有结构上 chrome-devtools-mcp 做不到的东西**（§4.1 / §4.2）。

**P3 — 安全模型是真的危险，且规范不兜底。**
`js_eval` = 在开发者已登录会话里执行任意 JS；DOM 工具能读到 token。
反过来，**页面内容是不可信输入**——工具返回里夹带的文字会进 coding agent 的上下文，
构成 prompt injection → 可能被诱导把页面数据外传。
必须：dev-only 默认、显式 opt-in、页面内**可见**的连接指示、工具结果标注
`untrustedContentHint`、以及文档化的 `Permissions-Policy: tools=()` 关停方式。
（规范明确不强制用户确认，`consequentialHint` 只是信号。）

**P4 — CSP 是落地风险。**
`script-src`（CDN）、`connect-src ws://127.0.0.1:9333`（relay）、relay 的 embed iframe（`frame-src`）
都会被严格站点挡掉。要文档化，并准备同线程/降级形态。

**P5 — 形态空白 ≠ 需求空白。**
"元素→源码→coding agent" 已经有 6 个玩家在做，说明需求真实，但也说明**窗口在收窄**，
且 reticle 拿钱在做（云 dashboard + 登录 + 安装脚本）。
我们要么找到一个它们都没占的角度，要么就会撞上它们。

**P6 — 命名与定位。**
不要叫 "webmcp-xxx"——WebMCP 是 W3C CG 标准名，用它会让人以为我们是规范的一部分。
"CDN 上的工具包"这个类比（Tailwind/Xterm/Markdown viewer）准确，但要说清楚
**它不带 UI、不带 LLM**，否则会被当成又一个 page-agent。

**P7 — 依赖上游的节奏。**
`@mcp-b/webmcp-polyfill` 官方声明是"临时兼容分发，未来会移除"；WebMCP 还是 CG Draft，
API（`exposedTo` / 事件名 / annotations）都可能变。要设计成**薄适配层**，别把标准 API 漏进业务代码。

**P8 — 与现有 dev-webmcp 之外的仓储关系。**
本工作区根目录**不是 git 仓库**（`upstream/*` 是各自 clone 的子仓）。已按你的要求做了：
根 `.gitignore` 忽略 `dev-webmcp/`，并在 `dev-webmcp/` 里 `git init` 建了独立仓。

---

## 6. 待拍板

1. **目标 agent 优先级**：(a) 外部 CLI coding agent（DSH/Claude Code/Cursor）优先，还是
   (b) 浏览器原生 agent（Chrome OT）优先，还是 (c) 两者同构、桥可插拔？
   → 我倾向 **a 优先、b 顺带**（a 今天可用，b 是未来；同一份页面侧代码两者通吃）。
2. **第二跳选哪条**：(a) `@mcp-b/webmcp-local-relay`（页面侧零摩擦，agent 侧要 `npx` 配置）
   (b) CDP / chrome-devtools-mcp（复用现成巨兽，但要 flag，且我们的工具要在它的 WebMCP 分类里被看见）
   (c) 两条都出，抽象成 transport。
3. **差异化押哪个**：(a) 元素→源码 `file:line` + 组件状态（打 reticle/clickcontext 那一圈）
   (b) 应用自定义工具的注册体验（打 WebMCP 的原生能力，竞品最少）
   (c) 单纯做"最好用的 dev 工具包"（正面硬刚 chrome-devtools-mcp，我不看好）
4. **要不要做 build 期那一半**（bundler plugin 给 source location）。
   不做的话 §4.1 基本不成立。

---

## 7. 建议的下一步（待拍板后）

- **不写产品代码之前**先做一个 **1 天 spike**：一个静态页 + `@mcp-b/global` IIFE + `registerDomTools`
  风格的工具集 + `webmcp-local-relay`，用 DSH 通过 MCP 实际调一次 `read_page` / `click`，
  把 §5 的 P1/P2/P4 三个假设实测掉（relay 能否连上、CSP 拦不拦、工具体验够不够）。
  现成资产：`poc/src/browser-env.ts`（工具实现）、`upstream/gui-agent`（DOM 工具 + 稳定 ref）、
  `poc/serve.mjs`（静态服务器）、`poc/harness/drive*.mjs`（CDP 驱测）。
- spike 结论出来再决定 §6.3 押哪个方向、以及是否真需要自研。
