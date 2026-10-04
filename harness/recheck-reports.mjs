#!/usr/bin/env node
/**
 * Corrected independent re-test of docs/05 and docs/06. Run from anywhere:
 *
 *   node harness/recheck-reports.mjs
 *
 * It attaches to the Chrome already on CDP 9222 (harness/browser.mjs start) and
 * force-reloads the page first — see docs/07 for why that reload is the whole
 * point. Prints every measurement it asserts; nothing here reads the reports.
 *
 * The first attempt was invalid: the Chrome on :9222 had been started at
 * 20:44 while the fixed bundle was deployed at 21:15, so the open tab was
 * still running the pre-fix script out of memory. This version force-reloads
 * and waits for the full surface before measuring anything.
 */
import { readFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const BROWSER_URL = `http://127.0.0.1:${process.env.CDP_PORT ?? 9222}`;
const browser = await puppeteer.connect({ browserURL: BROWSER_URL, defaultViewport: null });
const pages = await browser.pages();
const page = pages.find((p) => p.url().includes("webmcp-devtools-demo")) ?? pages[0];
console.log("URL:", page.url());

const j = (v) => JSON.stringify(v);
const sec = (t) => console.log(`\n=== ${t} ===`);

// Force a fresh script. The deploy is no-store, but a tab that has been open
// since before a deploy keeps the old bundle in memory until it reloads.
await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(
  async () => {
    try {
      return (await document.modelContext.getTools()).length >= 15;
    } catch {
      return false;
    }
  },
  { timeout: 15000, polling: 200 },
);

const glb = readFileSync(new URL("../fixtures/triangle.glb", import.meta.url)).toString("base64");

// ---------------------------------------------------------------- surface
sec("surface (after reload)");
const surface = await page.evaluate(async () => {
  const tools = await document.modelContext.getTools();
  const host = document.querySelector('[data-page-mcp="badge"]');
  return {
    count: tools.length,
    names: tools.map((t) => t.name).sort(),
    dot: host?.shadowRoot?.querySelector(".dot span")?.textContent ?? "(no dot text)",
    panelHead: (host?.shadowRoot?.querySelector(".panel")?.textContent ?? "").split("\n").slice(0, 4).join(" | "),
    runtime: globalThis.pageMcp?.runtime?.(),
    version: globalThis.pageMcp?.version,
  };
});
console.log("count:", surface.count, "| version:", surface.version, "| runtime:", j(surface.runtime));
console.log("names:", surface.names.join(" "));
console.log("badge dot  :", surface.dot);
console.log("badge panel:", surface.panelHead);

// ------------------------------------------------- canvas readback (06 §1)
sec("06 §1 · canvas readback (non-black px of 4096)");
const RB = await page.evaluate(() => {
  const pick = () =>
    [...document.querySelectorAll("canvas")].sort((a, b) => b.width * b.height - a.width * a.height)[0];
  globalThis.__pick = pick;
  globalThis.__rb = () => {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext("2d");
    ctx.drawImage(pick(), 0, 0, 64, 64);
    const d = ctx.getImageData(0, 0, 64, 64).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 8 || d[i + 1] > 8 || d[i + 2] > 8) n++;
    return n;
  };
  const s = pick();
  return { id: s.id, w: s.width, h: s.height };
});
console.log("source canvas:", j(RB));
console.log("setTimeout (off-rAF):", await page.evaluate(() => new Promise((r) => setTimeout(() => r(globalThis.__rb()), 0))), "(06: 0)");
console.log("requestAnimationFrame:", await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(globalThis.__rb())))), "(06: 3333-3412)");

sec("06 §1 · toDataURL outside rAF");
const dataUrl = await page.evaluate(() => {
  const u = globalThis.__pick().toDataURL("image/png");
  return { len: u.length, valid: u.startsWith("data:image/png;base64,") };
});
console.log("length:", dataUrl.len, "| valid PNG data URL:", dataUrl.valid, "(06: 944710)");
console.log(
  "decoded:",
  j(
    await page.evaluate(async () => {
      const u = globalThis.__pick().toDataURL("image/png");
      return await new Promise((res) => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement("canvas");
          c.width = 64;
          c.height = 64;
          const ctx = c.getContext("2d");
          ctx.drawImage(img, 0, 0, 64, 64);
          const d = ctx.getImageData(0, 0, 64, 64).data;
          let n = 0;
          for (let i = 0; i < d.length; i += 4) if (d[i] > 8 || d[i + 1] > 8 || d[i + 2] > 8) n++;
          res({ w: img.naturalWidth, h: img.naturalHeight, nonBlack: n });
        };
        img.onerror = () => res({ error: "decode failed" });
        img.src = u;
      });
    }),
  ),
);

