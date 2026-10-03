# Polyfill annotation verification: does `debugging` survive `getTools()`?

**Date:** 2026-10-03
**Scope:** adversarial, browser-measured verification of an external audit claim about
`@mcp-b/webmcp-polyfill@5.1.0`, `@mcp-b/webmcp-polyfill@6.0.0-beta.20261001010549`,
and `webmachinelearning/webmcp-polyfill`.

**Bottom line up front:** the annotation-dropping claim is **CONFIRMED for 5.1.0** and the
"v6/CG preserve them" claim is **CONFIRMED** — but the audit's framing understates two
things that matter more for our safety story: (1) **native Chrome 151 with
`--enable-features=WebMCP` also drops `debugging` and `consequentialHint`**, and (2) our own
`src/mcp.js` skips the polyfill entirely when a native implementation exists, so changing the
polyfill does not fix the native case. Separately, the audit's pointer to
`dist/polyfill.js` in the CG repo **does not exist as a committed file** — it is a build
artifact (REFUTED sub-claim; the preservation claim itself still confirmed by building it).

---

## 1. Environment and method

| Item | Value |
| --- | --- |
| Chrome | `Google Chrome 151.0.7922.173` (`/usr/bin/google-chrome-stable`) |
| Puppeteer | `puppeteer-core@25.12.0` from `dev-webmcp/node_modules` |
| Launch flags | `--no-sandbox --disable-dev-shm-usage` (+ `--enable-features=WebMCP` for the native control) |
| Static server | `http://127.0.0.1:8940` (`node serve.mjs`, serving the repo root) |
| Isolation | each variant ran in a **fresh browser process** and a **fresh page** |
| Date | 2026-10-03 |

Every page registers the same probe tool and then reports the raw object returned by
`document.modelContext.getTools()`. Raw results (all steps, all four variants, all double-load
runs) are saved verbatim in `results.json`.

### 1.1 Artifacts actually tested

| # | Variant | Exact source | SHA-256 of tested JS |
| --- | --- | --- | --- |
| 1 | `@mcp-b/webmcp-polyfill@5.1.0` | `dev-webmcp/node_modules/@mcp-b/webmcp-polyfill/dist/index.iife.js` (the version in `package.json`) | `ae7b1189bf907dc3daea844d67e4c9343eab6a455c3ce4d94a9bcf97295fc184` |
| 2 | `@mcp-b/webmcp-polyfill@6.0.0-beta.20261001010549` | npm tarball `https://registry.npmjs.org/@mcp-b/webmcp-polyfill/-/webmcp-polyfill-6.0.0-beta.20261001010549.tgz` → `package/dist/index.iife.js` | JS `67fb63464fb113846e5abfb95315f942eb52552cf2881cd5b46b1d988dc6a7dc`; tarball `86025e1e292c86d7e08b8b9f4b049d22b6d0a5f890e9cea03b29fbe0b9ad7bd7` |
| 3 | `webmachinelearning/webmcp-polyfill` (CG, official) | `git clone https://github.com/webmachinelearning/webmcp-polyfill.git`, commit **`6bf6c57bbaf3d1173d7737cfb79572632d9b7871`** (branch `main`), then `pnpm install && pnpm build` → `dist/polyfill.js` | `78db902ddaa02e22045354471380b30d79464569f87070951e44c713ef39e4e9` |
| 4 | Native Chrome 151, **no polyfill** | control, launched with `--enable-features=WebMCP` | n/a |

**Note on variant 3 (important for honesty):** `dist/polyfill.js` is **not committed** to the
CG repo. `https://raw.githubusercontent.com/webmachinelearning/webmcp-polyfill/main/dist/polyfill.js`
returns **404**, and the repo tree at `main` (70 files, via `data.jsdelivr.com`) contains
**no `dist/` directory at all**. The file is produced by the repo's own build script:

```
tsc && esbuild src/auto.ts --bundle --format=iife --target=es2022 --minify --legal-comments=inline --outfile=dist/polyfill.js
```

I ran the full documented `pnpm build` (pnpm 10.14.0, `tsc` + `esbuild`) in the clone. The
resulting `dist/polyfill.js` is **byte-identical** to an esbuild-only build I had made first
(same SHA-256 `78db902d…`), so the artifact under test is exactly the repo's own build output
— but it had to be built, not fetched.

