# WebMCP / MCP ecosystem survey — reusable tool packs and prior art

**Research date:** 2026-10-03 (UTC).
**Method:** primary sources only — the live spec source (`index.bs`), the npm registry, package tarballs
(downloaded and grepped), `raw.githubusercontent.com` READMEs/LICENSEs, and `developer.chrome.com`'s
`.md.txt` endpoints. Third-party claims are marked UNCONFIRMED.
**Siblings:** [`playwright-mcp-and-devtools-mcp.md`](playwright-mcp-and-devtools-mcp.md) and
[`browser-use-tools.md`](browser-use-tools.md) hold exact tool inventories for those servers; this file
covers the **WebMCP layer** and the surrounding ecosystem and does not re-inventory them.

**Bottom line:** nobody has shipped our exact thing (a CDN `<script>` registering *DOM-interaction +
devtools* tools on WebMCP for an *external* coding agent over CDP). The form factor is taken by
**Latch**; the "devtools tools as WebMCP" idea is taken by **TanStack**. Two polyfills exist that we
should not re-write — but the popular one silently drops the annotation our safety story depends on.

---

## 1. The standard

**Spec:** <https://webmachinelearning.github.io/webmcp/> (CG-DRAFT) · source
`https://raw.githubusercontent.com/webmachinelearning/webmcp/main/index.bs`.
Draft Community Group Report, not W3C Standard. Repo pushed 2026-10-02; `index.bs` last touched
2026-09-30 (`d61d0e6d`). It **changed recently and a lot** — see §1.3.

### 1.1 API surface — exact IDL (verbatim from `index.bs`)

```webidl
partial interface Document {
  [SecureContext, SameObject] readonly attribute ModelContext modelContext;
};
[Exposed=Window, SecureContext]
interface ModelContext : EventTarget {
  Promise<undefined> registerTool(ModelContextTool tool, optional ModelContextRegisterToolOptions options = {});
  Promise<sequence<RegisteredTool>> getTools(optional ModelContextGetToolOptions options = {});
  Promise<DOMString> executeTool(RegisteredTool tool, optional object inputObject, optional ModelContextExecuteToolOptions options = {});
  attribute EventHandler ontoolchange;
  attribute EventHandler ontoolactivated;
  attribute EventHandler ontoolcancel;
};
dictionary ModelContextTool { required DOMString name; USVString title; required DOMString description; object inputSchema; required ToolExecuteCallback execute; ToolAnnotations annotations; };
dictionary ToolAnnotations { boolean readOnlyHint = false; boolean untrustedContentHint = false; boolean consequentialHint = false; boolean debugging = false; };
dictionary ModelContextRegisterToolOptions { sequence<USVString> exposedTo; AbortSignal signal; };
dictionary ModelContextGetToolOptions       { sequence<USVString> fromOrigins; };
dictionary ModelContextExecuteToolOptions   { AbortSignal signal; };
dictionary RegisteredTool { required DOMString name; DOMString title; required DOMString description; object inputSchema; required Window window; required USVString origin; ToolAnnotations annotations; };
callback ToolExecuteCallback = Promise<any> (object inputObject, ToolExecuteCallbackOptions options);
```

