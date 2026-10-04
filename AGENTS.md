# dev-webmcp — workspace conventions

One CDN-delivered `<script>` that turns any web UI into a WebMCP tool provider
(`document.modelContext`): DOM/UI/devtools tools an external coding agent can
call. Positioning: not a bridge, not a spawn-a-browser — the agent already owns
Chrome and reaches the page realm via CDP `Runtime.evaluate`.

## Layout

```
src/        ES modules; esbuild bundles into ONE IIFE dist/devtools.js (~106 KB)
harness/    drive.mjs (56-test suite: native + polyfill + form pass),
            browser.mjs (CDP control: start|goto|eval|call|upload|stop),
            serve.mjs (static server, :8940), form-fixture.html
docs/       numbered evidence: reports from other agents are collected VERBATIM
            as docs/NN-*.md with a triage header; findings land in the ledger
            in docs/README.md; research/ is the first-hand evidence layer
dist/ demo/ .tmp/  build artifacts — gitignored, rebuildable
.agents/    agent skills (openspec, superpowers) — workspace-local, untracked
```

## Build / test loop

```bash
npm run build                                   # node build.mjs -> dist/devtools.js
PORT=8940 node serve.mjs &                      # serves repo root; demo at /demo/
DEMO_URL=http://127.0.0.1:8940/demo/ npm run drive   # expect 56/56; tool count native=24 polyfill=24
node harness/browser.mjs stop                   # ALWAYS stop before drive (port conflict)
```

- Deploy = `cp dist/devtools.js /home/u1/view-dir/2026-10-03_webmcp-devtools-demo/devtools.js`
  (served at `https://view.pc.randomhash.app/2026-10-03_webmcp-devtools-demo/`, `no-store`).
- **Stale-tab trap** (docs/07 §2): a tab opened before a deploy keeps the old
  bundle until reload. Reload and verify the loaded build, not the server file.
- Verify deploy with a FRESH `browser.mjs start <url>`; the badge renders in a
  shadow root — read `el.shadowRoot.textContent`, not the host's textContent.

## Conventions

- Reports from other agents are claims to adversarially verify, never trusted
  as-is; reproduce before fixing, then record triage (applied / refuted / declined).
- Commits are rationale-heavy: what broke, why the shape, what test pins it.
- Lesson ledger (docs/README.md conclusions) exists because each entry cost a
  debugging session — read conclusions 6–8 before debugging "nothing changed".
- `executeTool(tool, <JSON string>)` — the 2nd arg is a STRING on native and
  polyfill 5.1.0. Polyfill is pinned at 5.1.0 on purpose: 6.x changes the
  signature and breaks native + chrome-devtools-mcp interop.

## Environment facts (DSH sandbox)

- PATH resets between bash calls: use absolute paths or re-export.
- `~/.npm`, `~/.cache`, `~/.config` are read-only; redirect caches into the
  workspace (`.tools/` or `.tmp/`) if a tool needs them.
- System node 22 is sufficient for build/drive/publish here; node 24 tarball
  lives at `/home/u1/workspaces/browser-agent/.tools/node24/bin` if needed.
- Headless Chrome needs software GL for the demo's three.js:
  `--enable-unsafe-swiftshader --use-angle=swiftshader` (already in harness).

## Publish (pending decisions)

Route decided so far: npm publish → jsDelivr/unpkg mirror (registry-like,
immutable versions) unless overridden. Still needed before first publish:
npm account/token, package name + scope, start version (proposal: 0.1.0),
un-`private` package.json with a `files` whitelist (dist + README + LICENSE).
Old absolute path `~/workspaces/browser-agent/dev-webmcp` is dead — the repo
now lives at `~/workspaces/dev-webmcp` (historical docs keep the old path on
purpose: they are verbatim records).