**Also note:** the CG package is **unpublished on npm**. Its `package.json` declares
`name: "webmcp-polyfill"`, version `0.1.0`, but the npm name `webmcp-polyfill` is owned by a
*different* project (`0.0.2`, repo `ripulio/web-mcp`). The CG README says "This package is in
development." Using it means vendoring a build.

`@mcp-b@6.0.0-beta.20261001010549` is the **only 6.x version** on npm and carries the `beta`
dist-tag; `latest` is still `5.1.0`.

### 1.2 Reproduction

```sh
cd /home/u1/workspaces/browser-agent/dev-webmcp
node serve.mjs &                       # if not already on :8940
cd .tmp/polyfill-verify
node gen-pages.mjs
node driver.mjs                        # writes results.json
```

Test pages and driver created for this task are listed in §7.

---

## 2. Variant 1 — `@mcp-b/webmcp-polyfill@5.1.0` (what we ship)

**Script URL:** `http://127.0.0.1:8940/.tmp/polyfill-verify/vendor/v5/index.iife.js`
(copied from `node_modules/@mcp-b/webmcp-polyfill/dist/index.iife.js`).

**Tool registered** with `annotations: { readOnlyHint: true, untrustedContentHint: true,
consequentialHint: true, debugging: true }`, `title: "Verify Tool A"`, and
`inputSchema: { type:"object", properties:{x:{type:"number"}}, required:["x"], additionalProperties:false }`.

### 2.1 Raw `getTools()` entry, verbatim

(`JSON.stringify` on the live object throws `TypeError: Converting circular structure to JSON`
because each tool carries a real `window` property; the dump below substitutes only that
property with `"[non-plain [object Window]]"`. Every other byte is the measured value.)

```json
{
  "name": "verify_tool_a",
  "title": "Verify Tool A",
  "description": "annotation survival probe",
  "inputSchema": {
    "type": "object",
    "properties": {
      "x": {
        "type": "number"
      }
    },
    "required": [
      "x"
    ],
    "additionalProperties": false
  },
  "origin": "http://127.0.0.1:8940",
  "window": "[non-plain [object Window]]",
  "annotations": {
    "readOnlyHint": true,
    "untrustedContentHint": true
  }
}
```

### 2.2 Annotation survival

| Key sent | Present after `getTools()` | Value | `typeof` |
| --- | --- | --- | --- |
| `readOnlyHint: true` | **yes** | `true` | `boolean` |
| `untrustedContentHint: true` | **yes** | `true` | `boolean` |
| `consequentialHint: true` | **NO — DROPPED** | `[absent]` | `undefined` |
| `debugging: true` | **NO — DROPPED** | `[absent]` | `undefined` |

`Object.getOwnPropertyNames(tool.annotations)` → `["readOnlyHint","untrustedContentHint"]`.

**Silent?** Yes. No console warning, no error; the only console output is the unrelated
install-time `navigator.modelContext is deprecated` warning. The removal is a hard-coded
whitelist in the shipped code (`dist/schema.js`):

```js
function toWebMcpAnnotations(annotations) {
	return {
		readOnlyHint: annotations.readOnlyHint ?? false,
		untrustedContentHint: annotations.untrustedContentHint ?? false
	};
}
```

`grep -oiE "[a-z]*hint[a-z]*" dist/schema.js` finds `readOnlyHint`, `untrustedContentHint`,
`destructiveHint`, `idempotentHint`, `openWorldHint` — and **zero occurrences of `debugging`
or `consequentialHint`** anywhere in the 5.1.0 dist. The audit's "keeps only MCP-B's own hint
names" is literally true.

**Defaults:** a tool registered with all four hints `false` comes back as
`{"readOnlyHint":false,"untrustedContentHint":false}` — the other two are still absent. A tool
registered with **no** `annotations` field comes back with **no `annotations` property at all**
(`annotations_field_present: false`).

### 2.3 `inputSchema` type

`typeof inputSchema === "object"`, a real object (not an array, not a JSON string). The
declared schema round-trips structurally intact.