- **`document.modelContext`, not `navigator.modelContext`** — relocation via
  [issue #173](https://github.com/webmachinelearning/webmcp/issues/173) /
  [PR #184](https://github.com/webmachinelearning/webmcp/pull/184); `grep navigator.modelContext index.bs` → **0 hits**.
- Method names confirmed: **`registerTool` / `getTools` / `executeTool`**. **No `unregisterTool`** —
  lifetime is the `AbortSignal`; `provideContext` / `clearContext` are gone.
- `toolactivated` / `toolcancel` are the spec's `ToolActivatedEvent` / `ToolCancelEvent`
  ([PR #245](https://github.com/webmachinelearning/webmcp/pull/245)), each with `readonly attribute DOMString toolName`.
- `registerTool` rejects `InvalidStateError` if the name is taken / name-or-description empty / name
  outside `1–128` chars of `[A-Za-z0-9_.-]`; rejects `NotAllowedError` if the document is not `fully
  active` or fails the `tools` policy. **`executeTool` resolves to a `DOMString`** (stringified), or
  `null` on navigation — not an object.
- Gated on the policy-controlled feature **`tools`** (default allowlist `'self'`; Chrome's off-switch is
  `Permissions-Policy: tools=()`), `SecureContext` on both — so `http://localhost` / `127.0.0.1` are fine
  but plain `http://<LAN-IP>` is not. Annotations are **hints only**: the spec doesn't require the UA to enforce confirmation.
- **`debugging`** ([PR #253](https://github.com/webmachinelearning/webmcp/pull/253)) came out of a WebML
  CG resolution: *"a way for web apps and frameworks to register tools intended specifically for
  developer tooling and inspection (e.g., Chrome DevTools AI assistance, testing frameworks) so that
  general-purpose/end-user agents can filter them out."* `debugging`, not `debuggingHint`, because it is
  a **definitive categorization flag**, not a hint — exactly our case. Chrome docs: **from Chrome 156**.

### 1.2 Declarative API (`<form toolname=...>`) — weaker than it looks

- **The spec section is a stub**: *"This section is entirely a TODO."* Schema synthesis and declarative
  execution are literally `TODO`. Reality lives in
  [`declarative-api-explainer.md`](https://github.com/webmachinelearning/webmcp/blob/main/declarative-api-explainer.md)
  and Chrome's implementation ("Chromium is implementing a loose version of this").
- Attributes today: `toolname`, `tooldescription`, `toolautosubmit` on `<form>`; `toolparamdescription`
  on controls. CSS `:tool-form-active` / `:tool-submit-active`; `SubmitEvent.agentInvoked` +
  `SubmitEvent.respondWith(promise)`. **`toolparamtitle` is obsolete.** Treating declarative forms as a
  *stable, first-class* input to our pack is therefore premature.

### 1.3 Browser version timeline — third-party, cites upstream commits

From [`webmaxru/web-ai-agent-skills` compatibility.md](https://github.com/webmaxru/web-ai-agent-skills/blob/main/skills/webmcp/references/compatibility.md)
(MIT; each row links its chromiumdash commit / WebMCP PR). **UNCONFIRMED** against release notes
directly, but consistent with the spec source I read.

| Chrome | Change |
|---|---|
| 146 | early preview behind `chrome://flags/#enable-webmcp-testing` |
| 148 | `registerTool()` takes `{signal}`; `unregisterTool()` **removed** |
| **149** | **Origin trial live** (Edge 150 OT); Chrome DevTools gains WebMCP support |
| 150 | getter moves `Navigator` → `Document`; `navigator.modelContext` deprecated |
| 151 | `registerTool()` returns `Promise<void>` |
| 153 | `execute()` gets `{signal}`; unregistration no longer cancels in-flight executions |
| 154 | `ToolAnnotations.consequentialHint` |
| 156 | `ToolAnnotations.debugging`; `ontoolactivated`/`ontoolcancel` move `window` → `document.modelContext` |

[Implementation status](https://github.com/webmachinelearning/webmcp/blob/main/implementation-status.md):
Chrome 149 OT, Edge 150 OT, Brave Leo experimental, **ChatGPT Desktop supported**, Meta Ray-Ban Display
"coming soon", Firefox/Safari standards-position issues open.

### 1.4 ⚠️ Things our implementation might be doing wrong

1. **`debugging: true` is silently dropped by `@mcp-b/webmcp-polyfill@5.1.0` (current `latest`).**
   Verified by grepping the published `dist/index.iife.js`: `debugging` → 0 hits, `consequentialHint` → 0.
   Its normalizer keeps only `title, readOnlyHint, destructiveHint, idempotentHint, openWorldHint,
   untrustedContentHint` — it maps **MCP-B's own hint names** and drops two *spec* names.
   `@mcp-b/webmcp-polyfill@6.0.0-beta.20261001010549` ("vendored upstream WebMCP polyfill") has all four.
   **Pin ≥6.0.0-beta or vendor upstream; don't ship 5.1.0.** Corroboration: `@napster-corp/edge-mcp`
   forked `@mcp-b/webmcp-polyfill` "patched to surface tool `annotations` through `getTools()`", and
   claims native surfaces also drop them there (UNCONFIRMED).
2. **5.1.0 never dispatches `toolcancel`** (0 hits), and its `toolactivated` is a plain
   `new Event('toolactivated')` with an ad-hoc `toolName` property — **not** the spec's
   `ToolActivatedEvent`. Feature-detect the event *name*, not the interface.
3. **Duplicate names are fatal.** A script injected twice (two tags, SPA remount, HMR) gets its second
   `registerTool` rejected. Guard with a `window.__devWebmcpInstalled` sentinel **and** one
   `AbortController` for the whole pack.
4. **Names must match `^[A-Za-z0-9_.-]{1,128}$`.** `dev_snapshot` ✅ `dev.snapshot` ✅ `dev:snapshot` ❌
   `Dev Snapshot` ❌. Prefix collisions with app tools (`click`, `eval`) are real — namespace them.
5. **`executeTool` returns a string.** The mcp-b tutorial and `@napster-corp/edge-mcp` both note you must
   `JSON.parse` it. Pick one result envelope (MCP-shaped `{content:[{type:'text',text}]}`, which the
   polyfill normalizes) and document it.
6. **`getTools()` cross-origin tools need `fromOrigins`**, and the spec says getTools is "designed for
   *in-page* agents written in JavaScript" — the browser's own agent uses a separate internal mechanism.
   Registering does **not** guarantee first-class status in a browser agent's tool list.
7. **Headless is fine for us, not for the native path.** Compatibility notes: "there is no headless
   tool-calling mode", "no worker or server execution" for the built-in agent. Our premise (polyfill +
   agent reaching the page over CDP) is unaffected; don't promise native-agent support in headless.
8. **Two things to verify on real Chrome + the pinned polyfill:** Google's own docs disagree on the flag
   (`--categoryExperimentalWebmcp` vs `--categoryWebMCP`), and **`getTools().inputSchema` type is
   contested** — the spec says `object`, `@napster-corp/edge-mcp` claims native Chromium returns a JSON
   **string** and "the polyfill matches it" (**UNCONFIRMED**). Code defensively
   (`typeof s === 'string' ? JSON.parse(s) : s`).

---

## 2. Existing WebMCP packs, polyfills and libraries

### 2.1 Polyfills / runtimes (the layer we should not write)

| Package | Ver | License | Delivery | Notes |
|---|---|---|---|---|
| [`@mcp-b/webmcp-polyfill`](https://www.npmjs.com/package/@mcp-b/webmcp-polyfill) | 5.1.0 | MIT | **IIFE** `dist/index.iife.js` (24 KB), auto-installs | Strict `document.modelContext` core (+ deprecated `navigator` alias): registration, `getTools`, optional `executeTool`, `toolchange`, and the **declarative** API incl. open shadow roots. **Drops `debugging`/`consequentialHint`** (§1.4.1). |
| same, `6.0.0-beta.20261001010549` | beta | MIT | IIFE | "Vendored upstream WebMCP polyfill plus temporary declarative tools"; all four annotations present. |
| [`webmachinelearning/webmcp-polyfill`](https://github.com/webmachinelearning/webmcp-polyfill) | 0.1.0 | **MIT** | `dist/polyfill.js` IIFE — **repo only; npm publish UNCONFIRMED** | **The CG's own polyfill.** No runtime deps, types from `webmcp-types`, CI runs upstream **WPT** `webmcp/declarative`. Created 2026-08-27, pushed 2026-10-03. Preserves existing native contexts incl. partial ones. |
| [ChromeLabs `demos/shared/webmcp-polyfill.js`](https://github.com/GoogleChromeLabs/webmcp-tools/blob/main/demos/shared/webmcp-polyfill.js) | — | **Apache-2.0** | one 22 KB file, `<script>`-ready | "Not an officially supported Google product." Declarative + imperative. Demo-grade; `getTools`/`executeTool` coverage UNVERIFIED. |
| [`@napster-corp/edge-mcp`](https://www.npmjs.com/package/@napster-corp/edge-mcp) | 0.3.0 | MIT | package + script | Fork of the mcp-b polyfill that *surfaces annotations through `getTools()`*; adds resources + console debugging. Commercial product, MIT code. |
| [`webmcp-core`](https://www.npmjs.com/package/webmcp-core) | 1.0.0 | MIT | IIFE | Third-party "drop-in `navigator.modelContext` polyfill" — **pre-150 API. Don't use.** |

### 2.2 Registration / authoring helpers

| Package | Ver | License | Form | Notes |
|---|---|---|---|---|
| [`@mcp-b/global`](https://www.npmjs.com/package/@mcp-b/global) | 5.1.0 | MIT | **IIFE** (284 KB) | Polyfill **+** composed MCP server + browser transports (tab/iframe). The "two-hop" path — only when the agent does *not* own the browser. |
| [`webmcp-types`](https://www.npmjs.com/package/webmcp-types) (official) / `@mcp-b/webmcp-types` | 0.1.10 / 5.1.0 | MIT | types | `webmcp-types` is the official one (`fbeaufort@google.com`, repo `webmachinelearning/webmcp-types`). |
| [`@mcp-b/smart-dom-reader`](https://www.npmjs.com/package/@mcp-b/smart-dom-reader) | 5.1.0 | MIT | ESM + **`bundle-string`** (59 KB, built for injection) | Token-efficient DOM extraction; stable-CSS-selector ranking; shadow DOM + iframes. |
| [`@mcp-b/webmcp-local-relay`](https://www.npmjs.com/package/@mcp-b/webmcp-local-relay) | 5.1.0 | MIT | CLI + `dist/browser/embed.js` | Page → `ws://127.0.0.1:9333` → stdio MCP. Pin the version (`@6` is beta). |
| [`@tanstack/devtools-webmcp`](https://github.com/TanStack/devtools/tree/main/packages/devtools-webmcp) | 0.0.2 src / **0.0.0 placeholder on npm** | **MIT** | ESM/CJS, **no IIFE** | §3.1 — closest architectural prior art to our registration layer. |
| [`@mcptrail/webmcp-devtools`](https://github.com/ElBartoTn/webmcp-devtools) | 0.1.1 | MIT | ESM (+`/react`) | §3.2 — in-page panel that intercepts `registerTool`, auto-builds forms from `inputSchema`, invokes, shows results. Pairs with `@mcptrail/webmcp-highlight`. |
| [`Latch`](https://latch.tools) · [repo](https://github.com/r0bertini/latch) | — | **MIT** | **`<script src="https://latch.tools/latch.js" defer>`** ~6 KB | §3.3 — closest *product* to our form factor. |
| [`use-webmcp-tool`](https://www.npmjs.com/package/use-webmcp-tool) · [`vue-webmcp`](https://www.npmjs.com/package/vue-webmcp) · [`@web-ai-sdk/webmcp`](https://www.npmjs.com/package/@web-ai-sdk/webmcp) | 0.3.0 / 0.3.3 / 0.12.1 | Apache-2.0 ×2, MIT | React hook / Vue composable / TS lib | Lifecycle-managed register/unregister, SSR-safe, late-injection re-check; zero-dep adapter with Zod→JSON Schema. |
| [`webmcp-react`](https://www.npmjs.com/package/webmcp-react), [`simple-webmcp`](https://github.com/emingure/simple-webmcp), [`@ashraf009/webmcp-kit`](https://www.npmjs.com/package/@ashraf009/webmcp-kit), [`@webmcp-registry/kit`](https://github.com/WebMCP-Registry/kit) | 1.2.1 / 0.3.0 / 0.1.0 / 0.1.2 | MIT | libs | `defineTool`, `useScopedTools`, `withConfirmation` + activity log; Zod tools + CI registry sync. |
| [`webmcp-profiler`](https://www.npmjs.com/package/webmcp-profiler) 0.2.4 · [`autotel-webmcp`](https://www.npmjs.com/package/autotel-webmcp) 5.0.0 · [`webmcp-evals`](https://www.npmjs.com/package/webmcp-evals) 0.0.4 · [`nuxt-mcp-b`](https://github.com/Suv4o/nuxt-mcp-b) 1.0.0 · [`@olumide100/webmcpify`](https://www.npmjs.com/package/@olumide100/webmcpify) 1.0.3 | — | MIT / Apache-2.0 | libs + CLIs + modules | Per-call spans and payload/token profiling; OpenTelemetry; LLM tool-calling evals; Nuxt module; agent-skill generators. Use to *test* and *ship* ours, not to build the runtime. |

### 2.3 Registries / directories

- **[`AWESOME_WEBMCP.md`](https://github.com/GoogleChromeLabs/webmcp-tools/blob/main/AWESOME_WEBMCP.md)** —
  the de-facto curated list (~40 demos, ~20 libraries), in the Chrome Labs repo (Apache-2.0).
- **[webmcp.cool](https://webmcp.cool/)** (live directory + JSON discovery API, registers its own tools),
  **[webmcp-registry.dev](https://webmcp-registry.dev)** (DNS-TXT ownership, public search API) and
  **[WebMCP Today](https://webmcp.today/)** (site-specific packages; license **UNCONFIRMED**).
- **[model-context-tool-inspector](https://github.com/beaufortfrancois/model-context-tool-inspector)** —
  Chrome extension to inspect tools, visualize input schema, debug connections. **License UNCONFIRMED** (GitHub API rate-limited).

---

## 3. Prior-art check: "web devtools exposed as WebMCP"

Four things sit close. None identical.

### 3.1 TanStack `@tanstack/devtools-webmcp` — same idea, different subject matter ⭐

[`TanStack/devtools` `packages/devtools-webmcp`](https://github.com/TanStack/devtools/tree/main/packages/devtools-webmcp),
MIT, no runtime deps, ~200 lines. README: *"An agent in the browser cannot see the internals of your
library. WebMCP tools give that agent a way to read those internals **during development**."*
`registerDevtoolsTools({pluginId, instanceId, tools})` registers namespaced tools
(`tanstack.query.main.getQueryCache`), **forces `annotations: {...tool.annotations, debugging: true}`**,
manages lifetime with one `AbortController` per `(pluginId, instanceId)`, validates against the same
`[A-Za-z0-9_.-]{1,128}` rule, never throws (logs `console.error`, skips), and no-ops when no
`modelContext` exists. A `/production` subpath opts out of the dev-only no-op. **But** it exposes
library internals (query caches), not DOM/devtools capabilities, and it is bundler-only and **not
actually published** (npm `latest` is a `0.0.0` OIDC placeholder).

### 3.2 `@mcptrail/webmcp-devtools` — in-page dev panel *for* WebMCP

MIT (ElBartoTn). Patches `registerTool` on `navigator.modelContext` (default target; configurable),
lists every tool, **auto-builds a form from `inputSchema`**, invokes it, shows the result, and with
`webmcp-highlight` highlights what the call changed. Exports pure `schema → fields` and `coerceArgs`
helpers. This is the *human-facing inspector* half — complementary, and directly vendorable. Note it
still defaults to `navigator.modelContext` → **stale target**.

### 3.3 Latch — same delivery form, different tool surface

[`r0bertini/latch`](https://github.com/r0bertini/latch), **MIT**, `latch.tools/latch.js`, ~6 KB, one
line, zero deps, no backend. Feature-detects `document.modelContext` and if absent *does nothing*.
Registers four auto-detected tools against the site's own UI: `search_site`, `add_to_cart`,
`submit_form`, `navigate`. Also `Latch.inspect()` ("what an agent *would* see") and `Latch.debug`.
**Closest commercial competitor on form factor** — but not a devtools pack (end-user site actions, not
snapshot/click/fill/console/eval) and aimed at end-user AI browsers (Atlas, Comet, Chrome OT, Edge),
not a coding agent over CDP.

### 3.4 Chrome DevTools owns the *inspection* side

- **Application panel → WebMCP pane** ([docs](https://developer.chrome.com/docs/devtools/application/webmcp)):
  Available Tools with invocation counters; Invoked Tools log (status / input / output); filters by status
  and Declarative-vs-Imperative; **manual "Run tool"** with schema-generated inputs. Chrome 149+.
- **DevTools for agents** ([docs](https://developer.chrome.com/docs/devtools/agents/webmcp-debugging)):
  the coding agent gets `list_webmcp_tools` / `execute_webmcp_tool` (experimental flag) to verify
  exposure, execute tools, and judge schema clarity. This is the *consumer* we plan to serve.
- Neither provides in-page DOM-interaction tools.

### 3.5 Other adjacent work

- **[`aralroca/gui-agent`](https://github.com/aralroca/gui-agent)** (MIT, 16★) — nearest *code*: DOM tools with **stable refs (`e7`)** (`read_page`, `click`, `fill`, `select_option`, `drag`, `wait_for_text`; opt-in `upload_file`, `navigate`), preferring app tools over the DOM fallback — but it is an **agent** (own LLM, own loop), npm-only, no CDN script, pinning an *old* polyfill (`^3.0.0`). Its cousin **[`alibaba/page-agent`](https://github.com/alibaba/page-agent)** (MIT, 29.3k★) has our exact form factor — one CDN script, in-page — but it *is* the ReAct loop with BYO LLM.
- **[Drisp](https://github.com/lespaceman/agent-web-interface)** (MIT, stable `eid`s, Puppeteer/CDP), **[`AgentDeskAI/browser-tools-mcp`](https://github.com/AgentDeskAI/browser-tools-mcp)** v2 (MIT, extension streams console/network/screenshots/Lighthouse from your **real** Chrome to Cursor/Claude Code) and **[Web Bridge](https://github.com/JohnXu22786/browser-automation)** (MIT, 22 `web_*` tools, a11y-tree refs, Playwright, DSH plugin) are capability competitors with no WebMCP; Web Bridge is the closest *tool surface* to [`06-proposed-tool-surface.md`](../06-proposed-tool-surface.md).
- **[`nekuda-ai/WindTunnel`](https://github.com/nekuda-ai/WindTunnel)** (MIT) benchmarks WebMCP against other browser-agent interfaces — cite it instead of asserting benefits. Two neighbours on our side: **[`jo32/DeepDeck`](https://github.com/jo32/DeepDeck)** (MIT, DSH-based WebMCP client) and **[`T-Markus-Liang/dsh-webmcp`](https://github.com/T-Markus-Liang/dsh-webmcp)** (DSH WebMCP bridge).

### 3.6 Verdict

**Not scooped, but the field is not empty.** The combination — *CDN drop-in + devtools tool pack
(snapshot w/ stable refs, click/fill/type/press/select/hover/scroll/wait/upload, console capture, eval)
+ `debugging: true` + consumed by an external coding agent owning Chrome over CDP* — appears unclaimed.

| Axis | Taken by |
|---|---|
| One-line CDN script registering WebMCP tools | **Latch** (site actions, not devtools) |
| Devtools tools with `debugging: true` on WebMCP | **TanStack devtools-webmcp** (library internals, unpublished) |
| In-page DOM tool synthesis w/ stable refs | **gui-agent**, **page-agent** (both are agents) |
| Stable-ref page snapshot for coding agents | **Drisp**, **Web Bridge**, Playwright/DevTools MCP |
| Devtools data → coding agent | **browser-tools-mcp** (extension) |
| Inspecting/executing WebMCP tools | **Chrome DevTools** (panel + MCP) |

Consequence: generic `click/fill/eval` has no moat — `chrome-devtools-mcp` (57 tools, 52.9k★,
Apache-2.0) gives that away free. The defensible parts stay what `00-prior-art-and-positioning.md` §6
already named: **element → source `file:line` + component state**, **app-declared domain tools**, and the
**drop-in, discoverable, annotated** delivery.

---

## 4. Other browser MCP servers / browser-agent tool providers

Licenses read from the repo's `LICENSE` at HEAD. No row is in-page-first except where noted.

| Project | License | Surface / transport |
|---|---|---|
| [`merajmehrabi/puppeteer-mcp-server`](https://github.com/merajmehrabi/puppeteer-mcp-server) · `@modelcontextprotocol/server-puppeteer` (in [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers)) | MIT | 8 tools (navigate, screenshot, click, fill, select, hover, eval, tabs) and the original archived reference server; the first can attach to an **existing** Chrome. CDP. |
| [`browserbase/mcp-server-browserbase`](https://github.com/browserbase/mcp-server-browserbase) · [`browserbase/stagehand`](https://github.com/browserbase/stagehand) | Apache-2.0 · MIT | **Archived** 6-tool server (`start/end/navigate/act/observe/extract`) and the Stagehand SDK behind it; DOM understanding happens **in-page**, driven from Node. Cloud/CDP. |
| [`browserless/browserless`](https://github.com/browserless/browserless) | **SSPL OR commercial** ⚠️ | Headless-browser-as-a-service. Non-OSI — avoid. |
| [`steel-dev/steel-browser`](https://github.com/steel-dev/steel-browser) · [`hyperbrowserai/mcp`](https://github.com/hyperbrowserai/mcp) | Apache-2.0 · MIT | Open-source browser API/session infra; `scrape`/`extract`/`crawl` plus hosted CUA / Claude Computer Use / Browser Use agents. Cloud/CDP. |
| [`AgentDeskAI/browser-tools-mcp`](https://github.com/AgentDeskAI/browser-tools-mcp) | MIT | **In-page capture**: extension streams console/network/screenshots/Lighthouse from your real logged-in Chrome → MCP. |
| [`executeautomation/mcp-playwright`](https://github.com/executeautomation/mcp-playwright) · [`Lolaplex/agents-browser`](https://github.com/Lolaplex/agents-browser) | MIT | Playwright-driven tool suites; zero-Node Python CDP MCP. CDP. |
| [Drisp / `lespaceman/agent-web-interface`](https://github.com/lespaceman/agent-web-interface) | MIT | Semantic snapshots + **stable `eid`s**, regions, canvas, network. Puppeteer/CDP. |
| [Web Bridge / `JohnXu22786/browser-automation`](https://github.com/JohnXu22786/browser-automation) | MIT | 22 `web_*` tools, a11y-tree snapshot with refs; DSH plugin. Playwright. |
| [`PaulKinlan/webmcp-relay`](https://github.com/PaulKinlan/webmcp-relay) | **none at HEAD** ⚠️ | stdio MCP relay driving **Chrome DevTools MCP** (`list_webmcp_tools`), re-exports page tools dynamically, keeps a SQLite tool registry + search. Default = all rights reserved. |
| [Cloudflare `agents` → `experimental/webmcp`](https://github.com/cloudflare/agents/tree/main/examples/webmcp) | MIT (package) | One-line `registerWebMcp()` bridging remote `McpAgent` tools into the page alongside page-local tools. Still documents `navigator.modelContext` ⚠️; marked "will break". |

---

## 5. License triage

- **MIT — usable.** All `@mcp-b/*` (`webmcp-polyfill`, `global`, `smart-dom-reader`, `webmcp-local-relay`,
  `webmcp-types`, `react-webmcp`, `mcp-iframe`, `transports`, `webmcp-extension`); official `webmcp-types`
  and `webmachinelearning/webmcp-polyfill`; `@tanstack/devtools-webmcp`; `@mcptrail/webmcp-devtools`;
  Latch; `webmcp-core`; `@napster-corp/edge-mcp`; `webmcp-react`; `simple-webmcp`; `@web-ai-sdk/webmcp`;
  `@ashraf009/webmcp-kit`; `@webmcp-registry/kit`; `webmcp-profiler`; `@olumide100/webmcpify`; `gui-agent`;
  `page-agent`; `browser-use`; `stagehand`; `browser-tools-mcp`; Drisp; Web Bridge; `puppeteer-mcp-server`;
  `hyperbrowserai/mcp`; `executeautomation/mcp-playwright`; `agents-browser`.
- **Apache-2.0 — usable.** `GoogleChromeLabs/webmcp-tools` (incl. its `webmcp-polyfill.js`),
  `webmcp-evals`, `use-webmcp-tool`, `vue-webmcp`, `autotel-webmcp`, `chrome-devtools-mcp`,
  `playwright-mcp`, `steel-browser`, `browserbase/mcp-server-browserbase`.
- **Copyleft / non-OSI / commercial — copy ideas only, do not vendor.**
  `browserless/browserless` (**SSPL-1.0 or commercial**); `reticlehq/reticle` (**Apache-2.0 + FSL** —
  the Functional Source License is not OSI-approved; see `00-prior-art-and-positioning.md` §5.3);
  `PaulKinlan/webmcp-relay` (**no LICENSE** → all rights reserved); `WebMCP Today` (custom notice,
  **UNCONFIRMED**); `@napster-corp/edge-mcp`'s *hosted product* (code MIT, product commercial).

---

## 6. What we should reuse — shortlist

1. **Polyfill: do not write our own.** Pin **`@mcp-b/webmcp-polyfill@6.0.0-beta.*`** or vendor
   [`webmachinelearning/webmcp-polyfill`](https://github.com/webmachinelearning/webmcp-polyfill) (MIT).
   **Never ship 5.1.0** — it drops `debugging`/`consequentialHint` (verified in the published bundle),
   killing the "end-user agents filter us out" story. Keep the standard API behind one adapter file.
   Fallback vendor reference: ChromeLabs `demos/shared/webmcp-polyfill.js` (Apache-2.0, one 22 KB
   self-contained file; demo-grade, verify `getTools`/`executeTool` first).
2. **Copy (don't depend on) TanStack's registration layer.** MIT, ~200 lines, and it independently made
   our exact choices: `pluginId[.instanceId].name` namespacing, one `AbortController` per group,
   **forced `debugging: true`**, spec-legal name validation, never throws, no-op without `modelContext`.
   Not published and not CDN-shaped — reimplement in ~1 file.
3. **Vendor the schema→form helpers from `@mcptrail/webmcp-devtools`** (`fieldsFor`, `coerceArgs`) for a
   human-testable in-page panel; pair with `@mcptrail/webmcp-highlight` for "what did that call change".
   MIT; the only existing "build an input form from `inputSchema`" implementation.
4. **DOM extraction:** `@mcp-b/smart-dom-reader` (MIT) for selector ranking + shadow-DOM/iframe
   traversal — its `bundle-string` export is built to be injected. Prefer it over a fourth serializer.
5. **Tool-surface ideas (MIT — read, re-implement):** Web Bridge's `web_*` naming + a11y-snapshot refs;
   Drisp's regions / `eid` / "what changed after the previous action"; gui-agent's `WeakMap`-stable refs
   and its `read_page`/`click`/`fill`/`select_option`/`drag`/`wait_for_text` set; chrome-devtools-mcp's
   batch `fill_form` and post-action snapshot.
6. **Testing:** `webmcp-evals` (Apache-2.0) for tool-calling evals; `webmcp-profiler` (MIT) for per-call
   payload/token profiling; `WindTunnel` (MIT) if we ever make a public benchmark claim.
7. **Bridge, only when the agent does *not* own the browser:** `@mcp-b/webmcp-local-relay` (MIT, pin the
   version). `PaulKinlan/webmcp-relay` is unlicensed — ideas only. **Distribution:** list in
   `AWESOME_WEBMCP.md`, `webmcp.cool`, `webmcp-registry.dev`, WebMCP Today — that is where the ecosystem
   currently discovers packs.

**Explicitly do not:** write a polyfill; write another DOM serializer; ship `click`/`fill`/`js_eval` as
the headline (chrome-devtools-mcp has 57 free Apache-2.0 tools); depend on `navigator.modelContext`; rely
on `debugging` surviving a 5.1.0 polyfill or DevTools' inspector; assume declarative schema synthesis is stable.

---

## Sources fetched (primary)

**Spec:** <https://webmachinelearning.github.io/webmcp/> · `index.bs` raw source (main) · the repo's
[README](https://github.com/webmachinelearning/webmcp/blob/main/README.md),
[implementation-status.md](https://github.com/webmachinelearning/webmcp/blob/main/implementation-status.md),
[declarative-api-explainer.md](https://github.com/webmachinelearning/webmcp/blob/main/declarative-api-explainer.md),
[issue #173](https://github.com/webmachinelearning/webmcp/issues/173), [PR #184](https://github.com/webmachinelearning/webmcp/pull/184),
[PR #245](https://github.com/webmachinelearning/webmcp/pull/245), [PR #253](https://github.com/webmachinelearning/webmcp/pull/253),
and the GitHub commits API for `index.bs`.
**Chrome:** [WebMCP](https://developer.chrome.com/docs/ai/webmcp) · [imperative-api](https://developer.chrome.com/docs/ai/webmcp/imperative-api) ·
[declarative-api](https://developer.chrome.com/docs/ai/webmcp/declarative-api) · [origin-trial blog](https://developer.chrome.com/blog/ai-webmcp-origin-trial) ·
[DevTools WebMCP panel](https://developer.chrome.com/docs/devtools/application/webmcp) ·
[Debug WebMCP tools with an AI agent](https://developer.chrome.com/docs/devtools/agents/webmcp-debugging).
**Packages** (npm registry; tarballs downloaded and grepped): `@mcp-b/webmcp-polyfill@5.1.0` and
`@6.0.0-beta.20261001010549`, `@mcp-b/global@5.1.0`, `@mcp-b/webmcp-types@5.1.0`, `webmcp-types@0.1.10`,
`@mcp-b/smart-dom-reader@5.1.0`, `@mcp-b/webmcp-local-relay@5.1.0`, `@tanstack/devtools-webmcp@0.0.0`,
plus license/version probes for ~25 more.
**Repos:** every repository linked in §2–§4 was fetched at `HEAD` (README, LICENSE, module source, or npm
metadata). The only third-party summary relied on is
[webmaxru/web-ai-agent-skills compatibility.md](https://github.com/webmaxru/web-ai-agent-skills/blob/main/skills/webmcp/references/compatibility.md)
(cited as such in §1.3).