// --------------------------------------------------- hit test (06 §4.1)
sec("06 §4.1 · hit-test on a disabled control");
const hit = await page.evaluate(() => {
  const el = document.getElementById("btnShader");
  const r = el.getBoundingClientRect();
  const name = (e) =>
    e.tagName + (e.id ? "#" + e.id : "") +
    (typeof e.className === "string" && e.className.trim() ? "." + e.className.trim().split(/\s+/).join(".") : "");
  return {
    rect: { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) },
    disabled: el.disabled,
    pointerEvents: getComputedStyle(el).pointerEvents,
    why: ".actions button:disabled{opacity:.28;pointer-events:none} in index.html",
    top: name(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) ?? document.body),
    stack: document.elementsFromPoint(r.x + r.width / 2, r.y + r.height / 2).map(name),
  };
});
console.log("rect:", j(hit.rect), "| disabled:", hit.disabled, "| pointer-events:", hit.pointerEvents);
console.log("elementFromPoint ->", hit.top, " (parent, not the button)");
console.log("elementsFromPoint ->", hit.stack.join("  ->  "));

// ------------------------------------------- CDP clip screenshot (06 §1)
sec("06 §1 · CDP clip screenshot");
const client = await page.createCDPSession();
const clip = {
  x: Math.round(hit.rect.x),
  y: Math.round(hit.rect.y),
  width: Math.round(hit.rect.w),
  height: Math.round(hit.rect.h),
  scale: 1,
};
const shot = await client.send("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: true });
const buf = Buffer.from(shot.data, "base64");
console.log("clip:", j(clip));
console.log(`PNG ${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)} / ${buf.length} B  (06: 130x33 / 4770 B)`);
await client.detach();

// ------------------------------------------ 05 claims, live tool surface
sec("05 §2 · unknown property, via pageMcp.invoke");
console.log(String(await page.evaluate(() => globalThis.pageMcp.invoke("dev_click", { ref: "e1", bogus: 1 }))).slice(0, 260));

sec("05 §2 · unknown property, via modelContext.executeTool (the real spec path)");
console.log(
  String(
    await page.evaluate(async () => {
      const t = (await document.modelContext.getTools()).find((x) => x.name === "dev_snapshot");
      try {
        return await document.modelContext.executeTool(t, JSON.stringify({ max_nodes: 5, extra_a: 1, extra_b: 2 }));
      } catch (e) {
        return `REJECTED: ${e.name}: ${e.message}`;
      }
    }),
  ).slice(0, 300),
);

sec("05 §1 · dev_wait, predicate that throws (FULL message)");
const waitThrow = await page.evaluate(() =>
  globalThis.pageMcp.invoke("dev_wait", { code: "nope.value > 1", timeout_ms: 300 }).catch((e) => `THREW: ${e.message}`),
);
console.log(String(waitThrow));
console.log("--> contains 'predicate THREW':", /predicate THREW/.test(String(waitThrow)));

sec("05 §1 · dev_wait, predicate false but valid (FULL message)");
const waitFalse = await page.evaluate(() =>
  globalThis.pageMcp.invoke("dev_wait", { code: "1 > 2", timeout_ms: 300 }).catch((e) => `THREW: ${e.message}`),
);
console.log(String(waitFalse));
console.log("--> contains 'predicate THREW':", /predicate THREW/.test(String(waitFalse)));

sec("05 §1 · dev_upload include_snapshot default");
const up1 = await page.evaluate(
  (b64) => globalThis.pageMcp.invoke("dev_upload", { files: [{ name: "triangle.glb", base64: b64 }] }),
  glb,
);
console.log("omitted  ->", String(up1).slice(0, 160));
console.log("   has 'Page now':", /Page now/.test(String(up1)), " (05: false)");
const up2 = await page.evaluate(
  (b64) => globalThis.pageMcp.invoke("dev_upload", { files: [{ name: "triangle.glb", base64: b64 }], include_snapshot: true }),
  glb,
);
console.log("explicit ->", String(up2).slice(0, 160));
console.log("   has 'Page now':", /Page now/.test(String(up2)), " (05: true)");

sec("app state after upload");
console.log(String(await page.evaluate(() => globalThis.pageMcp.invoke("vitrine_state"))).slice(0, 200));

await browser.disconnect();
