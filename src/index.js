/**
 * dev-webmcp — entry point.
 *
 * Drop one script tag into a page and the page's own JS engine starts hosting
 * a set of devtools tools on `document.modelContext`. Any agent that can reach
 * the page (a coding agent driving its own Chrome over CDP, the browser's
 * built-in agent, an extension) can then discover and call them. There is no
 * server, no LLM and no chat UI in here.
 *
 *   <script src="https://cdn.example/dev-webmcp.js"></script>
 *
 * Config via data attributes on the script tag:
 *   data-prefix="dev_"     tool name prefix (default "dev_")
 *   data-badge="off"       hide the page-corner indicator
 *   data-max-nodes="200"   default snapshot budget
 */
import { installCapture } from "./capture.js";
import { buildTools } from "./tools.js";
import { invoke, names, register, runtimeInfo, specs, subscribe } from "./mcp.js";
import { renderBadge } from "./badge.js";

const VERSION = "0.0.1";

// 1. Capture BEFORE anything else can log.
installCapture();

// 2. Config from our own script tag.
const self = document.currentScript;
const cfg = {
  prefix: self?.dataset?.prefix || "dev_",
  maxNodes: Number(self?.dataset?.maxNodes) || 200,
  snapshotAfterAction: self?.dataset?.snapshotAfterAction !== "off",
  badge: self?.dataset?.badge !== "off",
};

// 3. Register the surface.
const disposers = buildTools(cfg).map((tool) => register(tool));

// 4. Page-facing handle. Two jobs:
//    - let the host app register its OWN domain tools (the thing no external
//      agent can infer: reset_test_data, go_to_step_3, get_cart_total…)
//    - give the harness a direct call path that bypasses modelContext
const api = {
  version: VERSION,
  /** Register an app-specific tool. See README for the shape. */
  register: (def) => register(def),
  /** Call any registered tool directly (no modelContext round trip). */
  invoke,
  /** Specs of every tool this pack registered. */
  specs,
  /** Subscribe to registry changes (tools added/removed). Returns an unsubscribe. */
  subscribe,
  /** What runtime we landed on: native WebMCP, or the bundled polyfill. */
  runtime: runtimeInfo,
  dispose: () => disposers.forEach((d) => d()),
};
globalThis.devWebmcp = api;

if (cfg.badge) renderBadge(api, cfg);

console.debug(
  `[dev-webmcp] ${VERSION} ready — ${names().length} tools, ` +
  `runtime=${runtimeInfo().native ? "native" : runtimeInfo().polyfilled ? "polyfill" : "none"}`,
);

export default api;
