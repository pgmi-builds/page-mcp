# WebMCP 工具包 — 调研与定位（决策稿）

> 日期：2026-10-03 · 状态：待拍板
> 上游参考：`../docs/cdn-agent-widget-prior-art.md`（2026-09-23，讲的是"页面内跑 LLM 的 agent widget"，
> 与本文不是同一条线——本文是**无 LLM 的纯工具提供方**）

---

## 0. TL;DR

1. **消费模型（v2，已修正）**：前提是 **coding agent 自己拉起浏览器**（headless 或 GUI），
   访问 `127.0.0.1` 上正在开发的页面。在这个前提下，agent 通过它**本来就有的浏览器通道**
   （CDP `Runtime.evaluate`，或 chrome-devtools-mcp 的 `list_webmcp_tools`/`execute_webmcp_tool`）
   **直接就能枚举和调用**页面里注册的 WebMCP 工具。**不需要额外的桥。**
   我上一版的"两跳"判断是错的——那是把"浏览器内置 agent"当成了消费者。
2. **所以页面侧脚本的价值不是"传输"，而是抽象**：工具面抽象、DOM 抽象、console/network 数据面。
   这三条正是这个产品唯一要做的事。
3. **传输层仍然不要自己造**：`@mcp-b/webmcp-polyfill`（MIT）负责 polyfill；
   只在"agent 不拥有浏览器"的次要场景才需要 relay/扩展。
4. **不兼容旧版本**：直接只做 `document.modelContext`（`navigator.modelContext` 完全不管），
   生命周期用 `AbortSignal`，每条工具打 `debugging: true`。
5. **差异化**：元素 → 源码 `file:line` + 组件 props/state；应用自定义工具；dev 诊断归因。
   通用 click/fill/eval 没有胜算（chrome-devtools-mcp 52.9k★ 免费 57 工具）。

---

## 1. 标准现状（WebMCP）