### 2.4 Events

* **`toolchange` on registration: YES.** Exactly one event per successful `registerTool`.
  Shape: constructor `Event`, `e instanceof Event === true`, `type === "toolchange"`,
  `isTrusted === false`, **no `toolName` property**, **no `detail`** (undefined). It is
  dispatched **at `document.modelContext`** — it was caught by a listener on
  `document.modelContext` and did **not** appear on listeners attached to `document` or `window`.
* **`toolcancel`: NEVER observed** — not on registration, not during `executeTool`, not when
  the registration `AbortController` was aborted mid-execution. The string `toolcancel` does
  **not exist** anywhere in the 5.1.0 bundle.
* **`toolactivated`: NOT observed on the imperative path.** The string exists, but the only
  dispatch site is the *declarative form* path:
  `function B(e){let t=new Event("toolactivated");Object.defineProperty(t,"toolName",{enumerable:!0,value:e});...}`
  … `window.dispatchEvent(B(t))` in the form-submit handler. So when it does fire (declarative
  forms only), it is a plain `Event` with an own enumerable `toolName` property, dispatched on
  **`window`**. No spec `ToolActivatedEvent` class exists. The declarative path was **not
  exercised** in this test.

### 2.5 Duplicate tool name

**Throws; does not warn; does not replace.**

```
DOMException: InvalidStateError: Tool already registered: verify_tool_a
```

After the failed duplicate, `getTools()` still returns **exactly one** `verify_tool_a` and the
**original** title/description (`"Verify Tool A"` / `"annotation survival probe"`) are retained.
No console output.

### 2.6 `executeTool`

Signature is `executeTool(RegisteredTool, jsonString)` — `executeTool.length === 2`.

* **Exists:** yes, `typeof === "function"`.
* **Success** — `executeTool(tool, '{"x":1}')` returns a **string**:
  ```
  {"ok":true,"echo":{"x":1}}
  ```
* **Tool throws** — rejects (does **not** return a value):
  ```
  UnknownError: Tool was executed but the invocation failed. For example, the script function threw an error: boom-tool-error
  ```
* **Tool returns a raw string** `"plain-string-result"` → returns
  `plain-string-result` (verbatim, **not** JSON-quoted).
* **Passing an object instead of a JSON string** fails:
  `UnknownError: Failed to parse input arguments`.
* **Passing a name instead of a tool object** fails:
  `TypeError: RegisteredTool must be an object`.

### 2.7 Script loaded twice

Both a plain double-`<script>` load and an adversarial "register a tool **between** the two
loads" test were run. **Nothing breaks.**

* Context identity preserved (`ctxBefore === ctxAfter` → `true`).
* A tool registered after load #1 (`survivor_tool`) **survives load #2** and is still
  executable: `executeTool` returned `{"survivor":true}`.
* Registering a new tool after load #2 works (`ok`); final tool set is
  `["post_second_tool","survivor_tool"]`.
* No errors, no extra warnings. The deprecation warning still appears only **once**.
* Annotations are still dropped after the double load (unchanged behaviour).

---

## 3. Variant 2 — `@mcp-b/webmcp-polyfill@6.0.0-beta.20261001010549`

**Script URL:** `http://127.0.0.1:8940/.tmp/polyfill-verify/vendor/v6/index.iife.js`
(extracted from the npm tarball; SHA-256 `67fb6346…`).

### 3.1 Raw `getTools()` entry, verbatim

```json
{
  "annotations": {
    "consequentialHint": true,
    "debugging": true,
    "readOnlyHint": true,
    "untrustedContentHint": true
  },
  "description": "annotation survival probe",
  "inputSchema": {
    "type": "object",
    "properties": {
      "x": {
        "type": "number"
      }
    },
    "required": [
      "x"
    ],
    "additionalProperties": false
  },
  "name": "verify_tool_a",
  "origin": "http://127.0.0.1:8940",
  "title": "Verify Tool A",
  "window": "[non-plain [object Window]]"
}
```

### 3.2 Annotation survival

