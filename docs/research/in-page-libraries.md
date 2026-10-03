# In-page / browser-resident developer-tool libraries

**Question.** Which browser-resident libraries can we embed, vendor, or copy into a **single
CDN-delivered JS file** that gives a coding agent dev/debug tools for a web UI (via WebMCP)? Target
tool surface (`docs/06-proposed-tool-surface.md`): `dev_network`, `dev_observe`/`dev_diff`, `dev_box`,
`dev_geometry_audit`, `dev_perf`, `dev_drag`, `dev_storage`, plus addressing/snapshot/console.

| Constraint | Meaning here |
|---|---|
| Delivery | plain `<script src>` (UMD/IIFE global) **or** small enough to bundle into our esbuild output. A bare `<script src>` of an ESM file does not execute. |
| License | **MIT / BSD / Apache-2.0 only.** MPL/GPL/AGPL/commercial flagged. ISC is permissive but off the allow-list. |
| Page | arbitrary third-party page, often strict CSP. |
| Verdict | exactly one of **VENDOR**, **COPY** (reimplement the idea), **IGNORE**. |

**Method (2026-10-03).** Sizes are bytes `curl` received from `cdn.jsdelivr.net` for the exact URL
shown; `gz` is `gzip -c` of those bytes (≈CDN gzip ±1%). Licenses/versions from
`registry.npmjs.org/<pkg>/latest`. CSP claims are **measured**: a local page under `default-src
'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'` (no
`unsafe-inline`/`unsafe-eval`) loaded each library and exercised its API in headless Chrome 151.

---

## 1. eruda — in-page devtools panel

- **Does:** one UMD file installing a draggable panel with **8 core panels** (Console, Elements,
  Network, Resources, Sources, Info, Snippets, Settings); monkey-patches `window.console` by default.
- **APIs to use/copy:** `eruda.init({container, tool[], useShadowDom})`, `eruda.get(name)`,
  `show/hide/destroy/add/remove`, `network.requests()/clear()`, `console.filter()/html()`,
  `elements.select(el)`, `resources.config.set()`; copyable logic in `src/Network/*` (XHR/fetch proxy +
  detail model), `src/Resources/{Storage,Cookie}.js`, `src/Elements/util.js` + bundled
  `luna-dom-viewer` (descends **open shadow roots**, never iframes), `eruda.util.evalCss`.
- **License/size/CDN:** MIT; `eruda@3.4.3/eruda.js` = 499,928 B raw / **150,961 B gz**;
  `https://cdn.jsdelivr.net/npm/eruda@3.4.3/eruda.js` → `window.eruda`, UMD, no build step.
- **CSP (measured):** `init()` + `get('console')` work under strict CSP (UI isolated in 2 shadow
  roots), **but** injected `<style>` elements were refused, so the panel is unstyled/invisible; no
  `nonce` support. The REPL uses `eval`/`new Function` → throws without `unsafe-eval`.
- **Verdict: COPY.** A human panel is not our product, and 151 KB gz + a `style-src 'unsafe-inline'`
  requirement is a bad trade for a tool that must run on arbitrary pages. Reimplement the small parts.

## 2. vConsole — mobile in-page console

- **Does:** UMD, 5 plugins — **Log** (always on) + System / Network / Element / Storage (default on).
  Network covers XHR, fetch, `sendBeacon`, **WebSocket**, resource timing (the cleanest per-transport
  set of the two); Element = self-contained VNode tree + `MutationObserver`.
- **APIs to use/copy:** `new VConsole({defaultPlugins, pluginOrder, target, onReady})`,
  `VConsole.instance`, `setOption`, `addPlugin/removePlugin`, `vConsole.network.add(item)`,
  `vConsole.log.*`; copyable `src/network/*.proxy.ts`, `src/log/log.model.ts`, `src/element/element.ts`.
- **License/size/CDN:** MIT (the shipped LICENSE defers third-party terms without enumerating them →
  bundled `core-js`/`@babel/runtime` terms **UNCONFIRMED**); `vconsole@3.15.1/dist/vconsole.min.js` =
  286,369 B raw / **78,433 B gz**; `https://cdn.jsdelivr.net/npm/vconsole@3.15.1/dist/vconsole.min.js`.
