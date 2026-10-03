# Agent-as-User: WebMCP DevTools Demo — 2026-10-03

Fresh-eyes pass. I did not read the tool source; everything below is from calling the
24-tool WebMCP surface on the VITRINE page (headless Chrome, CDP 9222) via
`node harness/browser.mjs <cmd>`. All six tasks completed.

> **Triage (same session, committed after this report):** the report is verbatim.
> What was done with its findings —
> · `dev_find` now matches tag and role ("button" works) and the zero-match message names what a query can be (DOCS).
> · `dev_drag`'s first-interaction note reworded: the gate is timing-dependent, not guaranteed (BUG-low).
> · `dev_eval` documents that statement+trailing-expression returns undefined (NIT).
> · audit names the axis ("of width") and no longer double-reports a zero-size element as clipped text (NITs).
> · `dev_changes` lists what an added subtree contained (`+2: b, i`) (NIT).
> · `dev_perf` flags an LCP that fired late, so 243s stops reading as a load time (DOCS).
> · Declined: pixel verification stays with CDP (docs/08 §1.4); per-child change records stay collapsed (top-node record + child summary + snapshot covers it).
`node harness/browser.mjs <cmd>`. All six tasks completed.

## 1. What I did, in order (actual calls, trimmed)

1. **Orient.** `dev_snapshot {}` → title, viewport 780x437, 3 buttons (PROJECT MODEL;
   SHADER·HOLO disabled; RESET disabled). Canvas page ⇒ outline nearly empty, as its own
   description predicts. I then tried `dev_find {"query":"button"}` → **0 matches**
   ("No element matching…canvas/WebGL page may have no text"), then
   `dev_find {"query":"PROJECT"}` → 3 matches incl. hint text "DRAG ORBIT · SCROLL ZOOM…" .
   Snapshot was the right size of answer for this small page; find's role-word miss is noted below.
2. **Rotate + confirm.** `vitrine_state {}` baseline camera `[3.397, 2.9, 7.233]`.
   `dev_drag {"from":"canvas","dx":160,"dy":20,"steps":14}` → camera `[-7.47, 4.639, 0.922]` — moved.
   `dev_drag {"from":"canvas","dy":-120,"dx":-200}` → camera `[1.83, 2.674, 7.81]` — moved again.
   Confirmed via vitrine_state, not the tool's success string.
3. **Upload without filesystem-in-page.** `node -e` base64'd `fixtures/triangle.glb` (624 B → 832 b64 chars),
   `dev_upload {"files":[{"name":"triangle.glb","base64":"…","type":"model/gltf-binary"}]}` →
   "Attached triangle.glb (624 bytes)… fired input+change". `vitrine_state {}`: exhibit
   `placeholder · cube` → `triangle.glb`, triangles 12 → 1, `revealing:true`, SHADER/RESET now enabled.