| Key sent | Present | Value | `typeof` |
| --- | --- | --- | --- |
| `readOnlyHint: true` | **yes** | `true` | `boolean` |
| `untrustedContentHint: true` | **yes** | `true` | `boolean` |
| `consequentialHint: true` | **yes** | `true` | `boolean` |
| `debugging: true` | **yes** | `true` | `boolean` |

`annotations` keys → `["consequentialHint","debugging","readOnlyHint","untrustedContentHint"]`.

All-`false` registration round-trips as
`{"consequentialHint":false,"debugging":false,"readOnlyHint":false,"untrustedContentHint":false}`
— the keys are **present with value `false`**, not dropped. A tool with **no** `annotations`
field still gets **no `annotations` property** (absent, not a defaulted object).

The bundle contains an explicit allowlist literal:
`let t=["consequentialHint","debugging","readOnlyHint","untrustedContentHint"]`.

### 3.3 `inputSchema` type

`typeof === "object"` — real object, identical structure to v5.

### 3.4 Events

* `toolchange` on registration: **YES**, one per registration, plain `Event`,
  `instanceof Event === true`, `type "toolchange"`, `isTrusted false`, **no `toolName`**,
  **no `detail`**, dispatched at `document.modelContext` (not on `document`/`window`).
* `toolcancel`: **never fired** in this test. The string exists in the bundle but only inside
  the *declarative form* abort handler:
  `e.dispatchEvent(L("toolcancel", n.name))`.
* `toolactivated`: **never fired** on the imperative path. Again only in the declarative
  form-submit path: `e.dispatchEvent(L("toolactivated", n.name))` (dispatched on `window`).
  Same plain-`Event` + own `toolName` construction, no spec `ToolActivatedEvent`.

### 3.5 Duplicate tool name

**Throws; no warn; no replace.** Message differs from 5.1.0:

```
DOMException: InvalidStateError: A tool named verify_tool_a is already registered
```

State after: exactly one `verify_tool_a`, original title/description retained.

### 3.6 `executeTool` — **signature changed**

`executeTool.length === 1`. This version takes an **input object**, not a JSON string.

* `executeTool(tool, '{"x":1}')` → **throws** `TypeError: inputObject must be an object`.
* `executeTool(tool, {x:1})` → returns a **string**: `{"ok":true,"echo":{"x":1}}`.
* Tool throws (object arg) → rejects:
  ```
  UnknownError: Tool execution failed
  ```
* Tool returns raw string `"plain-string-result"` → returns the **JSON-encoded** string
  `"plain-string-result"` (with quotes — different from 5.1.0/native, which return it bare).
* Name instead of tool object → `TypeError: Expected a dictionary`.

**This is a breaking call-convention change for anything that drives our tools.** Our shipped
`dist/devtools.js` only *registers* tools (no `executeTool` call sites in `src/`), but
`harness/drive.mjs:80`, `harness/browser.mjs:178`, and `harness/recheck-reports.mjs:165` all
call `executeTool(tool, JSON.stringify(input))` and would need updating.

### 3.7 Script loaded twice

Same as 5.1.0: **nothing breaks.** Context identity preserved, `survivor_tool` registered
between the loads survives and executes (`{"survivor":true}`), post-second-load registration
works, no console output or errors. Annotations still preserved after the double load.

---

## 4. Variant 3 — `webmachinelearning/webmcp-polyfill` (official CG, built)

**Script URL:** `http://127.0.0.1:8940/.tmp/polyfill-verify/vendor/cg/polyfill.js`
(built from commit `6bf6c57bbaf3d1173d7737cfb79572632d9b7871`; SHA-256 `78db902d…`).

### 4.1 Raw `getTools()` entry, verbatim

```json
{
  "annotations": {
    "consequentialHint": true,
    "debugging": true,
    "readOnlyHint": true,
    "untrustedContentHint": true
  },
  "description": "annotation survival probe",
  "inputSchema": {
    "type": "object",
    "properties": {
      "x": {
        "type": "number"
      }
    },
    "required": [
      "x"
    ],
    "additionalProperties": false
  },
  "name": "verify_tool_a",
  "origin": "http://127.0.0.1:8940",
  "title": "Verify Tool A",
  "window": "[non-plain [object Window]]"
}
```

### 4.2 Annotation survival

