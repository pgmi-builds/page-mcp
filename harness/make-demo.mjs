/**
 * Generate demo/index.html from the source app.
 *
 * The demo host is a real, non-trivial page — a three.js WebGL viewer with a
 * HUD, a drag-drop target and animated post-processing. It is a deliberately
 * hard case for a DOM-only tool surface: the page is a canvas, so a snapshot
 * shows three buttons and nothing else.
 *
 * Two injections:
 *   1. our script tag in <head> — a classic script, so it runs before the
 *      page's module script is even evaluated
 *   2. an app-tool block at the end of that module — module bindings are
 *      unreachable from `eval`, so the app has to expose them itself. This is
 *      the "app registers its own domain tools" half of the design.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const SRC = process.env.SRC ?? "/home/u1/view-dir/2022-09-23_3D-model/three-js_cube_copy.html";
const BUNDLE = process.env.BUNDLE_SRC ?? "/dist/devtools.js";
const OUT = process.env.OUT ?? resolve(root, "demo/index.html");

let html = readFileSync(SRC, "utf8");

const scriptTag = `<!-- dev-webmcp: registers devtools tools on document.modelContext -->
<script src="${BUNDLE}" data-prefix="dev_" data-badge="on"></script>
`;

if (!html.includes("dev-webmcp: registers")) {
  html = html.replace("</head>", scriptTag + "</head>");
}

const appTools = `
/* ================= dev-webmcp: application-specific tools =================
   Everything in this module is module-scoped, so it is invisible to both a DOM
   snapshot AND to eval — the page renders into a WebGL canvas. Registering
   domain tools is how the application tells an agent what it actually is. */
window.devWebmcp?.register({
  name: 'vitrine_state',
  title: 'Vitrine viewer state',
  description:
    'Read the live state of the 3D viewer: exhibit name, triangle count, materialize progress, shader ' +
    'mode, hover state, camera position/target and renderer stats. None of this is visible in the DOM.',
  annotations: { readOnlyHint: true },
  inputSchema: { type: 'object', properties: {} },
  run: () => JSON.stringify({
    exhibit: user ? user.name : 'placeholder · cube',
    triangles: user ? user.tris : 12,
    reveal: +state.reveal.toFixed(3),
    revealing: state.revealing,
    shader: state.shaderHolo ? 'holographic' : 'original',
    hovered: state.hoverHit,
    camera: {
      position: camera.position.toArray().map(n => +n.toFixed(3)),
      target: controls.target.toArray().map(n => +n.toFixed(3)),
    },
    renderer: {
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      programs: renderer.info.programs?.length ?? null,
    },
    buttons: { load: btnLoad.disabled, shader: btnShader.disabled, reset: btnReset.disabled },
  }, null, 2),
});

window.devWebmcp?.register({
  name: 'vitrine_set_shader',
  title: 'Set shader mode',
  description:
    'Switch the viewer between the holographic shader and the original material. Reaches application ' +
    'state directly, so it works even while the SHADER button is disabled — that button only becomes ' +
    'enabled once a model is loaded. Omit holo to toggle.',
  inputSchema: {
    type: 'object',
    properties: { holo: { type: 'boolean', description: 'true = holographic, false = original. Omit to toggle.' } },
  },
  run: ({ holo }) => {
    state.shaderHolo = typeof holo === 'boolean' ? holo : !state.shaderHolo;
    applyShader();
    btnShader.textContent = \`SHADER · \${state.shaderHolo ? 'HOLO' : 'ORIG'}\`;
    stShader.textContent = state.shaderHolo ? 'HOLOGRAPHIC' : 'ORIGINAL';
    return \`shader = \${state.shaderHolo ? 'holographic' : 'original'}\`;
  },
});
`;

if (!html.includes("application-specific tools")) {
  const marker = "</script>\n</body>";
  if (!html.includes(marker)) throw new Error("could not find the module script end marker");
  const at = html.lastIndexOf(marker);
  html = html.slice(0, at) + appTools + html.slice(at);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`wrote ${OUT} (${(html.length / 1024).toFixed(0)} KB, bundle ${BUNDLE})`);