- **CSP (measured):** constructs and captures logs under strict CSP, but 7 injected style tags were
  refused → panel in DOM (`#__vconsole`) yet visually broken; its REPL `eval`s inside `try/catch`, so
  it **silently returns nothing**. No shadow-DOM support in the Element panel.
- **Verdict: COPY** (network proxies + log model). IGNORE as a drop-in: no Resources/Sources and the
  same `unsafe-inline` dependency.

## 3. rrweb — record, replay, DOM mutation stream

- **Does:** records `Meta` → `FullSnapshot` → `IncrementalSnapshot` (Mutation/Mouse/Scroll/Input/
  StyleSheetRule/Canvas/Drag/Selection…) plus plugins, and replays the stream.
- **APIs to use/copy:** `record({emit, maskAllInputs, blockClass, sampling, recordCanvas, plugins})` →
  stop fn; `record.addCustomEvent`, `record.takeFullSnapshot()`, `record.mirror`; `rrweb-snapshot`'s
  `snapshot()`, `rebuild()`, `serializeNodeWithId`, `createMirror` (the model for `dev_observe`/`dev_diff`).
- **Correction:** `getCssRulesString`/`absoluteFilePath` are **v1 names absent from
  rrweb-snapshot@2.1.7** (v2 uses `absoluteToDoc`), and `rebuild()` needs a
  `rebuildIntoSandboxedIframe()` document unless you pass `UNSAFE_allowUnprotectedRebuild`.
- **License/sizes/CDN:** MIT. `@rrweb/record@2.1.7` UMD min = 77,222 B / **23,689 B gz**, global
  `rrwebRecord`, self-contained — `…/@rrweb/record@2.1.7/dist/record.umd.min.cjs`; `rrweb@2.1.7/umd/
  rrweb.min.js` 265,815 / 82,890; `rrweb-snapshot` min 85,548 / 28,681; `@rrweb/replay` 197,834.
- **CSP (measured + upstream):** `record()` worked under strict CSP in my probe (Meta, FullSnapshot and
  Incremental events); canvas/cross-origin uses `Worker`/`blob:`. Open issues: #816/#423/#443/#1699.
- **Verdict: COPY.** A `MutationObserver` + compact serializer is a few hundred lines; 24–83 KB gz is
  justified only if we later promise full replay. Copy the event taxonomy and `mirror`.

## 4. axe-core — accessibility audit engine

- **Does:** ~100 rules against live DOM; `violations`/`passes`/`incomplete`/`inapplicable`, each node with `impact`, `help`, `helpUrl`, target selectors and `failureSummary`.
- **APIs to use/copy:** `axe.run(context, options)`; `axe.runPartial()`/`finishRun()` for iframe +
  shadow-DOM aggregation (untested: our probe set `frame-src 'none'`); `axe.commons.aria.getRole`,
  `axe.commons.text.accessibleText`, `axe.utils.getFlattenedTree` (all need `axe.setup(DomNode)`).
  Copy the **rule set** (contrast, label, target-size, aria-*) for a small `dev_a11y`.
- **License:** **MPL-2.0** — outside the allow-list (file-level copyleft: embedded portions stay MPL
  and the notice must travel; CDN-loading avoids redistribution). Third-party sections are MIT/ISC.
- **Size/CDN:** `axe-core@4.13.0/axe.min.js` = 580,491 B raw / **155,724 B gz**;
  `https://cdn.jsdelivr.net/npm/axe-core@4/axe.min.js` → `window.axe`, UMD; SRI hashes ship in
  `sri-history.json`.
- **CSP (measured + source audit):** `axe.run(document)` **works under strict CSP** without
  `unsafe-eval` (8 violations / 14 nodes on a trivial page). The 6 `new Function(` occurrences sit on
  opt-in paths (doT template compiler, typedarray polyfill, string-valued custom rules); page-level
  `<style>` injection is limited to a legacy `elementsFromPoint` polyfill. Real trap: `preload:true`
  (default) XHRs cross-origin stylesheets, so `connect-src 'self'` blocks it — pass `{preload:false}`.