Identical to variant 2: **all four keys present with value `true`**, keys
`["consequentialHint","debugging","readOnlyHint","untrustedContentHint"]`. All-`false`
round-trips as four explicit `false` values; no-`annotations` yields no `annotations` property.

Source (`src/frames.ts:12`) confirms the allowlist:
```ts
export const annotationNames = ["consequentialHint","debugging","readOnlyHint","untrustedContentHint"] as const;
```
and `readAnnotations` (`src/index.ts:489`) **coerces every listed name with `Boolean(...)`**,
so the four keys are always emitted when an annotations dictionary is supplied.

Note the CG list is **exactly** the v6-beta list, and it is *not* the full MCP hint set —
`destructiveHint`, `idempotentHint`, `openWorldHint` are not in it.

### 4.3 `inputSchema` type

`typeof === "object"` — real object.

### 4.4 Events

* `toolchange` on registration: **YES**, one per registration, plain `Event`,
  `instanceof Event === true`, `type "toolchange"`, **no `toolName`**, **no `detail`**,
  dispatched at `document.modelContext`.
* `toolcancel`: **not present in the bundle at all** (`grep` → absent). Never fires.
* `toolactivated`: **not present in the bundle at all**. Never fires. No spec
  `ToolActivatedEvent` / `ToolCancelEvent` classes exist.

### 4.5 Duplicate tool name

```
DOMException: InvalidStateError: A tool named verify_tool_a is already registered
```
Same as v6 beta: throws, no warn, no replace, original retained.

### 4.6 `executeTool`

Same object-argument convention as v6 beta (`executeTool.length === 1`):

* `executeTool(tool, '{"x":1}')` → `TypeError: inputObject must be an object`.
* `executeTool(tool, {x:1})` → string `{"ok":true,"echo":{"x":1}}`.
* Tool throws → rejects `UnknownError: Tool execution failed`.
* Raw string return → JSON-encoded `"plain-string-result"` (quoted).
* Name instead of tool → `TypeError: Expected a dictionary`.

### 4.7 Script loaded twice

**Nothing breaks.** Context identity preserved, `survivor_tool` survives load #2 and executes
(`{"survivor":true}`), post-second-load registration works, no console output or errors.

---

## 5. Variant 4 — native Chrome 151 control (`--enable-features=WebMCP`, no polyfill)

Native WebMCP **is available** in headless Chrome 151.0.7922.173 with
`--enable-features=WebMCP`: `document.modelContext` exists, `navigator.modelContext` is the
same object, and `registerTool`/`getTools`/`executeTool` all work.

### 5.1 Raw `getTools()` entry, verbatim

```json
{
  "description": "annotation survival probe",
  "inputSchema": "{\"type\":\"object\",\"properties\":{\"x\":{\"type\":\"number\"}},\"required\":[\"x\"],\"additionalProperties\":false}",
  "name": "verify_tool_a",
  "annotations": {
    "readOnlyHint": true,
    "untrustedContentHint": true
  },
  "origin": "http://127.0.0.1:8940",
  "title": "Verify Tool A",
  "window": "[non-plain [object Window]]"
}
```

### 5.2 Annotation survival — same loss as 5.1.0

| Key sent | Present | Value |
| --- | --- | --- |
| `readOnlyHint: true` | **yes** | `true` |
| `untrustedContentHint: true` | **yes** | `true` |
| `consequentialHint: true` | **NO — DROPPED** | absent |
| `debugging: true` | **NO — DROPPED** | absent |

Keys → `["readOnlyHint","untrustedContentHint"]`. All-`false` → the same two keys as `false`.

### 5.3 `inputSchema` type — **a JSON string, not an object**

`typeof inputSchema === "string"`, and it parses cleanly with `JSON.parse`:
```
{"type":"object","properties":{"x":{"type":"number"}},"required":["x"],"additionalProperties":false}
```
This is a real divergence from all three polyfills, which hand back an object. Any consumer that
does `tool.inputSchema.type` will get `undefined` on native Chrome 151.

### 5.4 Events — native is the only variant that fires `toolactivated`

* `toolchange` on registration: **YES**, plain `Event`, `type "toolchange"`,
  `isTrusted === true`, no `toolName`, no `detail`, dispatched at `document.modelContext`.
