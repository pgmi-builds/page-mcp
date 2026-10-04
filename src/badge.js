/**
 * The page-corner indicator.
 *
 * A silent tool provider that exposes DOM access, storage and
 * arbitrary JS execution to whatever agent is attached is a bad default. The
 * user of the page should be able to see that it is on, what it exposes, and
 * turn it off. Everything CDP-based shows "Chrome is being controlled by
 * automated test software"; this is the page-side equivalent.
 *
 * Deliberately tiny: a dot that expands to a panel on hover. Lives in a shadow
 * root so host CSS cannot reach it, and refuses pointer events except on the
 * dot itself so it can never block the app underneath.
 *
 * Styling goes through a constructable stylesheet, because inline styles are
 * blocked on any page with a `style-src` that lacks 'unsafe-inline' — which is
 * exactly the kind of page most likely to be running a dev tool (see
 * style.js for the measurements).
 *
 * The contents REPAINT on registry changes. Rendering once was wrong: an app
 * registers its own tools a moment after our script runs, so a frozen badge
 * advertised "13 tools" on a page that exposed 15.
 */
import { adopt } from "./style.js";

const CSS = `
.wrap {
  position: fixed; left: 10px; bottom: 10px; z-index: 2147483647;
  font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #ffd9a8; pointer-events: none;
}
.dot {
  pointer-events: auto; display: flex; align-items: center; gap: 6px;
  background: rgba(12,10,8,.86); border: 1px solid rgba(255,162,69,.45);
  border-radius: 999px; padding: 4px 9px; cursor: default; user-select: none;
}
.dot b { width: 7px; height: 7px; border-radius: 50%; background: #ffa245; flex: none; }
.dot u { text-decoration: none; color: #8a8478; }
.panel {
  display: none; margin-top: 6px; max-width: 340px; max-height: 46vh; overflow: auto;
  background: rgba(12,10,8,.94); border: 1px solid rgba(255,162,69,.35);
  border-radius: 8px; padding: 9px 11px; white-space: pre-wrap; word-break: break-word;
  pointer-events: auto;
}
.wrap:hover .panel, .wrap:focus-within .panel { display: block; }
.k { color: #8a8478; }
.t { color: #e9e3d6; }
`;

export function renderBadge(api, cfg) {
  const runtime = api.runtime();
  const mode = runtime.native ? "native WebMCP" : runtime.polyfilled ? "polyfill" : "unavailable";

  // Tools this package registered itself, so the badge can show the split:
  // "13 + 2" tells a reader that the app contributed two of them.
  const own = new Set(api.specs().map((t) => t.name));

  const host = document.createElement("div");
  host.setAttribute("data-page-mcp", "badge");
  const root = host.attachShadow({ mode: "open" });
  adopt(root, CSS);

  const dot = document.createElement("div");
  dot.className = "dot";
  dot.tabIndex = 0;
  dot.title = "page-mcp — hover for detail";
  const panel = document.createElement("div");
  panel.className = "panel";
  const wrap = document.createElement("div");
  wrap.className = "wrap";
  wrap.append(dot, panel);
  root.append(wrap);

  const paint = () => {
    const all = api.specs().map((t) => t.name);
    const extra = all.filter((n) => !own.has(n));
    const count = extra.length ? `${own.size} + ${extra.length}` : `${all.length}`;

    dot.innerHTML = `<b></b><span></span>`;
    dot.lastElementChild.textContent = `page-mcp · ${count} tools · ${mode}`;

    panel.textContent =
      `runtime   ${mode}\n` +
      `origin    ${location.origin}\n` +
      `tools (${all.length})\n` +
      all.map((n) => `  ${n}${own.has(n) ? "" : "   (app)"}`).join("\n") +
      `\n\nThis page exposes DOM + JS access to a\nconnected coding agent. Remove the script\ntag (or set data-badge="off") to stop it.`;
  };
  paint();

  // App tools appear after us, so repaint whenever the registry changes.
  api.subscribe?.(paint);

  const mount = () => document.body?.appendChild(host);
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount, { once: true });
}
