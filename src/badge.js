/**
 * The page-corner indicator.
 *
 * A headless tool provider that silently exposes DOM access, storage and
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
  const tools = api.specs();

  const host = document.createElement("div");
  host.setAttribute("data-dev-webmcp", "badge");
  const root = host.attachShadow({ mode: "open" });
  adopt(root, CSS);

  root.innerHTML = `
<div class="wrap">
  <div class="dot" tabindex="0" title="dev-webmcp — hover for detail"><b></b>dev-webmcp · ${tools.length} tools · ${esc(mode)}</div>
  <div class="panel">${esc(
    `runtime   ${mode}\n` +
    `origin    ${location.origin}\n` +
    `tools\n` +
    tools.map((t) => `  ${t.name}`).join("\n") +
    `\n\nThis page exposes DOM + JS access to a\nconnected coding agent. Remove the script\ntag (or set data-badge="off") to stop it.`,
  )}</div>
</div>`;

  const mount = () => document.body?.appendChild(host);
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount, { once: true });
}

function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
}