* **`toolactivated`: YES — fired 7 times on `window`**, once per `executeTool` invocation
  (including calls whose input parsing subsequently failed). Shape:
  * constructor name **`WebMCPEvent`** — *not* a spec `ToolActivatedEvent`
  * `e instanceof Event === true`
  * `type === "toolactivated"`, `isTrusted === true`
  * **`toolName` is an accessor on the prototype** (not an own property), value = invoked tool
    name (`"exec_ok"`, `"exec_throw"`, `"exec_string_return"`, `"exec_slow"`, …)
  * no `detail`
  * dispatched **on `window`**; a listener on `document` did **not** receive it.
* `toolcancel`: **never observed.**

### 5.5 Duplicate tool name

```
DOMException: InvalidStateError: Duplicate tool name
```
Throws, no warn, no replace; original retained.

### 5.6 `executeTool` — takes a JSON string (like 5.1.0)

`executeTool.length === 2`.

* `executeTool(tool, '{"x":1}')` → string `{"ok":true,"echo":{"x":1}}`.
* Tool throws → rejects:
  ```
  UnknownError: Tool was executed but the invocation failed. For example, the script function threw an error
  ```
  (note: without the `: boom-tool-error` suffix that 5.1.0 appends).
* Raw string return → `plain-string-result` (bare).
* Object instead of string → `UnknownError: Failed to parse input arguments`.
* Name instead of tool →
  `TypeError: Failed to execute 'executeTool' on 'ModelContext': The provided value is not of type 'RegisteredTool'.`

---

## 6. Cross-variant matrix

| Property | `@mcp-b` 5.1.0 | `@mcp-b` 6.0.0-beta | CG polyfill | Native Chrome 151 |
| --- | --- | --- | --- | --- |
| `debugging` survives `getTools()` | **NO** | **YES** | **YES** | **NO** |
| `consequentialHint` survives | **NO** | **YES** | **YES** | **NO** |
| `readOnlyHint` / `untrustedContentHint` | yes | yes | yes | yes |
| false-valued extra hints present as `false` | n/a (dropped) | yes | yes | n/a (dropped) |
| `inputSchema` type | object | object | object | **JSON string** |
| `toolchange` on register | yes | yes | yes | yes |
| `toolchange` event class | `Event` | `Event` | `Event` | `Event` |
| `toolchange.toolName` | absent | absent | absent | absent |
| `toolactivated` (imperative) | no (declarative only) | no (declarative only) | **absent from bundle** | **yes, on `window`** |
| `toolactivated` class | `Event` + own `toolName` | `Event` + own `toolName` | n/a | `WebMCPEvent` + proto `toolName` |
| `toolcancel` | absent from bundle | declarative only | absent from bundle | not observed |
| duplicate name | throws `InvalidStateError` | throws `InvalidStateError` | throws `InvalidStateError` | throws `InvalidStateError` |
| duplicate silently replaces | no | no | no | no |
| `executeTool(tool, jsonString)` | **works** | **throws** `TypeError` | **throws** `TypeError` | **works** |
| `executeTool(tool, object)` | throws | **works** | **works** | throws |
| tool throws → | rejects `UnknownError` | rejects `UnknownError` | rejects `UnknownError` | rejects `UnknownError` |
| string return encoding | bare | JSON-quoted | JSON-quoted | bare |
| double `<script>` load breaks registration | no | no | no | n/a |

---

## 7. Test pages and driver created

All under `dev-webmcp/.tmp/polyfill-verify/` (gitignored — confirmed via
`git check-ignore`: `.gitignore:4:.tmp/`):