- **Verdict: COPY.** License is the blocker, size the second. Port a rule subset (contrast via
  `getComputedStyle`, names/labels via `dom-accessibility-api`, target size via `getBoundingClientRect`).

## 5. dom-accessibility-api — accessible name, description, role

- **Does:** spec-faithful W3C **accname** + implicit ARIA role mapping + `isInaccessible`/`isDisabled`.
- **APIs (the whole index):** `computeAccessibleName(el, {getComputedStyle,
  computedStyleSupportsPseudoElements, hidden})`, `computeAccessibleDescription`, `getRole`,
  `isDisabled`, `isInaccessible`, `isSubtreeInaccessible` (`getLocalName` is deep-path only).
- **License/size/CDN:** MIT (`LICENSE.md`); `@0.7.1/+esm` = 15,221 B raw / **5,091 B gz**
  (`@0.5.16` 14,668 / 4,883); a self-bundled IIFE ≈15,600 / 5,087. CJS/ESM only, **no UMD** —
  `https://cdn.jsdelivr.net/npm/dom-accessibility-api@0.7/+esm`, or bundle it for a global.
- **CSP (measured):** imported and ran correctly under strict CSP; 0 eval/`new Function`/innerHTML.
- **Notes:** `computedStyleSupportsPseudoElements` defaults true in a real browser, so `::before`/
  `::after` counts; README reports WPT accname 153/159 in Chrome; gap: visibility that "reappears".
- **Verdict: VENDOR.** The clear win of the survey. Our hand-rolled `accessibleName`/`roleOf` in
  `src/snapshot.js` is wrong in ways an agent notices (same fixtures, measured side by side):

  | Fixture | dom-accessibility-api | our hand-roll |
  |---|---|---|
  | `<button aria-hidden="true">Hidden</button>` | name `""`, `isInaccessible` **true** | `"Hidden"` ✗ |
  | `<input type="submit" value="Go">` | `"Go"`, role `button` | `""` ✗ |
  | `<button><span aria-hidden="true">*</span> Delete</button>` | `"Delete"` | `"* Delete"` ✗ |
  | `<button style="visibility:hidden">` | name `""`, inaccessible **true** | `"VisHidden"` ✗ |
  | `<div role="img" aria-label="Chart">` | `"Chart"` / `img` | ✓ |
  | `<div role="checkbox" aria-label="Agree">` | `"Agree"` / `checkbox` | ✓ |
  | `<button style="opacity:0">` | accessible (correct: opacity ≠ hidden) | no signal |
  | `display:none` ancestor | inaccessible **true** (after layout flush) | no signal |

  Caveat: a call in the same task as `appendChild` returned `false` for the `display:none` case — compute names/visibility **after a layout flush** (root cause UNCONFIRMED).

## 6. @testing-library/dom — role/label/text queries

- **Does:** `getByRole`, `getByLabelText`, `getByText`, `getByTestId`, `queryAllBy*`, `within`,
  `configure`, `getRoles`, `logRoles`, `prettyDOM`. It imports `computeAccessibleName`/
  `computeAccessibleDescription` from `dom-accessibility-api`, but implicit roles come from
  `aria-query`'s `elementRoles` (**not** d-a-a's `getRole`) and it reimplements `isInaccessible`.
- **Options to copy:** `ByRoleOptions{name (string|RegExp|fn), description, hidden, level, checked,
  selected, pressed, expanded, queryFallbacks}`; `MatcherOptions{exact, trim, collapseWhitespace,
  normalizer}`; `configure({defaultHidden, testIdAttribute, ...})`.
- **License/size/CDN:** MIT; `dist/@testing-library/dom.umd.min.js` = 182,034 B raw / **36,471 B gz**
  (non-min 403,893 / 65,966); no `exports` map, so the bare CDN URL resolves to a 6,397 B CJS
  `dist/index.js` — name the UMD path (`…/@testing-library/dom@10.4.2/dist/…umd.min.js`).
