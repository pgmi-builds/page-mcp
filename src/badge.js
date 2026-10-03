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
 */

const CSS = `
:host { all: initial; }
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
}
.wrap:hover .panel { display: block; }
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
  root.innerHTML = `
<style>${CSS}</style>
<div class="wrap">
  <div class="dot"><b></b>dev-webmcp · ${tools.length} tools · ${mode}</div>
  <div class="panel">${escapeHtml(
    `<span class="k">runtime</span>  ${mode}\n` +
    `<span class="k">origin</span>   ${location.origin}\n` +
    `<span class="k">tools</span>\n` +
    tools.map((t) => `  <span class="t">${t.name}</span>`).join("\n") +
    `\n\n<span class="k">This page exposes DOM + JS access to a\nconnected coding agent. Remove the script\n(or set data-badge="off") to stop it.</span>`,
  )}</div>
</div>`;

  const mount = () => document.body?.appendChild(host);
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount, { once: true });
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
}