| Path | Purpose |
| --- | --- |
| `.tmp/polyfill-verify/driver.mjs` | puppeteer-core driver; 10 runs, fresh browser+page each |
| `.tmp/polyfill-verify/gen-pages.mjs` | generates the HTML pages |
| `.tmp/polyfill-verify/pages/battery.js` | shared measurement battery (annotations, schema, events, duplicate, executeTool, false/absent hints, abort) |
| `.tmp/polyfill-verify/pages/prehook.js` | console/error capture installed *before* the polyfill |
| `.tmp/polyfill-verify/pages/v5.html` | variant 1 |
| `.tmp/polyfill-verify/pages/v6.html` | variant 2 |
| `.tmp/polyfill-verify/pages/cg.html` | variant 3 |
| `.tmp/polyfill-verify/pages/native.html` | variant 4 (control) |
| `.tmp/polyfill-verify/pages/v5-double.html`, `v6-double.html`, `cg-double.html` | double `<script>` load |
| `.tmp/polyfill-verify/pages/double-mid.html` | register between the two loads; checks orphaning |
| `.tmp/polyfill-verify/vendor/v5/index.iife.js` | tested 5.1.0 bundle |
| `.tmp/polyfill-verify/vendor/v6/index.iife.js` | tested 6.0.0-beta bundle |
| `.tmp/polyfill-verify/vendor/cg/polyfill.js` | tested CG build |
| `.tmp/polyfill-verify/vendor/mcp-b-webmcp-polyfill-6.0.0-beta.20261001010549.tgz` | source tarball |
| `.tmp/polyfill-verify/cg-src/` | CG clone @ `6bf6c57b…` |
| `.tmp/polyfill-verify/results.json` | **all raw measurements**, every step, every variant |

---

## 8. Conclusion — claim by claim

### Claim A — *"`@mcp-b/webmcp-polyfill@5.1.0` silently DROPS `debugging` (and `consequentialHint`) when `getTools()` returns a tool."*
**CONFIRMED.** Measured in Chrome 151: `annotations` comes back as exactly
`{"readOnlyHint":true,"untrustedContentHint":true}`. `debugging` and `consequentialHint` are
absent. No warning or error is emitted (silent). The mechanism is exactly as the audit
describes: the shipped normalizer whitelists only `readOnlyHint`/`untrustedContentHint`.

### Claim B — *"…because its normalizer keeps only MCP-B's own hint names."*
**CONFIRMED.** `dist/schema.js` `toWebMcpAnnotations()` returns a two-key object literal; the
strings `debugging`/`consequentialHint` do not occur anywhere in the 5.1.0 dist.

### Claim C — *"`@mcp-b/webmcp-polyfill@6.0.0-beta.20261001010549` DOES preserve them."*
**CONFIRMED.** Both keys present with the sent values; all four hints round-trip, including
explicit `false`.

### Claim D — *"the official CG polyfill `webmachinelearning/webmcp-polyfill` … `dist/polyfill.js` … DOES preserve them."*
**CONFIRMED for preservation**, with a **REFUTED sub-claim about the artifact's location**:
* Preservation: CONFIRMED — all four keys present, verbatim JSON in §4.1.
* "`dist/polyfill.js` (fetchable from the repo)": **REFUTED** — the file is not committed;
  `raw.githubusercontent.com/.../main/dist/polyfill.js` → **404**, and there is no `dist/`
  directory in the repo tree. It is produced by `pnpm build` (`tsc && esbuild …`). I built it
  from commit `6bf6c57bbaf3d1173d7737cfb79572632d9b7871`; the official build is byte-identical
  (SHA-256 `78db902d…`) to a direct esbuild run of the repo's documented command.
* Additionally: the CG package is **unpublished on npm** (the npm name `webmcp-polyfill` belongs
  to another project), so it must be vendored.

### Claim E (implied) — *"pinning a fixed polyfill solves the `debugging` safety story."*
**REFUTED / INCOMPLETE.** Two facts break it:
1. **Native Chrome 151 (no polyfill) drops `debugging` and `consequentialHint` too** — same
   two-key result as 5.1.0. So the loss is not unique to MCP-B 5.1.0.
2. `src/mcp.js` installs the polyfill **only when no native implementation exists**
   (`nativeAtBoot = typeof document.modelContext === "object"`; `if (!nativeAtBoot) initializeWebMCPPolyfill()`).
   In every browser that has a built-in end-user agent — i.e. exactly the consumers the
   annotation is meant to filter for — the polyfill is **not installed**, and the native
   normalizer decides what survives. Changing the polyfill therefore does **not** restore
   `debugging` there.

   Caveat, stated honestly: our Chrome is 151 and an existing code comment in
   `harness/drive.mjs:61-63` claims `debugging` is "documented as available from Chrome 156".
   **Chrome 156+ was not testable here → the claim that 156+ native preserves `debugging` is
   UNCONFIRMED.** If that is true, native deployments on 156+ are fine and the polyfill choice
   only matters for non-native browsers (where there is no built-in agent to filter for).
   Either way, "switch polyfill" is not a general fix.