- **CSP (measured):** `getByRole`/`getByLabelText` worked under strict CSP.
- **Verdict: COPY.** 36 KB gz buys mostly the accname we already vendor, plus a test-shaped API. Copy
  the semantics we need (role+name match, `{name, exact, hidden}`, label resolution) onto d-a-a.

## 7. web-vitals — Core Web Vitals probes

- **Does:** `onLCP`, `onCLS`, `onINP`, `onFCP`, `onTTFB` (v6 has **no `onFID`**); the attribution build
  adds `target`/`largestShiftTarget`/`interactionTarget`/`longestScript`/`totalScriptDuration`. Observers
  are `buffered` (a late-injected script sees load-time entries); `{reportAllChanges:true}` reports every
  change; no `onSoftNavigation()` — soft navs are `{reportSoftNavs:true}` on Chromium 151+.
- **Limits (README-verified):** INP needs a real interaction; CLS/FCP/LCP are not reported for pages
  loaded in the background; CLS/INP finalize on `visibilitychange → hidden`; all re-report after bfcache
  restore; **no iframe visibility, not even same-origin**. Probe: no callback fired within 1 s on a
  static page — `dev_perf` needs a `getEntriesByType` fallback or a flush-on-hide contract.
- **License/size/CDN:** Apache-2.0; `web-vitals@6.2.2/dist/web-vitals.iife.js` = 8,991 B raw /
  **3,339 B gz** (attribution 15,665 / 5,490); `https://cdn.jsdelivr.net/npm/web-vitals@6/dist/
  web-vitals.iife.js` → `window.webVitals` (verified). CSP: 0 eval/`new Function`/Worker/style injection.
- **Verdict: VENDOR** (3.3 KB gz, correct metrics) + COPY ~30 lines of long-task/LoAF
  `PerformanceObserver` (`longtask` and `long-animation-frame` are Chromium-only) for TBT/frame cost.

## 8. Perfume.js

- **Does:** FCP/LCP/CLS/TTFB/FID/INP plus TBT/NTBT, element timing, resource timing, navigator info,
  `start()/end()` marks. MIT; `perfume.umd.min.js` = 20,678 B raw / **7,087 B gz** (IIFE 20,488 / 7,019).
- **Global shape (measured):** `window.Perfume` is an **exports namespace, not a class** —
  `new Perfume()` throws `TypeError`; use `Perfume.initPerfume({analyticsTracker})`.
- **Decisive fact:** 9.4.0 declares `dependencies: {"web-vitals": "^3.5.0"}` — vendoring it beside
  web-vitals@6 ships two copies of the same engine, one two majors old. CSP scan clean.
- **Verdict: IGNORE.** web-vitals covers the CWV set at half the size; TBT is a short
  `PerformanceObserver`; its formula (`duration − 50` per `longtask` with `name === 'self'` after FCP)
  is the idea to copy.

## 9. In-page network capture

| Candidate | License / size | Verdict |
|---|---|---|
| `@mswjs/interceptors` 0.45.6 | MIT; `+esm` 19,664 / 7,614 B gz; **ESM-only, no UMD**, `engines.node>=22`, 1.8 MB unpacked | IGNORE — Node-first; browser preset is a thin barrel. |
| `fetch-intercept` 2.4.0 | MIT; `lib/browser.min.js` 1,547 / **726 B gz**, IIFE | Only if we want a 1.5 KB fetch-only shim; stale since 2021. |
| `xhook` 1.6.2 | MIT; 8,120 B IIFE | IGNORE — XHR-only, stale since 2023. |
| `ajax-hook` 3.0.3 | **no license declared** (`license: null`, no LICENSE in tarball) | IGNORE — licensing trap. |

