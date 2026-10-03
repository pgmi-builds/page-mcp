# 02 · 实测记录

> 日期：2026-10-03 · 环境：Ubuntu / Google Chrome **151.0.7922.173** / Node 22.22.1
> 只记录**本仓实测出来的数**。二手结论标了出处，没测的一律标注"未验证"。

---

## 1. Chrome 的 WebMCP 可用性

探针：起一个本地静态页，在 `127.0.0.1` 上加载，检查 `isSecureContext` / `document.modelContext` / `navigator.modelContext`。

| 启动 flag | `isSecureContext` | `document.modelContext` | `navigator.modelContext` |
|---|---|---|---|
| （无） | true | `undefined` | `undefined` |
| `--enable-features=WebMCP` | true | **object** | object |
| `--enable-features=WebMCPTesting` | true | **object** | object |
| `--enable-features=WebMCP,WebMCPTesting` | true | **object** | object |
| `--enable-experimental-web-platform-features` | true | **object** | object |

**结论**：Chrome 151 stable 上原生 WebMCP 默认关闭，**加任意一个相关 flag 即可开启**。

这一点对整个交付模型很重要：**agent 自己拉起 Chrome，flag 也由它自己设**。所以"要 native 就得等用户开 flag"这个顾虑是不成立的。

> 在 error page（非 secure context）上 `isSecureContext === false`，`modelContext` 不存在 —— 印证 `[SecureContext]` 是真的约束。
> 规范 IDL 原文：`partial interface Document { [SecureContext, SameObject] readonly attribute ModelContext modelContext; };`
> 公开 HTTPS 站点满足 secure context，实测 `https://webmcp.sh/` 与本站 demo 的公开地址均正常。

### 注解在 151 上被丢弃

`getTools()` 返回的 `annotations`，native 与 polyfill 两种运行时**都是**：

```json
{"readOnlyHint": false, "untrustedContentHint": false}
```

我们在 `registerTool` 时传的 `debugging: true` **没有出现在返回值里**。官方文档说 `debugging` 从 Chrome 156 起可用，与此一致。
→ 影响：不能依赖 `debugging` 让终端用户 agent 过滤掉我们的工具（在 151 上做不到）；其他注解（`readOnlyHint` 等）正常。

---

## 2. CSP 行为

**这是本轮最有价值的实测**，因为结论和直觉相反。

测试方式：`Content-Security-Policy` 走**响应头**（不是 meta，meta 更宽松且不是真实部署形态）：
`default-src 'self'; script-src 'self'; style-src 'self'`

| 能力 | 结果 | 证据 |
|---|---|---|
| `<style>` 元素（含 shadow root 内） | ❌ **被拦** | 目标元素 computed color 仍是 `rgb(0,0,0)` |
| `el.style.color = "red"` | ❌ **被拦**（且记录违规） | CSSOM 读回 `"red"` 但样式未生效；控制台报 "Applying inline style violates…" |
| `new CSSStyleSheet()` + `adoptedStyleSheets` | ✅ **可用** | computed color = `rgb(1,2,3)` |
| `eval()`（普通外部脚本内） | ❌ **被拦** | `EvalError` |
| `new Function()` | ❌ 被拦 | `EvalError` |
| `document.modelContext` 与 `dev_snapshot` | ✅ 可用 | 快照正常返回 |
| `dev_eval` | ❌ 被拦，但**优雅失败** | `Uncaught EvalError: Evaluating a string as JavaScript violates the following CSP directive because 'unsafe-eval' is not an allowed source of script: script-src 'self'` |

**修复前后**：

| | 修复前 | 修复后 |
|---|---|---|
| 页内指示器 border-radius | `0px`（不可见） | `999px` ✅ |
| 控制台 style 违规条数 | 2+ | **0** |

→ badge 与 click highlight 全部改为 `CSSStyleSheet` + `adoptedStyleSheets`（见 `src/style.js`）；淡出用 Web Animations API（不受 CSP 管辖）。

### ⚠️ 方法学陷阱：CDP evaluate 绕过页面 CSP

第一次测 CSP 时，我从 puppeteer 的 `page.evaluate()` 里调 `eval()`，**得到了 `2`**——看起来 CSP 没拦住 eval。

这是错的。**Chrome DevTools / CDP 的 `Runtime.evaluate` 不受页面 CSP 约束**（DevTools 控制台本就不受）。控制组验证：把同样的 `eval` 放进一个普通外部脚本，在同一 CSP 下返回 `BLOCKED:EvalError`。