来源：[CG Draft 2026-10-02](https://webmachinelearning.github.io/webmcp/) ·
[spec-status](https://docs.mcp-b.ai/explanation/design/spec-status-and-limitations.md)

- **Draft Community Group Report，不是 W3C Standard。** 但 Chrome 一年几十个版本，推进很快。
- 接口面是 `document.modelContext`（**不是** `navigator.modelContext`——issue
  [#173](https://github.com/webmachinelearning/webmcp/issues/173)/[PR #184](https://github.com/webmachinelearning/webmcp/pull/184)
  因为 about:blank 跨导航泄漏而收窄到 Document）。**我们只做新版，不管 navigator。**
- 当前 IDL（要点）：
  - `registerTool(tool, { signal, exposedTo })`
  - `getTools({ fromOrigins })` / `executeTool(tool, inputObject, { signal })`
  - **没有** `unregisterTool` / `provideContext` / `clearContext`——**生命周期靠 `AbortSignal`**。
  - 事件：`ontoolchange` / `ontoolactivated` / `ontoolcancel`。
  - 注解：`readOnlyHint` / `untrustedContentHint` / `consequentialHint` / **`debugging`**
    （官方文档：`debugging` 从 Chrome 156 起可用，**就是为 dev tooling 设计的**，
    让面向终端用户的 agent 能把这些工具过滤掉）。
- **SecureContext**：`http://localhost` / `http://127.0.0.1` 算 potentially trustworthy，
  本地开发 OK；**但 `http://192.168.x.x` 这种局域网 IP 不算**——这会挡掉真机调试场景，要记一笔。
- **用户确认不由规范强制**：`consequentialHint` 只是"信号"。`Permissions-Policy: tools=()` 是官方推荐关停开关。

---

## 2. 消费模型（关键，v2 修正）

```
                    coding agent (DSH / Claude Code / Cursor)
                                  │
                    ┌─────────────┴─────────────┐
                    │  它本来就有的浏览器通道      │
                    │  · CDP Runtime.evaluate    │  ← 今天就能用
                    │  · chrome-devtools-mcp     │  ← 已有 list/execute_webmcp_tool
                    │  · Playwright / Puppeteer  │
                    └─────────────┬─────────────┘
                                  │  (浏览器是 agent 自己拉起的)
                        ┌─────────▼─────────┐
                        │  headless Chrome  │
                        │  http://127.0.0.1 │
                        └─────────┬─────────┘
                                  │ 页面加载
                    <script src="CDN/devtools-tools.js">
                                  │
                        document.modelContext
                        （polyfill 或 Chrome 原生）
                        · devtools_snapshot
                        · devtools_click / fill / type
                        · devtools_console / network
                        · <应用自己注册的领域工具>
```

**为什么不需要第二跳**：CDP 的 `Runtime.evaluate` 在**页面自己的 realm** 里执行，
所以权限策略 `"tools"` 的默认 allowlist `'self'` 天然满足——
页面 JS 能调的 `getTools()` / `executeTool()`，agent 通过 evaluate 一样能调。
（规范把 `getTools`/`executeTool` 定义为给**页面内 JS agent** 用的，evaluate 正是这个身份。）
另一条路是 CDP 原生的 `WebMCP.*` domain（chrome-devtools-mcp 已封装成
`list_webmcp_tools` / `execute_webmcp_tool`，需 `--categoryExperimentalWebmcp=true`）。

**两个必须说清的细节**：

1. WebMCP **不会自己变成 MCP server**。得到的是两种形态：
   - (a) agent 用 `evaluate_script` 自己调 `getTools()`/`executeTool()` → **今天、stable Chrome、零配置**可用，
     但工具不是 agent 工具列表里的一等公民（要靠 skill/prompt 告诉它去调）；
   - (b) 一个薄 MCP server 把 CDP → WebMCP 暴露成正式 MCP 工具 → 体验最好，
     chrome-devtools-mcp 与 [PaulKinlan/webmcp-relay](https://github.com/PaulKinlan/webmcp-relay) 已经做了。
2. **不要依赖 Chrome 原生 WebMCP**：原生在 flag / origin trial 后面，且官方文档说 headless
   **不是它的主要设计目标**。→ **页面侧一律走 polyfill**，对 `document.modelContext` 编程即可，
   这样版本无关、headless 可用、非 Chrome 也能跑；原生存在时 polyfill 自动让位。

**什么时候才需要真正的"桥"**：当 agent **不拥有**那个浏览器时——即工具跑在开发者自己日常用的
Chrome 里。此时才需要 `@mcp-b/webmcp-local-relay`（页面 → `ws://127.0.0.1:9333` → stdio MCP）
或 Chrome 扩展。**这是次要场景，不是主路径。**

---

## 3. 现成积木（直接用，别造）

| 层 | 现成件 | 协议 | 说明 |
|---|---|---|---|
| 注册/发现 API | [`@mcp-b/webmcp-polyfill`](https://www.npmjs.com/package/@mcp-b/webmcp-polyfill) 5.1.0 | MIT | `document.modelContext` polyfill（官方声明是临时分发，未来切 `webmachinelearning/webmcp-polyfill`） |
| 页面内完整 MCP server | [`@mcp-b/global`](https://www.npmjs.com/package/@mcp-b/global) 5.1.0 | MIT | 有 **IIFE CDN 入口** `dist/index.iife.js` |
| 两跳桥（**次要场景**） | [`@mcp-b/webmcp-local-relay`](https://www.npmjs.com/package/@mcp-b/webmcp-local-relay) | MIT | npm `latest` 是 **5.1.0**；文档里的 `@6/dist/browser/embed.js` 是 **beta**，要 pin 版本。`ws://127.0.0.1:9333` |
| 扩展形态 | `@mcp-b/webmcp-extension` 5.1.0 | MIT | MV3 模板 + isolated-world client |
| DOM 读取 | [`@mcp-b/smart-dom-reader`](https://www.npmjs.com/package/@mcp-b/smart-dom-reader) 5.1.0 | MIT | token 高效、稳定 CSS selector 排序、**shadow DOM + iframe**、零依赖、有 bundle 入口 |
| 通用浏览器工具 | [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) | Apache-2.0 | **52.9k★，57 工具**。含 `take_snapshot`(a11y uid) / `evaluate_script` / `fill_form` / `get_console_message` / `list_network_requests` / perf / memory，以及 `list_webmcp_tools` + `execute_webmcp_tool` |
| 本仓自己的 | `poc/src/browser-env.ts`（P5） | 自有 | `dom`/`act`/`js_eval`/`logs`/`storage` 工具面，含真实踩坑注释 |
| 本仓自己的 | `upstream/gui-agent`（MIT） | MIT | WebMCP registry + mirror、`read_page`/`click`/`fill`/`select_option`/`wait_for_text`、**跨快照稳定 ref**、真实 pointer 序列合成 click、React-aware 受控输入写入 |

**结论：polyfill / DOM 序列化 / 工具抽象参考 / 桥——全部有现成 MIT/Apache 件。传输层不要自研。**

---

## 4. 可借鉴清单（对应你问的三条）

### 4.1 工具面抽象（"CDP 暴露的信息太多，要收一层"）

参考 chrome-devtools-mcp 的工具设计（它是这个领域的事实标准）：

- **元素身份用 snapshot 产出的 `uid`/ref**，而不是让 agent 写 CSS selector。
  注意两种流派：chrome-devtools-mcp / Playwright 的 uid **易失**（每次快照重建，文档明说 "always use the latest snapshot"）；
  gui-agent 的 ref **跨快照稳定**（`WeakMap` 双向映射 + `resolve(ref)`）。
  → **我们倾向稳定 ref**，多步操作不用重新推导元素（这正是 gui-agent 的 `DomSnapshotter`）。
- **动作后默认回带快照**（`includeSnapshot`），让 agent 保持方位。
- **批量填表**：chrome-devtools-mcp 的 `fill_form` 一次填多个字段，比多次 `fill` 显著省 turn。值得抄。
- **真实事件序列**：`el.click()` 只发 click，Radix 那种 pointerdown 才开的菜单根本不响应。
  gui-agent 已实现完整 `pointerdown → mousedown → pointerup → mouseup → click()` 序列。
- **React 受控输入**：必须用原型上的原生 setter 写值，否则 React 的 value setter patch 会吞掉变更。
  gui-agent `setNativeValue` 与 `browser-env.ts` 的 `fill` 都已实现。
- **输出预算要显式标注截断**（gui-agent `budgetNotice`：截断和"真的没有"必须看起来不一样，
  否则 agent 会得出"弹窗关了"的错误结论）。

### 4.2 DOM 抽象（"怎么让 agent 方便检索和互动"）

| 方案 | 机制 | 协议 |
|---|---|---|
| chrome-devtools-mcp `take_snapshot` | **a11y 树**文本快照，一元素一 uid | Apache-2.0 |
| Playwright `browser_snapshot` | a11y 快照，ref 作 `target`，可 `depth`/`boxes` | Apache-2.0 |
| gui-agent `DomSnapshotter` | 面向可访问性的紧凑文本大纲，`maxNodes` 默认 200，**稳定 ref** | MIT |
| `@mcp-b/smart-dom-reader` | 渐进式抽取（structure → region → content），**稳定 CSS selector 排序**（ID > data-testid > ARIA > class），shadow DOM + iframe | MIT |
| page-agent `FlatDomTree` | 扁平交互元素索引，纯文本 | MIT（源自 browser-use，已带署名） |
| browser-use | 交互元素检测 + DOM 序列化管道 | MIT |

→ **务实组合**：`DomSnapshotter` 的稳定 ref 语义 + `smart-dom-reader` 的 selector 排名与
shadow DOM/iframe 遍历 + 显式的预算/截断提示。三者都是 MIT，可合法复用（保留署名）。

### 4.3 console / network 数据面

- chrome-devtools-mcp：`get_console_message`（带 **source-mapped stack**）、`list_network_requests`、
  `performance_start_trace` 等。
- 本仓 `browser-env.ts` 的 `logs`：`console.log/info/warn/error` + `window.onerror` +
  `unhandledrejection`，per-frame、环形缓冲 500 条、tail 参数。
  → 这套是**页内实现**，不依赖 CDP，agent 不拥有浏览器时也能用。
- 空缺点：**network 抓取（patch fetch/XHR）页内实现**还没有，需要新写；
  以及**把 console/network 归因到组件和源码位置**（chrome-devtools-mcp 有 source-map 但没有组件归因）。

---

## 5. 近邻地图

### 5.1 "页面内 agent"（会自己跑 LLM，不是我们）

- [alibaba/page-agent](https://github.com/alibaba/page-agent) 29.3k★ MIT — CDN 一行脚本，
  页面内 ReAct loop，end-user operator 定位。它的 "BYO" 是 **BYO model，不是 BYO agent**。
- [aralroca/gui-agent](https://github.com/aralroca/gui-agent) 16★ MIT — **最接近我们 brief 的一家**：
  `registerDomTools()` 独立可导出、README 自称 "Headless core. No UI imposed."，
  工具落到 `document.modelContext`，外部 agent 可不带页内 LLM 直接驱动。
  **但它不做源码映射，工具面也偏"操作"而非"debug"。**

### 5.2 "外部 coding agent + 浏览器"（正面战场）

- chrome-devtools-mcp —— 免费、成熟、巨大。**通用场景已经被它吃掉。**
  但它默认**自己拉起一个独立 profile 的 Chrome**；要接你真实 tab 需要
  `--browser-url`（Chrome ≥136 还要求非默认 `--user-data-dir`）或 Chrome ≥144 的 `--autoConnect`
  **外加 `chrome://inspect/#remote-debugging` 开关和每次会话的授权弹窗**。
- [playwright-mcp](https://github.com/microsoft/playwright-mcp) 37.8k★ Apache-2.0 — 同样自建浏览器；
  官方自述 "Playwright MCP is not a security boundary"。

### 5.3 "元素 → 源码" 近邻（差异化候选，但很挤）

| 项目 | 协议 | 形态 | 说明 |
|---|---|---|---|
| [reticlehq/reticle](https://github.com/reticlehq/reticle) | **Apache-2.0 + FSL** ⚠️ | `reticle init` + 云 dashboard + 登录 | "验证 AI 说 done 是真的"，返回 pass/fail/couldn't tell + `file:line`。**FSL 非 OSI 开源，勿抄码** |
| [clickcontext](https://github.com/gautham-psnl/clickcontext) | MIT | 书签小工具 + daemon + dev config patch | 点元素 → DOM/a11y/React 组件栈(props+hooks)/file:line → 本地 MCP |
| [uaiselect-mcp](https://github.com/Dearxia1/UaiSelect) | MIT | 扩展 → MCP | inspector → Cursor/Claude Code |
| [@domscribe/mcp](https://www.npmjs.com/package/@domscribe/mcp) | 无 license | MCP server | runtime context → 编辑器/agent |
| [claude-code-inspector](https://github.com/nemone81/claude-code-inspector) | — | 扩展 + Node 桥 | 选元素 → 派 prompt 给 Claude Code |
| [web-source-inspect](https://github.com/shaojie-li/web-source-inspect) | — | 零集成扩展 | React DOM → JSX/TSX 源位置 |

**共性：全是"每个开发者装一次"（扩展/书签/daemon/dev-server patch），
没有一个是 CDN `<script>` drop-in + WebMCP 生产者。这是真实的形态空白。**

---

## 6. 差异化候选

按"可持续性"排序：

1. **元素 → 源码 `file:line` + 组件 props/state，以 CDN script + WebMCP 形态交付。**
   需要 runtime（CDN script）+ build 期（bundler plugin / `data-source-location` / React `_debugSource`）两半。
   chrome-devtools-mcp 有 console 的 source-mapped stack，但**没有 element→source**；近邻有，但都不是 drop-in。
   → 对 coding agent 的闭环价值最高：*看到 UI → 定位代码 → 改 → 复验*。
2. **应用自定义工具（WebMCP 的原生能力）。**
   应用自己注册 `reset_test_data` / `go_to_checkout_step3` / `get_cart_total`。
   外部 agent 靠 DOM 猜不出来的领域知识，一旦结构化暴露，可靠性量级提升。
   **chrome-devtools-mcp 结构上做不到（它只能看到 DOM，看不到你的领域意图）。**
3. **dev 诊断面**：console + network + 未捕获错误 + storage，**归因到源码位置和组件**。
4. **验证/断言面**：让 agent 自己验证 patch（对应近邻 reticle 的定位，但我们不做云）。
5. 一个**纯 JS、无 UI、无 LLM** 的 bundle。
6. **页内"agent 已连接"的可见指示**——目前**所有近邻都没有**（全是纯 pull），
   既是安全要求也是体验差异点。

**诚实的一句**：如果只做 §6.3 的 dev 诊断 + §6.5 的形态，WebMCP 相对"随便挂个
`window.__devtools` 让 agent evaluate"的增量主要是：① 工具**可被发现**（带 schema/描述，
不用 agent 事先知道）；② **安全注解**（`readOnlyHint`/`untrustedContentHint`/`consequentialHint`/`debugging`）
让 agent 能区别对待；③ 当消费者换成浏览器内置 agent / 扩展 / 别的页内 agent 时，同一份注册直接复用。
不算压倒性，但**成本极低**，且是唯一有"标准"背书的路，值得。

---

## 7. 问题与风险

**P1 — ~~两跳~~〔已修正〕见 §2。** 主路径不需要桥；桥只在"agent 不拥有浏览器"时需要。

**P2 — 通用 DOM/JS 工具面没有胜算。**
`js_eval` 本质就是 CDP `Runtime.evaluate`，chrome-devtools-mcp 免费且成熟 57 工具。
如果工具包只是 snapshot/click/fill/eval，开发者没有理由换。**必须有它结构上做不到的东西**（§6.1/6.2）。

**P3 — 安全模型是真的危险，且规范不兜底。**
`js_eval` = 在开发者已登录会话里执行任意 JS；DOM 工具能读到 token。
反向上，**页面内容是不可信输入**——工具返回里夹带的文字会进 coding agent 的上下文，
构成 prompt injection。Chrome 官方立场是"模型内部无法保证安全"，只能靠**标注**。
必须：dev-only 默认、显式 opt-in、页内**可见**的连接指示、
工具结果标 `untrustedContentHint`、危险动作标 `consequentialHint`、
全部工具标 **`debugging: true`**（这样终端用户 agent 会把它们过滤掉）、
并文档化 `Permissions-Policy: tools=()` 关停方式。
另外 relay 的 `--widget-origin` 默认 `*`，文档自己警告这**不是本地进程认证**——relay 必须只绑 loopback。

**P4 — CSP 与 secure context。**
- `script-src`（CDN script）、`connect-src ws://127.0.0.1:9333`（仅 relay 场景）、
  relay 的 embed iframe（`frame-src`）都会被严格站点挡掉。
- 好消息：`ws://localhost` **不算** mixed content（localhost 是 potentially trustworthy），
  但 **CSP `connect-src` 照样管 WebSocket**，且回落到 `default-src`。
- **secure context 是硬门槛**：`localhost`/`127.0.0.1` OK，`http://192.168.x.x` 不行 → 真机调试会挂。
- 要文档化，并准备同线程/降级形态。

**P5 — 形态空白 ≠ 需求空白。**
"元素→源码→coding agent" 已经有 6 个玩家，说明需求真实，但**窗口在收窄**，
且 reticle 拿钱在做（云 + 登录 + 安装脚本）。要么找到一个它们都没占的角度，要么就会撞上。
⚠️ **reticle 是 Apache-2.0 + FSL，FSL 非 OSI 开源**，和 stagewise 的 AGPL 是同一类陷阱——可读，不可抄。

**P6 — 命名与定位。**
不要叫 "webmcp-xxx"——WebMCP 是 W3C CG 标准名，用它会让人以为我们是规范的一部分。
"CDN 上的工具包"这个类比（Tailwind/Xterm/Markdown viewer）准确，但要说清楚
**它不带 UI、不带 LLM**，否则会被当成又一个 page-agent。

**P7 — 依赖上游的节奏。**
`@mcp-b/webmcp-polyfill` 官方声明是"临时兼容分发，未来会移除"，到时切官方 polyfill；
WebMCP 还是 CG Draft，API（`exposedTo` / 事件名 / annotations）都可能变。
→ 设计成**薄适配层**，标准 API 只出现在一个文件里。
另外 relay 的 `@6` 只有 beta，`latest` 还是 5.1.0——**要 pin 版本，别用 `@latest`**。

**P8 — 仓储关系。**
本工作区根目录**不是 git 仓库**（`upstream/*` 是各自 clone 的子仓）。已按要求：
根 `.gitignore` 忽略 `dev-webmcp/`，并在 `dev-webmcp/` 内 `git init` 建了独立仓。

---

## 8. 待拍板

1. **主场景锚定**：确认以"agent 自己拉起浏览器访问 localhost"为**唯一主路径**，
   relay/扩展降为后续可选项？→ 我建议是。
2. **差异化押哪个**：(a) 元素→源码 `file:line` + 组件状态（打 reticle/clickcontext 那一圈）
   (b) 应用自定义工具的注册体验（竞品最少，最能吃 WebMCP 原生能力）
   (c) 单纯"最好用的 dev 工具包"（正面硬刚 chrome-devtools-mcp，不看好）
3. **要不要做 build 期那一半**（bundler plugin 给 source location）？不做的话 §6.1 基本不成立。
4. **工具名录第一版**：我倾向 `snapshot` / `click` / `fill` / `type` / `press` / `select` / `scroll` /
   `wait_for` / `console` / `network` / `eval` / `storage` / `highlight`，加"应用注册自定义工具"的入口。

---

## 9. 建议的下一步

**1 天 spike，把主路径端到端跑通**：

1. 静态页（复用 `poc/serve.mjs`）+ `@mcp-b/webmcp-polyfill` IIFE + 一套最小工具
   （`snapshot` / `click` / `fill` / `console`；实现直接从 `poc/src/browser-env.ts` 和
   `upstream/gui-agent/src/dom/*` 搬，都是 MIT/自有）。
2. 用 **DSH 自己**通过 CDP（复用 `poc/harness/drive.mjs` 的 puppeteer-core 路子）
   `Runtime.evaluate` → `document.modelContext.getTools()` → `executeTool()`，
   **证明"不需要桥"**，并顺便量一下工具输出 token 数。
3. 顺带验证：headless 下 polyfill 能不能装、`127.0.0.1` secure context 是否满足、
   工具描述对 agent 是否够用（P2 的真实检验）。
4. 再拿 chrome-devtools-mcp 的 `list_webmcp_tools`/`execute_webmcp_tool` 试一次同一条路径
   （需 `--categoryExperimentalWebmcp=true`），看是否"一等公民"体验确实更好。

spike 结论出来再定 §8.2 / §8.3。
