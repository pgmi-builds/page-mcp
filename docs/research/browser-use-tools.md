# Browser Use — exact tool/action surface inventory

**Repo:** https://github.com/browser-use/browser-use
**Commit inspected:** `7be96ed8bafa8dfe1eef228b59cf5c884b8b2431` (main, author date **2026-10-02T17:06:05-07:00**, commit subject "Update the Cloud signup credit in the skill reference to $1 (#5982)")
**Version:** `pyproject.toml` → `version = "0.13.10"`
**Retrieved:** 2026-10-03 (shallow `git clone --depth 1`)
**Method:** read the checked-out source tree; raw URLs pinned to the commit above. Docs/skills were used only as cross-checks (they lag the code — see §6).

Classification key:
- **HOST** — fundamentally needs host-side browser/filesystem (CDP, local disk, tab lifecycle, LLM call from host).
- **PAGE** — could be implemented from inside the page (often *more* precisely there).
- **BOTH** — needs page work plus host support (trusted input, load-awaiting, index→node resolution).

---

## 1. How actions become LLM tool names (evidence)

- `browser_use/tools/registry/service.py:291-325` — `Registry.action(description, param_model, domains/allowed_domains, terminates_sequence)` builds a `RegisteredAction` and stores it under **`name=func.__name__`**. So the LLM-facing action name is exactly the Python function name.
- `browser_use/tools/registry/service.py` — `create_action_model()` makes a `Union` of per-action models (one field each); `browser_use/agent/service.py:780-800` `_setup_action_models()` wires it into `AgentOutput`. Names surface as JSON-schema property names.
- Action descriptions and param descriptions come from `description=` at the decorator and the pydantic `Field(description=...)` in `browser_use/tools/views.py`.
- **Gotcha:** `search`, `navigate`, `upload_file`, `send_keys`, `dropdown_options` are registered with an **empty description `''`**; their usage guidance lives only in the system prompt (`browser_use/agent/system_prompts/system_prompt.md:165`).

## 2. Default LLM action surface — 24 actions (`browser_use/tools/service.py`, `Tools.__init__` L442→2160)

| # | Name | Semantics (one line) | Key parameters | Class |
|---|------|----------------------|----------------|-------|
| 1 | `search` | Build a search-engine results URL and navigate to it (terminates sequence) | `query`; `engine='duckduckgo'` (also google, bing) | BOTH |
| 2 | `navigate` | Navigate current/new tab to a URL (terminates sequence) | `url`; `new_tab=False` | BOTH |
| 3 | `go_back` | Browser history back (terminates sequence) | — (`NoParamsAction`) | PAGE |
| 4 | `wait` | Sleep N seconds | `seconds: int = 3` | PAGE |
| 5 | `click` | Click an indexed element, or at viewport coordinates when coordinate clicking is enabled | `index` (≥1) **xor** `coordinate_x`+`coordinate_y`; two variants via `ClickElementAction` / `ClickElementActionIndexOnly` | BOTH |
| 6 | `input` | Type text into element by index; clears by default | `index` (≥0); `text`; `clear=True` | BOTH |
| 7 | `upload_file` | Attach a local file to a file input | `index`; `path` (must be in `available_file_paths` unless remote) | HOST |
| 8 | `switch` | Switch active tab by 4-char tab id (terminates sequence) | `tab_id` (len 4) | HOST |
| 9 | `close` | Close tab by 4-char tab id | `tab_id` (len 4) | HOST |
| 10 | `extract` | LLM extraction of structured data from page markdown | `query`; `extract_links`; `extract_images`; `start_from_char`; `output_schema` (JSON Schema); `already_collected` | HOST |
| 11 | `search_page` | Regex/literal grep over page text, zero LLM cost | `pattern`; `regex`; `case_sensitive`; `context_chars=150`; `css_scope`; `max_results=25` | PAGE |
| 12 | `find_elements` | CSS-selector DOM query returning tag/text/attrs | `selector`; `attributes`; `max_results=50`; `include_text=True` | PAGE |
| 13 | `scroll` | Scroll by pages, optionally inside an indexed element | `down=True`; `pages=1.0`; `index` | BOTH |
| 14 | `send_keys` | Send keys/shortcuts to the page (Escape, Enter, Control+o) | `keys` | BOTH |
| 15 | `find_text` | Scroll to (find) a text string in the page | `text` | PAGE |
| 16 | `screenshot` | Capture viewport (or save to file); else rides the next observation | `file_name=None` | HOST |
| 17 | `save_as_pdf` | CDP print-to-PDF of the page | `file_name`, `print_background=True`, `landscape=False`, `scale=1.0` (0.1–2.0), `paper_format='Letter'`, `display_header_footer=True`, `header_template`, `footer_template` | HOST |
| 18 | `dropdown_options` | Enumerate options of a `<select>` by index | `index` | PAGE |
| 19 | `select_dropdown` | Select `<select>` option by exact text/value | `index`; `text` | PAGE |
| 20 | `write_file` | Write/append a file in the agent workspace (md/json/csv/html/pdf/docx, small images base64) | `file_name`; `content`; `append=False` | HOST |
| 21 | `replace_file` | Search/replace text inside a workspace file | `file_name`; `old_str`; `new_str` | HOST |
| 22 | `read_file` | Read a tracked/available file (text, pdf, docx, images) | `file_name`; injected `available_file_paths`, `file_system` | HOST |
| 23 | `evaluate` | Execute arbitrary browser JS (IIFE recommended) in the page (terminates sequence) | `code` | PAGE |
| 24 | `done` | Terminate and report; schema-swapped to structured output when `output_model` is set | `text`; `success=True`; `files_to_display` — or `StructuredOutputAction{success, data, files_to_display}` | BOTH |