- **COPY the pattern, not a dependency.** Observation-only capture is ~60 lines (wrap originals;
  record `{method, url, status, ms, initiator}`), and `src/network.js` already does fetch + XHR +
  `sendBeacon` with a ring buffer and call-site initiator. The libraries add response rewriting
  (`respondWith`) and WebSocket framing — not on our tool surface. rrweb's MIT network-record plugin
  (8,074 B) is the reference design if we ever need the full set: patch fetch/XHR for bodies+headers,
  use `PerformanceObserver`/`PerformanceResourceTiming` for the rest, and expose `transformRequestFn`
  so the tool never records its own upload. Cross-origin bodies/headers are opaque; resource timings
  need `Timing-Allow-Origin`.

## 10. DOM-to-text / readability / Markdown

- **@mozilla/readability 0.6.0** — Apache-2.0; `Readability.js` 89,980 B / **24,890 B gz** (classic
  script → global `Readability`), `Readability-readerable.js` 4,271 B (`isProbablyReaderable`).
  `new Readability(document.cloneNode(true), {charThreshold, classesToPreserve, serializer,
  keepClasses}).parse()` → `{title, content, textContent, excerpt, length, byline, siteName, lang}`;
  `parse()` **mutates** its input, so always clone (`serializer: el => el` returns a DOM node).
  **Verdict: COPY** — article scoring is rarely what a dev agent needs and our outline already yields
  text; VENDOR only if we add an explicit read-the-article tool.
- **turndown 7.2.4** — MIT; `lib/turndown.browser.umd.js` 26,946 B / **7,433 B gz**, global
  `TurndownService`; `new TurndownService(opts).turndown(nodeOrHtml)` → Markdown, plus
  `turndown-plugin-gfm` (4,191 / 1,414). **Verdict: VENDOR** — small, MIT, UMD, useful agent context.
- **html-to-text 10.0.1** (MIT, CJS/ESM-only, Node-oriented, 67,018 B), **textversionjs** (last publish
  2018), **@postlight/parser** (449 KB bundle, bundles moment+cheerio+jQuery, unmaintained). **IGNORE.**

## 11. Element addressing

- **@medv/finder 4.0.2** — MIT; ESM-only, `+esm` 3,816 B / **1,833 B gz**;
  `finder(el, {root, idName, className, tagName, attr, seedMinLength, optimizedMinLength, threshold})`
  → shortest unique CSS selector. **Verdict: VENDOR** (tiny, purpose-built, improves the `selector`
  our `dev_box`/snapshot emit; bundle it because it is ESM-only).
- **css-selector-generator 3.9.4** — MIT; `+esm` 11,233 / 4,628 B gz, richer options
  (`getCssSelector`, `getAllSelectors`, whitelists). **Verdict: COPY** its attribute/nth-child
  fallback strategy; finder is the smaller dependency to ship.
- **get-xpath 3.3.0** (MIT, 1,056 B UMD) and **unique-selector 0.5.0** (MIT): **IGNORE** — XPath is
  not our addressing model and finder supersedes unique-selector.

## 12. Keyboard / focus