正确做法（本仓 `docs` 里所有 CSP 结论都基于此）：**从页面自己的代码触发**，测完把结果写进 `window`，再从 CDP 读那个值。

> 这个陷阱值得单独记：任何"用 CDP 测页面安全策略"的结论，只要被调代码是从 evaluate 里发起的，就不可信。

---

## 3. 工具输出体积（demo 页，780×437）

| 调用 | 字符数 |
|---|---|
| `dev_snapshot` | **213** |
| `dev_read {ref:e2}` | 266 |
| `dev_console` | 327 |
| `dev_click {ref:e1}`（默认带快照） | 378 |
| `dev_click {ref:e1, include_snapshot:false}` | **46** |

demo 是 WebGL 页，DOM 里只有 3 个按钮，所以快照天然很小。**真正的状态在应用工具里**（`vitrine_state` 约 500 字符的 JSON）。

→ 设计含义：`include_snapshot` 默认开是对的（多步操作保方位），但连续动作时关掉能省 ~330 字符/次。`dev_snapshot` 的 `max_nodes` 与 `root` 是主要的体积旋钮。

---

## 4. 失败信号

工具**抛出**时会发生什么（实测，Chrome 151 native）：

- `executeTool` 以 `DOMException: UnknownError: Tool was executed but the invocation failed. For example, the script function threw an error` 被 **reject**
- 页面同时收到一次未捕获错误
- **调用方拿不到任何可用的诊断信息**

→ 所以本项目的约定是：**工具永不抛出**，错误以文本返回（`safeRun`）。修复前 agent 反馈：

> `dev_click` 是**假成功**：返回 `Clicked e1`，exit 0，无报错，状态没变。

修复后的统一约定：

| 情况 | 返回 | CLI 退出码 |
|---|---|---|
| 成功 | 正常文本 | 0 |
| 可预期的失败（ref 失效、控件 disabled、文件没有 url） | `Error from <tool>: <诊断>` | 1 |
| 参数不合 schema | `Error from <tool>: invalid arguments — … Rejected without running.` | 1 |
| 工具内部 bug（`ReferenceError`/`TypeError`） | `Error from <tool>: internal failure — … This is a bug in the tool implementation, not in your arguments; retrying will not help.` | 1 |

`harness/browser.mjs call <tool> --json` 直接给 `{ok, tool, result}`，调用方不需要正则匹配文本。

---

## 5. 回归套件

`node harness/drive.mjs` —— 每个运行时跑 10 条断言，共 **20/20 通过**：

| 断言 | native | polyfill |
|---|---|---|
| `modelContext` 可用 | ✅ | ✅ |
| `getTools()` 能发现工具包 + 应用工具 | ✅ | ✅ |
| canvas 页快照可用 | ✅ | ✅ |
| 快照标记出 disabled 控件 | ✅ | ✅ |
| 点 disabled 控件给出可读解释 | ✅ | ✅ |
| 应用工具读出 WebGL 场景状态 | ✅ | ✅ |
| 应用工具在 UI 按钮 disabled 时仍能改状态 | ✅ | ✅ |
| console 捕获返回结果 | ✅ | ✅ |
| `eval` 可用，且如实报告 module scope 不可达 | ✅ | ✅ |

`debugging` 注解一项改为**记录观察**而非断言（见 §1）。

---

## 6. 构建产物

| 项 | 值 |
|---|---|
| `dist/devtools.js`（IIFE，含 polyfill） | **97.0 KB** |
| 其中 polyfill（`@mcp-b/webmcp-polyfill` ESM 构建） | ~39 KB |
| 工具数（工具包） | 15 |
| 工具数（demo 页，含 2 个应用工具） | 17 |

未做压缩优化。polyfill 官方声明是"临时兼容分发"，未来切上游 `webmachinelearning/webmcp-polyfill` 后体积应下降。

---

## 7. 未验证 / 存疑

- **Firefox / Safari**：只做了代码层面的目标设定（`chrome120/firefox120/safari17`），**没有实机测过**。
- **Chrome 156+ 的 `debugging` 注解**：按文档推断"到 156 会保留"，未验证。
- **`getTools()` 的 `fromOrigins` / `registerTool` 的 `exposedTo`**（跨域共享）：完全未测。
- **Declarative API**（`<form toolname=…>`）：读了文档，本仓未实现、未测。
- **relay / 扩展路径**（agent 不拥有浏览器的场景）：未测，也未使用。
- 单帧快照的**精确时序**：只验证"延后一帧后能看到 action 的效果"，没有测更长的异步链路（那属于 `dev_wait` 的职责）。