Notes:
- `click` is (re)registered by `Tools._register_click_action()` (`service.py:2120-2150`, invoked at `service.py:772`); coordinate clicking is off unless `set_coordinate_clicking(True)` (auto-enabled for claude-sonnet-4-5 / claude-opus-4-5, `browser_use/agent/service.py:333`).
- `search`, `navigate`, `go_back`, `switch`, `evaluate` are `terminates_sequence=True` (later chained actions are dropped by the runtime).
- Injectables (not LLM params): `browser_session: BrowserSession`, `file_system: FileSystem`, `available_file_paths: list[str]`.

## 3. Actions added at runtime (surface is not closed)

- **Skills → actions:** `browser_use/agent/service.py:845-905` registers each loaded skill as its own action named by the skill **slug**, description `"<skill.description> (Skill: \"<title>\")"`, params from the skill's pydantic model.
- **External MCP servers → actions:** `browser_use/mcp/client.py:236` `action_name = f'{prefix}{tool_name}'`; each remote MCP tool is re-registered as a Browser Use action (this is how third-party tools enter the same registry).
- **Integrations:** `browser_use/integrations/gmail/actions.py:47-51` registers `get_recent_emails`.
- **Filtering:** `Tools(exclude_actions=[...])` / `exclude_action()`; `allowed_domains`/`domains` gate visibility per page URL (`registry.create_action_model(page_url=...)`, prompt section `<page_specific_actions>`).

## 4. MCP server it ships

Yes — in-tree at `browser_use/mcp/server.py`, launched by `uvx browser-use --mcp` / `python -m browser_use.mcp` (docstring `server.py:1-25`; `browser_use/mcp/__main__.py`; `pyproject.toml` script `browser-use = browser_use.cli:main`). It is the same repo, not a separate package.

`tools/list` (`browser_use/mcp/server.py` L210→460) declares **16 tools**; dispatch in `_execute_tool` (L500+):

| # | MCP tool name | Schema highlights | Class |
|---|---------------|-------------------|-------|
| 1 | `retry_with_browser_use_agent` | `task`; `max_steps=100`; `model`; `allowed_domains`; `use_vision=True` | HOST |
| 2 | `browser_navigate` | `url`; `new_tab=False` | BOTH |
| 3 | `browser_click` | `index` or `coordinate_x`+`coordinate_y`; `new_tab=False` | BOTH |
| 4 | `browser_type` | `index`; `text` (required) | BOTH |
| 5 | `browser_get_state` | `include_screenshot=False`; `readOnlyHint` | BOTH |
| 6 | `browser_extract_content` | `query`; `extract_links=False` | HOST |
| 7 | `browser_get_html` | `selector` (optional); `readOnlyHint` | PAGE |
| 8 | `browser_screenshot` | `full_page=False`; `readOnlyHint` | HOST |
| 9 | `browser_scroll` | `direction` enum up/down, default down | PAGE |
| 10 | `browser_go_back` | `{}` | PAGE |
| 11 | `browser_list_tabs` | `{}`; `readOnlyHint` | HOST |
| 12 | `browser_switch_tab` | `tab_id` | HOST |
| 13 | `browser_close_tab` | `tab_id` | HOST |
| 14 | `browser_list_sessions` | `{}`; `readOnlyHint` | HOST |
| 15 | `browser_close_session` | `session_id` | HOST |
| 16 | `browser_close_all` | `{}` | HOST |

- `browser_close` exists only as a **commented-out** stub (`server.py` ~L383-390). No `resources`, no `prompts` (handlers return empty).
- `browser_use/mcp/manifest.json` is a **stale DXT packaging manifest** (v0.5.0): it advertises only **11** tools with different prose (e.g. `browser_switch_tab` described as index-based, `browser_scroll` "by one viewport height"). Treat `server.py` as authoritative.
- The MCP server's tool set is a *subset* of the agent action set: no `evaluate`, `search_page`, `find_elements`, `input`-clear flag, dropdown tools, file tools, or `done`.

## 5. Evidence paths / URLs

Pinned to `7be96ed8bafa8dfe1eef228b59cf5c884b8b2431`; swap the SHA for `main` at https://raw.githubusercontent.com/browser-use/browser-use/main/...

- Action registry + all 24 registrations: `browser_use/tools/service.py`
  https://raw.githubusercontent.com/browser-use/browser-use/7be96ed8bafa8dfe1eef228b59cf5c884b8b2431/browser_use/tools/service.py
