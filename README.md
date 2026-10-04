# page-mcp

A CDN-delivered **WebMCP tool provider**.

Drop one `<script>` into a web UI and that page's own JS engine starts hosting a
set of devtools tools on `document.modelContext`:

- **DOM inspection** — a text outline of the page with stable element refs
- **Interactions** — click, fill, type, press, select, hover, scroll, upload
- **Diagnostics** — console/error capture, and a JS REPL

Any agent that can reach the page can discover and call them. There is no
server, no LLM and no chat UI in here — this is the tool surface, not an agent.

```html
<script src="https://cdn.jsdelivr.net/npm/page-mcp/dist/page-mcp.js"></script>
<!-- unpkg mirror: https://unpkg.com/page-mcp/dist/page-mcp.js -->
```

`npm i page-mcp` ships the same single file at
`node_modules/page-mcp/dist/page-mcp.js` for self-hosting.
---

## How it is consumed

The premise is that the **coding agent owns the browser**: it launches Chrome
(headless or not), points it at the app it is working on, and drives it over
CDP. Under that premise the agent needs no bridge — the WebMCP tools are
reachable through the channel it already has.

```
   coding agent (Claude Code / Cursor / DSH / …)
              │
              │  the browser channel it already has
              │  · CDP Runtime.evaluate
              │  · chrome-devtools-mcp (list_webmcp_tools / execute_webmcp_tool)
              │  · Playwright / Puppeteer
              ▼
      Chrome  ──  page + <script src="…/page-mcp.js">
                        │
                        ▼
              document.modelContext
              ├── dev_snapshot, dev_click, dev_fill, …
              └── <tools the app registers itself>
```

### `executeTool` calling contract, including the failure shapes

```
executeTool(tool, "{}")              // ✓ the second argument is a JSON STRING
executeTool("name", "{}")            // ✗ TypeError: RegisteredTool must be an object
executeTool(tool, {})                // ✗ DOMException UnknownError: Failed to parse input
                                     //   arguments — a DOMException, NOT a TypeError, so
                                     //   harnesses that classify errors by constructor
                                     //   name mis-sort this one as a tool bug
```

The result is the tool's own raw string, not a CallToolResult wrapper.

Two details worth stating precisely:

1. **CDP `Runtime.evaluate` runs in the page's own realm**, so the `tools`
   Permissions-Policy default allowlist (`'self'`) is satisfied — page JS can
   call `getTools()` / `executeTool()`, and so can an agent evaluating in that
   realm.
2. **Do not depend on Chrome's native WebMCP.** It sits behind a flag / origin
   trial. The bundle carries the polyfill and installs it only when
   `document.modelContext` is absent, so the same file works on stable Chrome
   with no flag, in headless, and in Firefox/Safari.

A relay or extension is only needed when the agent does **not** own the browser
— i.e. the tools live in the developer's own everyday Chrome. That is a
secondary case; `@mcp-b/webmcp-local-relay` covers it.

---

## The app's own tools

The highest-value half. A page can register tools that expose its own domain
state, which no external agent can infer from the DOM:

```js
window.pageMcp.register({
  name: "vitrine_state",
  description: "Read the live state of the 3D viewer…",
  annotations: { readOnlyHint: true },
  inputSchema: { type: "object", properties: {} },
  run: () => JSON.stringify({ /* … */ }),
});
```

This matters most where the DOM is empty. In the bundled demo the app renders
into a WebGL canvas: a snapshot shows three buttons, while `vitrine_state`
reports the scene graph, renderer stats and materialize progress. Module-scoped
bindings are unreachable from `eval`, so registering a tool is the *only* way
to expose them.

---

## Tools

| Tool | What it does |
|---|---|
| `dev_snapshot` | Text outline of the page; stable refs; `include_hidden` |
| `dev_read` | Text, attrs, computed style, CSS path for one ref |
| `dev_find` | Search by word/phrase, get live refs — no full snapshot needed |
| `dev_box` | Geometry + hit-test state; the handoff for a CDP element screenshot |
| `dev_geometry_audit` | Prove clipped text / unclickable / broken-image defects without pixels |
| `dev_click` | Real pointer/mouse sequence, then native click |
| `dev_fill` | Set one field's value, or a whole form in one call (React/Vue-aware) |
| `dev_type` | Per-keystroke typing for autocomplete-style inputs |
| `dev_press` | Key or key combination |
| `dev_select` | Choose an option in a native `<select>`, or list the options first |
| `dev_hover` | Pointer over an element |
| `dev_drag` | Pointer drag, ref **or CSS selector** — reaches canvases that have no ref |
| `dev_scroll` | Scroll by delta or bring a ref into view |
| `dev_upload` | Attach files (url or base64) to a file input or dropzone |
| `dev_wait` | Wait for a selector, text or JS predicate |
| `dev_console` | Console + uncaught errors + unhandled rejections |
| `dev_network` | fetch / XHR / beacon, **with the call site that made each request** |
| `dev_storage` | localStorage / sessionStorage / cookie read-write, for setting up or resetting app state |
| `dev_changes` | Ordered DOM delta since a token — what your action actually did |
| `dev_perf` | Long tasks / LCP / CLS / heap + a **live** frame sample |
| `dev_assert` | Check several facts in one call; a failure is a real failure |
| `dev_eval` | JS REPL |