- **tabbable 6.5.0** — MIT; `tabbable(root)`, `isTabbable`, `isFocusable`, `focusable(root)`; UMD
  `https://cdn.jsdelivr.net/npm/tabbable@6/dist/index.umd.min.js` = 6,502 B / **2,532 B gz**;
  **verified under strict CSP** (returned the page's real tab order `b,i`).
- **focus-trap 8.2.2** — MIT; UMD ~14,514 / 4,754 B gz (v7 measured). **Verdict: VENDOR tabbable**
  (2.5 KB for real tab order, needed by any keyboard/`dev_a11y` tool); **IGNORE focus-trap** (we never
  want to trap the user's focus).

## 13. DOM patch / diff

- **morphdom 2.7.8** (MIT; UMD 12,396 / 3,093 B gz) and **nanomorph 5.4.3** (MIT) patch a live DOM.
  **jsdiff `diff` 9.0.0** (BSD-3-Clause; UMD `diff@8` 30,499 / 8,224 B gz) offers `diffLines`,
  `diffWords`, `structuredPatch`, `createPatch`. **visual-dom-diff 0.7.3** (MIT, ESM `lib/diff.js`
  19,536 B, no dist) renders `<ins class="vdd-added">`/`<del class="vdd-removed">`.
- **Verdict: IGNORE all three.** We must not mutate the page under test, our `dev_diff` reports
  *structural* DOM deltas rather than text patches, and visual-dom-diff's output is for human eyes.
  jsdiff is the defensible vendor *if* we ever expose a unified text diff of two snapshots.

## 14. Screenshot / pixel diff

- **html2canvas 1.4.1** (MIT) 198,689 / 45,882 B gz; **dom-to-image-more 3.11.0** (MIT) 29,031 /
  10,063 B gz; **modern-screenshot 4.7.0** (MIT) `+esm` 26,696 B raw (gz UNCONFIRMED);
  **resemblejs 5.0.0** (MIT) 36,407 / 6,858 B gz; **pixelmatch 7.2.0** (**ISC**) 8,681 / 2,785 B gz.
- **Verdict: IGNORE all.** `docs/06` fixes the division of labour: pixels belong to CDP
  (`Page.captureScreenshot`) because the page has no reliable rasterization primitive and WebGL
  canvases read black outside rAF; image diffing belongs to the agent side.

## 15. CSS layout / overflow auditing

- **overflowlint 0.4.0** (MIT; `overflowlint.iife.js` 189,796 / **43,098 B gz** — bundles Preact; best
  rule set: document overflow, masked clipping, truncated text, covered controls, undersized targets;
  `OverflowLint.run({tolerance, max_findings})`). **layout-canary 0.2.1** (MIT; `scan.global.js`
  15,353 / 3,682 B gz). **isellipsis 3.0.3** (MIT; `index.global.js` 7,671 / 2,391 B gz, precise
  truncated-text test). **render-qa** (MIT, 10,778 B, baseline-free text overlap). **venn-dom** (MIT,
  666 B UMD, overlap only, stale 2018). GoogleChrome `floaty`/Lighthouse overlay: no verifiable
  published package (**UNCONFIRMED**).
- **Verdict: COPY.** `overflowlint`'s rule list is the specification, but 43 KB gz of Preact is not.
  The primitives are ~50 lines and `dev_geometry_audit` in `docs/06` already names them:
  `scrollWidth > clientWidth` / `scrollHeight > clientHeight`; `getComputedStyle(el).overflow`;
  `getBoundingClientRect()`; `Range.getClientRects()` for per-line boxes; `elementsFromPoint` for
  occlusion (not `elementFromPoint`); `IntersectionObserver`/`ResizeObserver` for re-checks. All
  read-only, no CSP interaction.

## 16. Forms, clipboard, drag

- **text-field-edit 4.1.1** — MIT; `index.js` 6,398 B / 1,940 B gz, **ESM-only**; `insert(field,text)`,
  `set`, `replace`, `wrap`, `getFieldSelection`. Uses `document.execCommand('insertText')`, so it
  preserves undo and fires a real `input`/`beforeinput` with `inputType` — unlike assigning
  `field.value`, which desyncs React/Vue state. **Verdict: VENDOR** (bundle the 6.4 KB; no UMD).
- **clipboard-polyfill 4.1.1** (MIT; ES5 window-var build 13,995 / 3,351 B gz) — its own README says
  you no longer need it. **Verdict: IGNORE** — `navigator.clipboard.writeText` is baseline (secure
  context + transient activation); a polyfill cannot supply the activation we lack.
- **Drag:** `DataTransfer` + `DragEvent` synthesis is ~15 lines, but every synthetic event is
  `isTrusted === false`, native drag machinery is not engaged, and pointer-listening libraries ignore
  `dragstart` entirely. **Verdict: COPY** the DOM/PointerEvent sequence for `dev_drag`; **IGNORE
  `@dnd-kit/core`** (MIT, React-only ESM) and **`interact.js`** (MIT, 98,203 B UMD) unless a demo
  proves we need real gesture replay.

## 17. Smaller candidates

- **@testing-library/user-event 14.6.7** (MIT; `+esm` 61,969 / 19,029 B gz) — **COPY** the realistic
  pointer+key+input ordering for `dev_drag`/typing; test-shaped, too big to ship.
- **aria-query 5.3.2** / **axobject-query 4.1.0** (Apache-2.0, CJS-only; `+esm` 14,989 / 9,088 B gz)
  — **IGNORE**; `dom-accessibility-api.getRole` already resolves implicit roles (verified).
- **loglevel** (MIT, 1.4 KB gz), **console-feed** (MIT, 15.4 KB gz, React), **chii** (MIT, needs a
  server), **dompurify** (MPL/Apache), **text-fragments-polyfill** (Apache, self-running IIFE):
  **IGNORE** — superseded by `src/capture.js`, wrong shape, or off-budget.

---

## Ranking by value to us

| # | Candidate | Verdict | Size (gz) | Reason |
|---|---|---|---|---|
| 1 | **dom-accessibility-api** | VENDOR | 5.1 KB | Fixes measured wrongness in accname/role; MIT; strict-CSP-safe. |
| 2 | **web-vitals** | VENDOR | 3.3 KB | `dev_perf` needs exactly LCP/CLS/INP/TTFB; Apache-2.0; IIFE. |
| 3 | **@medv/finder** | VENDOR | 1.8 KB | Stable selector for our refs (bundle; ESM-only). |
| 4 | **tabbable** | VENDOR | 2.5 KB | Real tab order for keyboard/a11y tooling; MIT UMD. |
| 5 | **turndown (+gfm)** | VENDOR | 8.8 KB | DOM→Markdown context; MIT UMD. |
| 6 | **text-field-edit** | VENDOR | 1.9 KB | Undo-safe field insertion (bundle; ESM-only). |
| 7 | eruda | COPY | 151 KB | Copy network/storage/shadow traversal; skip the unstylable panel. |
| 8 | rrweb (`@rrweb/record`) | COPY | 23.7 KB | Copy event taxonomy/mirror; vendor only for full replay. |
| 9 | @testing-library/dom | COPY | 36.5 KB | Copy role/name query semantics onto vendored accname. |
| 10 | axe-core | COPY | 155.7 KB | Rules valuable; MPL-2.0 + size are not. Port a subset. |
| 11 | vConsole | COPY | 78.4 KB | Copy per-transport network proxies + log model. |
| 12 | overflowlint / layout-canary / isellipsis | COPY | 43 / 3.7 / 2.4 KB | Spec for `dev_geometry_audit`; write the ~50 lines ourselves. |
| 13 | @mozilla/readability / @testing-library/user-event | COPY | 24.9 / 19.0 KB | Article scoring is rarely needed; user-event is the input-sequence reference. |
| 14 | css-selector-generator | COPY | 4.6 KB | Fallback-strategy ideas; finder ships instead. |
| 15 | fetch-intercept | IGNORE* | 0.7 KB | Stale; only the shape of a 1.5 KB fetch-only shim. |
| 16 | Perfume.js / @mswjs/interceptors | IGNORE | 7.1 / 7.6 KB | Redundant + namespace trap; Node-first ESM-only. |
| 17 | screenshot, pixel-diff, morphdom, jsdiff, visual-dom-diff | IGNORE | 2.8–45.9 KB | Pixels belong to CDP; never mutate the page. |
| 18 | §17 remainder + xhook, ajax-hook, html-to-text, textversionjs, @postlight/parser, get-xpath, unique-selector, focus-trap, @dnd-kit, interact.js | IGNORE | — | Superseded by in-repo code, wrong shape, or licence risk. |
\* Trivial vendor if we ever needed a fetch-only shim; not worth it while `src/network.js` exists.

**Bottom line.** The VENDOR set is **~23 KB gz** (dom-accessibility-api, web-vitals, finder, tabbable,
turndown, text-field-edit), all MIT/Apache-2.0, IIFE or bundle-able, each measured under a strict CSP.
Everything we COPY is an idea, not a dependency; eruda and axe-core lose on size *and* licence/CSP,
and rrweb loses only because `dev_diff` needs deltas, not replay.

---

## URLs actually fetched

**CDN artifacts** (all byte counts above come from these; prefix `https://cdn.jsdelivr.net/npm/`):
eruda/vconsole (`eruda@3.4.3/eruda.js`, `vconsole@3/dist/vconsole.min.js`); rrweb
(`@rrweb/record@2.1.7/dist/record.umd.min.cjs`, `rrweb@2.1.7/umd/rrweb.min.js`,
`rrweb-snapshot@2.1.7/umd/rrweb-snapshot.min.js`); `axe-core@4/axe.min.js`;
`dom-accessibility-api@0.7/+esm` and `@0.5.16/+esm`; `@testing-library/dom@10.4.2/dist/…umd.min.js`;
`web-vitals@{4,6}/dist/web-vitals.iife.js` (+ attribution); `perfume.js@9/dist/perfume.umd.min.js`;
`@mswjs/interceptors@0.45/+esm`; `fetch-intercept@2.4.0/lib/browser.min.js`;
`@mozilla/readability@0.6/Readability.js`; `turndown@7.2.4/lib/turndown.browser.umd.js`;
`html-to-text@9/lib/html-to-text.cjs`; `text-field-edit@4.1.1/index.js`; `@medv/finder@4/+esm`;
`css-selector-generator@3/+esm`; `get-xpath@3/index.umd.js`; `tabbable@6/dist/index.umd.min.js`;
`focus-trap@7/dist/focus-trap.umd.min.js`; `morphdom@2/dist/morphdom-umd.min.js`;
`diff@8/dist/diff.min.js`; `pixelmatch@6/index.js`; `resemblejs@5/resemble.js`;
`html2canvas@1/dist/html2canvas.min.js`; `dom-to-image-more@3/…min.js`; `modern-screenshot@4/+esm`;
`aria-query@5/+esm`; `axobject-query@4/+esm`; `@testing-library/user-event@14/+esm`;
`text-fragments-polyfill@6/dist/text-fragments.js`; `clipboard-polyfill@4/dist/es5/window-var/…es5.js`;
`loglevel@1/dist/loglevel.min.js`; `console-feed@3/+esm`; `overflowlint@0.4.0/dist/overflowlint.iife.js`;
`layout-canary@0.2.1/dist/scan.global.js`; `isellipsis@3.0.3/dist/index.global.js`;
`interactjs@1.10.28/dist/interact.min.js`.

**Metadata / docs:** `https://registry.npmjs.org/<pkg>/latest` (licence/version) and
`https://data.jsdelivr.com/v1/packages/npm/<pkg>@<ver>?structure=flat` (dist listings) for every package
above; READMEs at `https://raw.githubusercontent.com/` for `liriliri/eruda`, `Tencent/vConsole`,
`rrweb-io/rrweb` (incl. `docs/recipes/network.md`), `dequelabs/axe-core`, `eps1lon/dom-accessibility-api`,
`GoogleChrome/web-vitals`, `Zizzamia/perfume.js`, `testing-library/dom-testing-library`,
`antonmedv/finder`, `fczbkb/css-selector-generator`, `focus-trap/tabbable`, `mswjs/interceptors`,
`mozilla/readability`. Licence/CSP source checks were delegated to parallel researchers (axe `LICENSE`,
`LICENSE-3RD-PARTY.txt`, `doc/API.md`, `sri-history.json`; d-a-a `sources/*.ts` + `dist/*.d.ts`; rrweb
`packages/rrweb-snapshot/src/*`; issues #816/#423/#443/#1699) and cited inline above.

**UNCONFIRMED:** jsDelivr brotli/gzip quality (my `gz` is local `gzip -c`); vConsole's bundled
`core-js`/`@babel/runtime` terms; whether vConsole's webpack `nonce` hook is wireable in the prebuilt
UMD; the one-run `isInaccessible` flake in §5; modern-screenshot gz size (raw only); axe's cross-frame
`runPartial` path and whether a blocked cssom preload degrades or rejects a run.