### Non-claim findings worth acting on

* **`executeTool` changed convention between 5.1.0 and 6.x.** 5.1.0 and native Chrome take a
  **JSON string**; 6.0.0-beta and the CG polyfill take an **input object** and throw
  `TypeError: inputObject must be an object` for a string. Our own harness
  (`harness/drive.mjs:80`, `harness/browser.mjs:178`, `harness/recheck-reports.mjs:165`) uses the
  string form. Our shipped `dist/devtools.js` does not call `executeTool`, so the CDN bundle
  itself is unaffected — but every in-page driver is.
* **Native `inputSchema` is a JSON string**, not an object. All three polyfills return an object.
* **`toolchange` carries no `toolName`** in any implementation — a listener cannot tell which
  tool changed.
* **`toolactivated` is native-only on the imperative path**; the polyfills wire it (and, in v6,
  `toolcancel`) only into declarative form submission. The CG polyfill has neither string.
* **No implementation silently replaces a duplicate** — all throw `InvalidStateError`.
* **Double-loading any of the three is safe** (context identity preserved, tools survive,
  registration keeps working).

---

## 9. Recommendation

**Pin `@mcp-b/webmcp-polyfill@6.0.0-beta.20261001010549` exactly** (npm tarball SHA-256
`86025e1e292c86d7e08b8b9f4b049d22b6d0a5f890e9cea03b29fbe0b9ad7bd7`; bundled `index.iife.js`
SHA-256 `67fb63464fb113846e5abfb95315f942eb52552cf2881cd5b46b1d988dc6a7dc`), if preserving
`debugging`/`consequentialHint` through `getTools()` is a requirement.

Why this one and not the alternatives:

* It **preserves all four annotations**, exactly as the audit says, including explicit `false`.
* It is a **published, installable npm package from the same package/author we already depend
  on** — a dependency-line change rather than a vendored build. The CG polyfill is
  **unpublished** (its npm name is squatted by another project) and would have to be vendored
  and rebuilt by us, pinned to commit `6bf6c57b…`.
* The CG polyfill is the better *standards* reference and behaves identically on every axis
  measured here; keep it as the **conformance cross-check**, not the shipped dependency,
  precisely because it is in-development and un-released.
* Do **not** stay on 5.1.0 if annotation fidelity matters — it drops both keys.

Conditions and caveats that must accompany that pin:

1. It is a **beta** (`dist-tag beta`; `latest` is still `5.1.0`). Pin the exact version, not a
   range, and record the tarball hash so an unreviewed beta bump cannot land silently.
2. **Update the harness call sites** (`harness/drive.mjs`, `harness/browser.mjs`,
   `harness/recheck-reports.mjs`) from `executeTool(tool, JSON.stringify(input))` to
   `executeTool(tool, input)`, and note the convention change for any downstream driver.
   String return values also become JSON-quoted (a raw string return `"x"` now arrives as
   `"\"x\""`), so `JSON.parse` expectations must be checked.
3. **Recognise what this does not fix:** in a browser with **native** WebMCP, `src/mcp.js`
   never installs the polyfill, and native Chrome 151 drops `debugging` too. If the safety
   story must hold on native browsers, it needs a different mechanism than relying on the
   `debugging` annotation surviving `getTools()` — or a decision to force the polyfill over a
   native implementation. That decision is out of scope here; flagging it as the real risk.

If annotation fidelity turns out **not** to be load-bearing (e.g. the built-in agent filters on
`readOnlyHint`/`untrustedContentHint` only, which is all native Chrome 151 exposes), then the
cheapest correct action is to **stay on 5.1.0** and stop advertising `debugging` as a guarantee
— which is already what `harness/drive.mjs` reports when it prints "dropped by this
implementation".