Names are prefixed (`data-prefix`) so they cannot collide with another browser
tool set in the same agent context. Every tool carries `debugging: true`, which
a consuming agent can use to filter dev tooling out of an end-user surface.

---

## Boundaries and known limits

- **`style-src` without `'unsafe-inline'`** kills inline styles. Measured on
  Chrome 151: `<style>` in a shadow root is blocked, `el.style.x = …` is
  blocked and a violation is logged, but `CSSStyleSheet` +
  `adoptedStyleSheets` works. The page indicator and the click highlight use
  the latter.
- **`script-src` without `'unsafe-eval'`** kills `dev_eval`. It fails with a
  readable message rather than a crash; the CSP-safe path is to have the app
  register named tools. `dev_snapshot` and the act tools are unaffected.
- **Unknown and mistyped arguments are rejected, not ignored.** `dev_scroll {delta_y: 200}`
  once scrolled by 0 and reported success. Validation now refuses the call before it runs:
  `invalid arguments — unknown property "delta_y" — accepted: ref, dx, dy, include_snapshot.`
  A third-party wrapper that forwards extra fields will be refused outright rather than
  silently mis-executing. That is deliberate; opt out per tool with `additionalProperties: true`.
- **Some tools cannot exist in the page.** `dev_upload` takes a URL or base64
  because the page cannot read a path on the developer's disk. Uploading a host
  path is a job for the agent's CDP layer (`DOM.setFileInputFiles`); screenshots
  are likewise a CDP-side concern (`canvas.toDataURL` only works when the app
  preserved the drawing buffer).
- **`debugging` is dropped on Chrome 151** — both native and polyfilled
- **Annotations are not propagated by the runtime — so we restore them.** On
  Chrome 151, native `getTools()` returns `readOnlyHint: false` even for a tool
  that registered `true`, and the bundled polyfill
  (`@mcp-b/webmcp-polyfill@5.1.0`) hard-drops `debugging` and
  `consequentialHint` entirely. Since we know what we registered, `getTools()`
  is wrapped to merge our annotations back in, so a consumer now sees
  `debugging: true` on both runtimes.
  Do **not** "fix" this by switching to the 6.0.0-beta polyfill or the CG's
  own polyfill: they preserve the keys but change `executeTool` to take an
  input **object**, while native Chrome and chrome-devtools-mcp pass a JSON
  **string**. That trades an annotation for an interop break.
  Measured: docs/research/polyfill-annotation-verification.md.
- **Secure context required.** `document.modelContext` is `[SecureContext]`.
  `https://` and `localhost` / `127.0.0.1` qualify; plain-HTTP on a LAN IP does
  not.
- **Dev-only by construction.** `dev_eval` is arbitrary JS execution in the
  user's session. The page-corner indicator says so and the script tag can be
  omitted from production builds.

---

## Development

```bash
npm install
npm run build          # dist/page-mcp.js — single-file IIFE, polyfill included
node harness/make-demo.mjs   # regenerate demo/index.html from the three.js app
npm run serve          # http://127.0.0.1:8940/demo/
npm run drive          # end-to-end suite, native + polyfill runtimes
```

`harness/browser.mjs` is the browser tool an agent owns — a CDP attach client,
deliberately *not* a bridge to this package:

```bash
node harness/browser.mjs start http://127.0.0.1:8940/demo/
node harness/browser.mjs tools
node harness/browser.mjs call dev_snapshot
node harness/browser.mjs screenshot /tmp/shot.png
```

### Verified

- 56/56 end-to-end assertions pass in both runtimes (native flag, and polyfill
  with no flag): discovery via `getTools()`, `executeTool()` round trips,
  snapshot of a canvas page, disabled-control diagnosis, app-tool read and
  mutation, console capture, form pass, eval. Tool count: 24 per runtime.
- The published demo works over public HTTPS with the polyfill
  (<https://view.pc.randomhash.app/2026-10-03_webmcp-devtools-demo/>).
- Styling survives a response-header CSP of
  `default-src 'self'; script-src 'self'; style-src 'self'` with 0 violations.

Independently reproduced by other agents on different machines (Chrome 147 +
Chrome 151; docs/03, docs/10) — docs/10 records 24/24 tools usable in a third
environment.
Docs — [index](docs/README.md) ·
[00 positioning](docs/00-prior-art-and-positioning.md) ·
[01 agent usability test](docs/01-agent-usability-test.md) ·
[02 measurements](docs/02-measurements.md) ·
[03 external verification](docs/03-verification-demo-2026-10-03.md) ·
[04 drive rerun](docs/04-verification-drive-rerun-2026-10-03.md)

> Headless without software GL (`--enable-unsafe-swiftshader --use-angle=swiftshader`) will
> hide any app-registered tools: the app's module aborts on a failed WebGL context and its
> `register()` calls never run. `harness/browser.mjs` and `drive.mjs` pass the flags already.
