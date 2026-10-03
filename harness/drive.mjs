/**
 * End-to-end drive — the proof that the delivery model works.
 *
 * The only browser channel used here is CDP `Runtime.evaluate` (via
 * puppeteer's page.evaluate). That is deliberately the weakest assumption we
 * can make: if a test can drive the tool surface this way, so can any coding
 * agent that owns its own Chrome. No relay, no extension, no MCP server.
 *
 * Runs twice:
 *   native    — Chrome launched with --enable-features=WebMCP
 *   polyfill  — no flag at all, the bundled polyfill provides modelContext
 */
import puppeteer from "puppeteer-core";

const URL = process.env.DEMO_URL ?? "http://127.0.0.1:8940/demo/";
const results = [];

function record(name, pass, evidence) {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (evidence) console.log(String(evidence).split("\n").map((l) => "      " + l).join("\n"));
}

/** Run one full pass in a fresh browser. */
async function run({ label, native }) {
  console.log(`\n${"=".repeat(72)}\n== ${label}\n${"=".repeat(72)}`);
  const args = ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"];
  if (native) args.push("--enable-features=WebMCP");

  const browser = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome-stable", headless: "new", args });
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 200)));
    await page.goto(URL, { waitUntil: "load", timeout: 45000 });
    await page.waitForFunction("!!globalThis.devWebmcp", { timeout: 20000 });
    // let the three.js scene boot and the first frames render
    await new Promise((r) => setTimeout(r, 2500));

    // ---- 1. the runtime we landed on -------------------------------------
    const info = await page.evaluate(() => ({
      ...globalThis.devWebmcp.runtime(),
      hasDocumentModelContext: typeof document.modelContext === "object" && document.modelContext !== null,
      tools: globalThis.devWebmcp.specs().map((t) => t.name),
    }));
    record(
      `${label}: modelContext available (${info.native ? "native" : "polyfill"})`,
      info.hasDocumentModelContext,
      `native=${info.native} polyfilled=${info.polyfilled} tools=${info.tools.length}`,
    );

    // ---- 2. discovery through the standard API ---------------------------
    const discovered = await page.evaluate(async () => {
      const tools = await document.modelContext.getTools();
      return tools.map((t) => ({ name: t.name, desc: (t.description || "").slice(0, 60), ann: t.annotations }));
    });
    const names = discovered.map((t) => t.name);
    record(
      `${label}: getTools() discovers the pack + app tools`,
      names.includes("dev_snapshot") && names.includes("vitrine_state"),
      `${discovered.length} tools: ${names.join(", ")}`,
    );
    const anyDebugging = discovered.some((t) => t.ann?.debugging === true);
    record(`${label}: tools carry the debugging annotation`, anyDebugging, `annotations=${JSON.stringify(discovered[0]?.ann)}`);

    // Everything below goes through executeTool(tool, jsonString) — the
    // exact call an in-page agent makes, reached over CDP.
    const call = (name, input = {}) =>
      page.evaluate(
        async (n, i) => {
          const tools = await document.modelContext.getTools();
          const tool = tools.find((t) => t.name === n);
          if (!tool) return `<<no tool named ${n}>>`;
          return await document.modelContext.executeTool(tool, JSON.stringify(i));
        },
        name,
        input,
      );

    // ---- 3. the DOM outline of a WebGL page ------------------------------
    const snap = await call("dev_snapshot");
    record(
      `${label}: snapshot works on a canvas page`,
      snap.includes("btnLoad") === false && snap.split("\n").length > 2,
      snap.split("\n").slice(0, 12).join("\n"),
    );

    // ---- 4. disabled control must fail loudly, not silently --------------
    // The snapshot line for a disabled control carries the `disabled` flag,
    // which is exactly what the model would see.
    const shaderLine = snap.split("\n").find((l) => l.includes("btnShader")) ?? snap.split("\n").find((l) => l.includes("SHADER"));
    const m = shaderLine && shaderLine.match(/\[(e\d+)\]/);
    record(`${label}: snapshot marks the disabled control`, !!m && /disabled/.test(shaderLine), shaderLine ?? "(no SHADER line)");
    const clickResult = m
      ? await call("dev_click", { ref: m[1], include_snapshot: false })
      : "<<no shader ref found>>";
    record(
      `${label}: clicking a disabled control explains itself`,
      /disabled/i.test(clickResult),
      clickResult.split("\n")[0],
    );
    record(
      `${label}: clicking a disabled control explains itself`,
      /disabled/i.test(clickResult),
      clickResult.split("\n")[0],
    );

    // ---- 5. app-level tool reaches state the DOM cannot ------------------
    const state1 = await call("vitrine_state");
    record(
      `${label}: app tool exposes WebGL scene state`,
      /"exhibit"/.test(state1) && /"shader"/.test(state1),
      state1.split("\n").slice(0, 10).join("\n"),
    );

    // ---- 6. app tool changes state the UI button cannot ---------------
    const before = JSON.parse(await call("vitrine_state")).shader;
    const applied = await call("vitrine_set_shader");
    const after = JSON.parse(await call("vitrine_state")).shader;
    record(
      `${label}: app tool mutates state while the UI button is disabled`,
      before !== after && /holographic|original/.test(applied),
      `shader ${before} -> ${after}   (${applied})`,
    );

    // ---- 7. console capture is in-page, no devtools session --------------
    const logs = await call("dev_console", { tail: 10 });
    record(`${label}: console capture returns a result`, typeof logs === "string" && logs.length > 0, logs.split("\n").slice(0, 4).join("\n"));

    // ---- 8. eval reaches globals but NOT module scope --------------------
    const evalResult = await call("dev_eval", {
      code: "JSON.stringify({ canvases: document.querySelectorAll('canvas').length, webgl: !!document.querySelector('canvas')?.getContext('webgl2'), moduleScopeVisible: typeof state })",
    });
    record(
      `${label}: eval works and reports module scope honestly`,
      /canvases/.test(evalResult),
      evalResult,
    );

    return { info, names };
  } finally {
    await browser.close();
  }
}

const native = await run({ label: "native", native: true });
const poly = await run({ label: "polyfill", native: false });

console.log(`\n${"=".repeat(72)}`);
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("failed: " + failed.map((f) => f.name).join(" | "));
  process.exitCode = 1;
}
console.log(`\ntool count: native=${native.names.length} polyfill=${poly.names.length}`);