4. **Defects.** Got token: `dev_changes {"limit":5}` → `since: 117`. `dev_eval {"code":"…append img[src=/nope.png], 0x0 button#qa-zero-btn, div#qa-clip (120x90, overflow:hidden, long text)…"}`.
   `dev_changes {"since":117}` → 1 ordered record: `added div#qa-broken` (children collapsed into the parent's text).
   `dev_geometry_audit {}` → 43 elements scanned: broken-image 1 (`img#qa-broken-img` src /nope.png);
   clipped-text 2 (`button#qa-zero-btn` "needs 26px in 0px"; `div#qa-clip` "needs 144px in 120px");
   zero-size 1 (`button#qa-zero-btn` "interactive but 0x0"). Cross-check `dev_find {"query":"zero"}` → e7.
5. **Verify.** ONE `dev_assert` call, 5 checks → all passed: exists `img#qa-broken-img`;
   text `#stExhibit` contains "triangle"; count `button` ≥3 (got 4); missing `input[type=password]`;
   visible `canvas`.
6. **Measure.** `dev_perf {"frames":24}` → FCP 244ms; **LCP 243836ms**; long tasks 201 / 57160ms total /
   worst 2860ms; CLS 0.0123; DCL 1236ms; 21 resources / 422.7KB; heap 11/4192MB;
   frame sample 24 frames, **avgFps 4.1**, worstGapMs 266.7.

## 2. The 9 newer tools — one honest sentence each

- **dev_find** — description does say substring over name/text/value/placeholder/aria/title, but I still
  tried "button" (role-word) first and got a bare zero-match, so pre-call I expected role matching; once
  fed real text it returned exactly the live refs I needed.
- **dev_box** — I did not use it because dev_geometry_audit already gave me rects, hit-test state and
  defect classification for the injected elements, and I had no element-scoped screenshot to aim.
- **dev_geometry_audit** — description promised box-tree-provable defects and the output found all three
  planted defects with refs and numbers; only gripe is the clipped-text figure ("needs 144px in 120px" for a
  120x90 box) doesn't say which axis/measure it is.
- **dev_drag** — description told me everything before I called (selector is the way to reach a canvas,
  dx/dy from centre, interpolated moves, synthetic isTrusted, and even a note about first-interaction-gating
  apps), and I confirmed the effect through vitrine_state rather than its success message as instructed.
- **dev_storage** — I did not use it because the app exposes vitrine_state as a better source of truth and
  no task needed cookies/localStorage/IndexedDB.
- **dev_changes** — the before-token / `since:` flow worked exactly as described and gave a timestamped
  ordered delta, but one appendChild collapses the whole subtree into a single `added div#qa-broken` entry,
  so "ordered" is per top-level node, not per element.
- **dev_assert** — description's five check kinds mapped 1:1 to what I wanted and one call returned a
  per-check ok-list that reads as evidence, exactly as promised.
- **dev_perf** — delivered everything the description promised, but both headline numbers need environment
  context the tool can't know: LCP tracked a late paint after my upload (243.8s reads absurd as "load")
  and avgFps 4.1 is SwiftShader software rendering, not page quality.
- **dev_network** — I did not use it because my only data path was an in-page base64 → file-input attach
  (no HTTP request involved) and nothing else silently failed.

## 3. Findings

- **BUG (low)** — Documented intro gating ("first pointerdown swallowed; a first drag does nothing") did
  not reproduce: my very first `dev_drag` rotated the camera immediately (3.397,2.9,7.233 → -7.47,4.639,0.922).
  Either the gate is gone or synthetic pointer events bypass it; the app-facing contract and the tool's own
  hint disagree with observed behavior.
- **DOCS** — `dev_find`'s `query` invites role-words: `"button"` matches nothing (buttons named PROJECT
  MODEL/RESET exist). The description does say text-substring, but a role match (or an error hint "try
  include_hidden / try the accessible name") would have saved the round trip.
- **NIT** — `dev_geometry_audit` clipped-text prints "needs 144px in 120px" for a box declared 120w x 90h;
  output alone doesn't say it's measuring the text's height against the 120px width, and the 90px I set
  never appears.
- **NIT** — the zero-size button is double-reported (once as clipped-text "26px in 0px", once as zero-size).
- **NIT** — `dev_eval` with statement-then-trailing-expression returned `→ undefined`; only pure expressions
  return a value, which the description doesn't spell out.
- **NIT** — `dev_changes`' snapshot-exclusion claim is good, but subtree adds could list children
  (ref-less) so an agent can see *what* was appended without a follow-up snapshot.
- **DOCS** — `dev_perf`'s LCP is presented as a load metric but kept growing through later paints (243.8s,
  after my GLB upload); a one-line "LCP may update on late large paints" caveat would prevent misreading.
- **MISSING (minor)** — nothing in the surface verifies pixels: geometry_audit explicitly excludes
  contrast/paint-order, dev_box only supplies numbers for the CDP layer to rasterize. A canvas/WebGL page
  has no DOM to assert against, so scene-level truth had to come from the app's own vitrine_state — fine
  here, but a generic page would leave "did it actually change visually" unanswerable.

## 4. Environment note on the perf numbers

Headless Chrome with software rendering (SwiftShader): avgFps 4.1 with a 266.7ms worst gap measures the
rasterizer, not the scene (1 draw call, 1 triangle at sample time). 201 long tasks / 57.2s total are
likewise dominated by software GL and my own injected evals. FCP 244ms, CLS 0.0123, 422.7KB over 21
requests are the only numbers meaningful as-is; treat every frame-rate figure here as "environment is
slow", and re-measure on GPU before judging the page.

Nothing was fixed, no file other than this report was edited, nothing committed.
