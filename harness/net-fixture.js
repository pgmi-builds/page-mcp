// Loaded only by the network-capture probe. demo/ is generated and gitignored,
// so this is test scaffolding, not part of the demo.
window.__netProbe = {
  ok: () => fetch("/fixtures/triangle.glb").then((r) => r.arrayBuffer()).then((b) => b.byteLength),
  bad: () => fetch("/nope-404.json").then((r) => r.status),
};