- Param models: `browser_use/tools/views.py`
  https://raw.githubusercontent.com/browser-use/browser-use/7be96ed8bafa8dfe1eef228b59cf5c884b8b2431/browser_use/tools/views.py
- Naming + action-model creation: `browser_use/tools/registry/service.py` (L291-325, `create_action_model`, `get_prompt_description`)
  https://raw.githubusercontent.com/browser-use/browser-use/7be96ed8bafa8dfe1eef228b59cf5c884b8b2431/browser_use/tools/registry/service.py
- Agent wiring of action models: `browser_use/agent/service.py` (L780-800; skills L845-905; coordinate click L333)
- System prompt template: `browser_use/agent/system_prompts/system_prompt.md` (+ `system_prompt_flash.md`, `system_prompt_no_thinking.md`, anthropic variants); rendered by `browser_use/agent/prompts.py`
- MCP server: `browser_use/mcp/server.py`; `browser_use/mcp/__main__.py`; manifest `browser_use/mcp/manifest.json`; client `browser_use/mcp/client.py`; controller `browser_use/mcp/controller.py`
- Integrations example: `browser_use/integrations/gmail/actions.py`
- Cross-check (docs, partially stale): `skills/open-source/references/tools.md` — omits `search_page`, `find_elements`, `save_as_pdf`

## 6. What a page-resident tool cannot do vs. can do better

**Only Browser Use / a host-side agent can do (HOST):**
- Cross-origin navigation control and multi-tab lifecycle (`switch`, `close`, `browser_list_tabs`); a page script is confined to its own origin and one document.
- `screenshot` / `save_as_pdf`: a document cannot rasterize itself; CDP `Page.captureScreenshot` / `Page.printToPDF` (full-page, paper formats, margins, header/footer templates).
- Local filesystem: `read_file`, `write_file`, `replace_file`, `upload_file` (real disk paths, `available_file_paths` allow-list, remote-vs-local path rewriting).
- LLM-backed `extract` (and `done`'s structured-output swap): the model call, token budget, and `already_collected` dedupe live host-side.
- `evaluate`'s *delivery* channel and CSP/Trusted-Types bypass: injection and result return happen over CDP; an in-page script is subject to the page's own CSP.
- Trusted input semantics: CDP `Input.*` events are `isTrusted=true`; in-page `dispatchEvent` is not (matters for some frameworks/analytics/native browser shortcuts).
- Browser state extraction (indexed DOM snapshot, `llm_representation`, highlight overlays) — this is a host-side DOM serializer (`browser_use/dom/`), not something the page can do for *another* tab.

**A page-resident tool could do more precisely / cheaply (PAGE):**
- `evaluate` is *native*: no round-trip, direct access to live JS objects, closures, framework internals (React fiber, Vue instances), module registry — far beyond a string-eval-over-CDP boundary.
- `search_page`, `find_elements`, `dropdown_options`, `select_dropdown`, `find_text`: zero IPC latency, exact live DOM/Shadow DOM/`getComputedStyle`/`getBoundingClientRect` truth instead of a stale server-side snapshot; can read state the host serializer drops.
- `input`: use the native value setter + proper `input`/`change`/`beforeinput` sequence for React/Vue controlled fields, and read back validation state, instead of blind trusted keystrokes.
- `click`: hit-test against the real element (including shadow roots and iframes) and observe the resulting handler synchronously; `scroll` can use precise `scrollIntoView({block:'center'})` and detect lazy-load/virtualized completion.
- `wait`: wait on actual conditions (network idle, specific element/mutation via `MutationObserver`, framework render-complete) rather than a fixed sleep.
- Debug-grade extras BU lacks at the action layer: console/error ring buffer, `performance`/long-task timing, network waterfall from `PerformanceObserver`, React/Vue component tree, storage/cookie inspection — all reachable in-page, none of which BU exposes as named actions.

**Where BU's design is already the right shape to copy:** the flat, verb-first, snake_case naming; pydantic-described params; `terminates_sequence` semantics (which actions invalidate the rest of a chain); index-then-coordinate fallback for clicking; and the "page-filtered actions" idea (per-URL action visibility) which maps naturally onto a per-route WebMCP tool provider.

## 7. UNCONFIRMED

- **UNCONFIRMED:** exact date of the `main` ref *as of this writing*; only commit `7be96ed8...` (2026-10-02) was inspected. `main` may have moved.
- **UNCONFIRMED:** the runtime `Tools` instance's action count at execution time — `exclude_actions`, skill slugs, and attached MCP tools change it per agent instance; 24 is the static default set.
- **UNCONFIRMED:** whether any Browser Use Cloud/desktop product exposes a *different* action surface than this OSS repo (not inspected; out of repo scope).
- **UNCONFIRMED:** `manifest.json`'s 11-tool list vs `server.py`'s 16: which is authoritative for published DXT bundles is not determinable from source alone (no generator script was found).
- **UNCONFIRMED:** `browser_use/beta/service.py` (6.8k lines) was only spot-checked; it constructs the same `Tools(exclude_actions=...)` registry (`beta/service.py:4118`) so no extra default actions are expected, but a full audit was not performed.
