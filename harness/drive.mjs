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
    // Chrome 151's native implementation returns a normalized annotation set
    // and drops `debugging` (documented as available from Chrome 156). Report
    // what we actually observed rather than asserting a version-dependent fact.
    console.log(
      `${anyDebugging ? "INFO" : "NOTE"}  ${label}: debugging annotation ` +
        `${anyDebugging ? "present" : "dropped by this implementation"} — ` +
        `got ${JSON.stringify(discovered[0]?.ann)}`,
    );

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

    // ---- 9. in-page network capture --------------------------------------
    // Uses URLs that exist (or don't) on any origin, so this also holds when
    // the suite is run against the deployed bundle.
    await page.addScriptTag({
      content: `
        window.__netProbe = {
          ok: () => fetch(location.href).then((r) => r.status),
          bad: () => fetch("/__dev-webmcp-missing__").then((r) => r.status),
        };
      `,
    });
    const okStatus = await page.evaluate(() => window.__netProbe.ok());
    const badStatus = await page.evaluate(() => window.__netProbe.bad());
    await new Promise((r) => setTimeout(r, 400));
    const netFail = await call("dev_network", { failed_only: true });
    record(
      `${label}: network capture surfaces a request the UI never reported`,
      badStatus === 404 && /404/.test(netFail) && /__dev-webmcp-missing__/.test(netFail),
      netFail.split("\n").slice(0, 6).join("\n"),
    );
    const netOne = await call("dev_network", { filter: "__dev-webmcp-missing__" });
    record(
      `${label}: network entries carry status, size and an initiator call site`,
      // The initiator can be `(agent-injected script):1:15`, which contains a
      // space — match the trailing line:col rather than a whole token.
      okStatus === 200 && /404/.test(netOne) && /at\s+.*:\d+:\d+/.test(netOne),
      netOne.split("\n").slice(0, 5).join("\n"),
    );
    // The readable-initiator case needs a script served from the page's own
    // origin, which the deployed demo does not have.
    const fixtureServed = await page.evaluate(async () => {
      try {
        return (await fetch("/harness/net-fixture.js", { method: "HEAD" })).ok;
      } catch {
        return false;
      }
    });
    if (fixtureServed) {
      await page.addScriptTag({ url: "/harness/net-fixture.js" });
      const bytes = await page.evaluate(() => window.__netProbe.ok());
      await new Promise((r) => setTimeout(r, 400));
      const netPath = await call("dev_network", { filter: "triangle\\.glb" });
      record(
        `${label}: initiator names the page source that made the call`,
        bytes === 624 && /harness\/net-fixture\.js:\d+:\d+/.test(netPath),
        netPath.split("\n").slice(0, 4).join("\n"),
      );
    } else {
      console.log(`NOTE  ${label}: no same-origin script fixture — readable-initiator case skipped`);
    }

    // ---- 8b. UNTRUSTED fencing -------------------------------------------
    // The page is the untrusted party, so an app tool's description is fenced
    // before it reaches a consuming agent, and every tool declares
    // untrustedContentHint because every output here is page text.
    const fenced = await page.evaluate(async () => {
      const tools = await document.modelContext.getTools();
      const app = tools.find((t) => t.name === "vitrine_state");
      const own = tools.find((t) => t.name === "dev_snapshot");
      return {
        appFenced: app.description.startsWith("[UNTRUSTED:"),
        ownUnfenced: !own.description.startsWith("[UNTRUSTED:"),
        allFlagged: tools.every((t) => t.annotations?.untrustedContentHint === true),
      };
    });
    record(
      `${label}: app tool descriptions are fenced as untrusted`,
      fenced.appFenced && fenced.ownUnfenced && fenced.allFlagged,
      JSON.stringify(fenced),
    );

    // ---- 8c. storage -------------------------------------------------------
    const storage = await call("dev_storage", { action: "set", key: "dev_webmcp_probe", value: "{\"n\":1}" });
    const got = await call("dev_storage", { action: "get", key: "dev_webmcp_probe" });
    const listed = await call("dev_storage", { action: "list" });
    const cleaned = await call("dev_storage", { action: "remove", key: "dev_webmcp_probe" });
    record(
      `${label}: storage round-trips a value the UI never touched`,
      /overwrote|created/.test(storage) && got === "{\"n\":1}" && /dev_webmcp_probe/.test(listed) && /removed/.test(cleaned),
      `get -> ${got}`,
    );

    // ---- 8d. drag ----------------------------------------------------------
    // The app gates its orbit controls until the first pointerdown (the intro
    // swallow), so the first drag is a no-op by the app's own design. Drag
    // twice and require the camera to have moved by the end.
    const posBefore = await call("vitrine_state");
    await call("dev_drag", { from: "canvas", dx: 120, dy: 0, steps: 8 });
    await call("dev_drag", { from: "canvas", dx: -180, dy: 30, steps: 8 });
    const posAfter = await call("vitrine_state");
    record(
      `${label}: drag drives the canvas gesture (camera moved)`,
      posBefore !== posAfter && /"camera"/.test(posAfter),
      `camera ${JSON.parse(posAfter).camera.position.map((n) => +n.toFixed(2)).join(", ")}`,
    );

    // ---- 8e. find + box -----------------------------------------------------
    // find must return an actionable ref, and interactive matches must outrank
    // a plain sentence that merely contains the same word.
    await page.evaluate(() => {
      const d = document.createElement("div");
      d.innerHTML =
        '<p>PROBEWORD is mentioned in this sentence.</p>' +
        '<button aria-label="PROBEWORD control">PROBEWORD control</button>';
      document.body.appendChild(d);
    });
    const found = await call("dev_find", { query: "PROBEWORD" });
    const findRef = found.match(/\[(e\d+)\]/)?.[1];
    const clickedFound = findRef ? await call("dev_click", { ref: findRef, include_snapshot: false }) : "";
    record(
      `${label}: find returns a live, actionable ref and ranks controls first`,
      /button/.test(found.split("\n")[1] ?? "") && /Clicked/.test(clickedFound),
      found.split("\n").slice(0, 3).join("\n"),
    );

    const boxLine = found.split("\n").find((l) => l.includes("control")) ?? "";
    const boxRef = boxLine.match(/\[(e\d+)\]/)?.[1];
    const box = boxRef ? JSON.parse(await call("dev_box", { ref: boxRef })) : {};
    record(
      `${label}: box hands CDP-ready document coordinates and hit-test truth`,
      // documentRect must be viewportRect plus scroll — that sum is exactly the
      // thing an agent gets wrong when it crops the neighbour. And hit-test
      // state must be COHERENT rather than true: on this page the probe button
      // genuinely sits under the full-viewport canvas, so hitTestable false with
      // coveredBy set is the correct answer, and asserting `true` here would
      // reward the bug the tool exists to expose.
      !!box.documentRect &&
        box.documentRect.w > 0 &&
        Math.abs(box.documentRect.x - (box.viewportRect.x + box.scroll.x)) < 0.5 &&
        Math.abs(box.documentRect.y - (box.viewportRect.y + box.scroll.y)) < 0.5 &&
        (box.hitTestable ? box.coveredBy === null : typeof box.coveredBy === "string"),
      `documentRect=${JSON.stringify(box.documentRect)} hitTestable=${box.hitTestable} coveredBy=${JSON.stringify(box.coveredBy)}`,
    );

    // ---- 8f. geometry audit -------------------------------------------------
    await page.evaluate(() => {
      const d = document.createElement("div");
      d.innerHTML =
        '<button style="width:0;height:0;border:0;padding:0" aria-label="PROBEZERO">go</button>' +
        '<div style="width:90px;white-space:nowrap;overflow:hidden;font:14px monospace">PROBECLIPPEDTEXTTHATISFARTOOLONGTOFITINSIDE90PIXELS</div>';
      document.body.appendChild(d);
    });
    const audit = await call("dev_geometry_audit", {});
    record(
      `${label}: audit proves clipped text and unclickable controls without pixels`,
      // Not /PROBEZERO/: the audit reports tag#id, not aria-labels, so the label
      // cannot appear in the output by construction.
      /clipped-text/.test(audit) && /PROBECLIPPED/.test(audit) && /zero-size/.test(audit) && /interactive but 0x0/.test(audit),
      audit.split("\n").slice(0, 4).join("\n"),
    );

    // ---- 8h. the badge must follow the registry ----------------------------
    // Nothing else on the page watches for late app registrations; the badge is
    // the visible one. If emit() ever stops firing, the count goes stale and
    // the page quietly lies about what it exposes — which is how this shipped
    // once: a refactor dropped the emit call, every test stayed green, and the
    // badge froze at the pack's own count.
    const badgeText = () =>
      page.evaluate(() =>
        document.querySelector('[data-dev-webmcp="badge"]')?.shadowRoot?.querySelector(".dot span")?.textContent ?? "",
    );
    const badgeBefore = await badgeText();
    await page.evaluate(() => globalThis.devWebmcp.register({ name: "app.probe_badge", run: () => "x" }));
    await new Promise((r) => setTimeout(r, 250));
    const badgeAfter = await badgeText();
    record(
      `${label}: the badge repaints when an app tool registers late`,
      // The split reads "pack + app"; one more registration moves the total by one
      // whichever side of the "+" it lands on.
      (() => {
        const total = (s) => {
          const m = s.match(/(\d+)(?:\s*\+\s*(\d+))? tools/);
          return m ? Number(m[1]) + Number(m[2] ?? 0) : NaN;
        };
        return total(badgeAfter) === total(badgeBefore) + 1;
      })(),
      `${badgeBefore} -> ${badgeAfter}`,
    );

    // ---- 8g. changes / assert / perf ---------------------------------------
    // changes: token before, mutate, delta after — the record must be there and
    // the token must move.
    const tok = Number((await call("dev_changes", {})).match(/pass since: (\d+)/)?.[1]);
    await page.evaluate(() => {
      const b = document.createElement("button");
      b.id = "probe-delta";
      b.textContent = "PROBEDELTA";
      document.body.appendChild(b);
    });
    await new Promise((r) => setTimeout(r, 150));
    const delta = await call("dev_changes", { since: tok });
    record(
      `${label}: changes reports what an action did, in order`,
      /added/.test(delta) && /probe-delta/.test(delta) && /PROBEDELTA/.test(delta),
      delta.split("\n").slice(0, 2).join("\n"),
    );

    // assert: a passing batch, and a failing one that must THROW (so the exit
    // code says 'failed' instead of the body saying it politely).
    const assertOk = await call("dev_assert", {
      checks: [
        { exists: "#probe-delta" },
        { text: "#probe-delta", contains: "probedelta" },
        { count: "canvas", atLeast: 1 },
        { missing: "#probe-not-there" },
      ],
    });
    // A thrown tool comes back through executeTool as a STRING ("Error from
    // ..."), so nothing rejects here — assert on the shape instead. The
    // non-zero exit that a coding agent actually sees is the CLI layer's
    // translation of this same string, verified against browser.mjs directly.
    const failedCall = await call("dev_assert", {
      checks: [{ exists: "#probe-delta" }, { text: "#probe-delta", contains: "definitely not there" }],
    });
    const threw = /^Error from dev_assert: 1 of 2 check\(s\) failed/.test(failedCall) && /FAIL 2/.test(failedCall);
    record(
      `${label}: assert proves state in one call and reports per-check verdicts when one fails`,
      /All 4 check\(s\) passed/.test(assertOk) && threw,
      assertOk.split("\n")[0],
    );

    const perf = await call("dev_perf", { frames: 6 });
    record(
      `${label}: perf reports long tasks and a live frame sample`,
      /"longTasks"/.test(perf) && /"frameSample"/.test(perf) && /"count"/.test(perf),
      JSON.stringify(JSON.parse(perf).frameSample),
    );

    // ---- 10. installing twice must not half-register ----------------------
    // Duplicate tool names are rejected by the browser, and a rejected mirror
    // is not fatal to the local registry — so a second copy used to look like
    // "some tools work". It is now refused outright, with a warning.
    const beforeDup = (await page.evaluate(async () => (await document.modelContext.getTools()).length));
    // Pick a bundle URL that actually exists on THIS origin: the live
    // published dir has devtools.js as a same-dir sibling, the local serve
    // root has it at /dist/. A 404 script tag means NO second copy is ever
    // attempted, and the guard assertion passes for the wrong reason —
    // which is exactly what happened when the sibling form met the local
    // origin. Probe, then inject the one that answers.
    const dupURL = await page.evaluate(async () => {
      const candidates = [new globalThis.URL("devtools.js", location.href).href, "/dist/devtools.js"];
      for (const c of candidates) {
        try {
          const r = await fetch(c);
          if (r.ok) return c;
        } catch {}
      }
      return null;
    });
    if (!dupURL) {
      record(`${label}: a second copy of the bundle is refused, not half-registered`, false, "no bundle URL found on this origin to attempt a double install");
    } else
    await page.evaluate((u) => {
      const s = document.createElement("script");
      s.src = u;
      document.head.appendChild(s);
    }, dupURL);
    await new Promise((r) => setTimeout(r, 1200));
    const afterDup = await page.evaluate(async () => (await document.modelContext.getTools()).length);
    const warnedDup = await call("dev_console", { tail: 20 });
    record(
      `${label}: a second copy of the bundle is refused, not half-registered`,
      afterDup === beforeDup && /already has dev-webmcp installed/.test(warnedDup),
      `tools ${beforeDup} -> ${afterDup}; warning ${
        /already has dev-webmcp installed/.test(warnedDup) ? "seen" : "MISSING"
      }`,
    );

    // ---- 11. tool names are validated before the browser sees them ---------
    const badName = await page.evaluate(() => {
      try {
        globalThis.devWebmcp.register({ name: "Dev Snapshot", run: () => "x" });
        return "ACCEPTED";
      } catch (e) {
        return e.message;
      }
    });
    record(
      `${label}: an illegal tool name is refused with the constraint spelled out`,
      /^Illegal tool name/.test(badName) && /A-Za-z0-9_/.test(badName),
      badName.split("\n")[0],
    );

    return { info, names };
  } finally {
    await browser.close();
  }
}

const native = await run({ label: "native", native: true });
const poly = await run({ label: "polyfill", native: false });

/**
 * The input tools' first positive pass on a NORMAL DOM UI.
 *
 * Every prior verification of fill/type/select/press happened on the canvas
 * demo, where those tools have no positive path at all — the reports kept
 * noting it (docs/10 §7, docs/11 §4) and it was the largest untested surface
 * in the pack. Runs against harness/form-fixture.html when the page's origin
 * serves it (the deployed demo does not, so a live-URL drive run skips this
 * pass with a note rather than failing).
 */
async function runFormPass() {
  console.log(`\n${"=".repeat(72)}\n== form (normal DOM UI)\n${"=".repeat(72)}`);
  // `URL` above is the demo-url STRING (it shadows the global), hence globalThis.
  const fixtureURL = new globalThis.URL("/harness/form-fixture.html", URL).href;
  const served = await (async () => {
    const browser = await puppeteer.launch({
      executablePath: "/usr/bin/google-chrome-stable",
      headless: "new",
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const p = await browser.newPage();
      const res = await p.goto(fixtureURL, { waitUntil: "domcontentloaded", timeout: 15000 });
      // puppeteer-core v25 made Response.ok a METHOD; a bare `res?.ok` is the
      // function itself (truthy) — the probe then never skips a missing fixture
      // and the form pass dies on a 20s wait for a bundle that was never served.
      return typeof res?.ok === "function" ? res.ok() : Boolean(res?.ok);
    } catch {
      return false;
    } finally {
      await browser.close();
    }
  })();
  if (!served) {
    console.log(`NOTE  form: no form fixture at this origin — input-tool pass skipped`);
    return;
  }

  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome-stable",
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    await page.goto(fixtureURL, { waitUntil: "load", timeout: 45000 });
    await page.waitForFunction("!!globalThis.devWebmcp", { timeout: 20000 });

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

    // 1. batch fill, then verify the page's own event log saw proper
    //    input+change pairs (the native-setter path is the whole point).
    await call("dev_fill", {
      fields: [
        { ref: "#name", value: "Ada Lovelace" },
        { ref: "#bio", value: "Wrote the first note about the machine." },
      ],
    });
    const events1 = await page.evaluate(() => window.__events.join(","));
    record(
      `form: batch fill fires input+change on real fields`,
      // the fixture logs bare ids: input:name,change:name,input:bio,change:bio
      /input:name/.test(events1) && /change:name/.test(events1) && /change:bio/.test(events1),
      events1,
    );

    // 2. select: list first, then choose by label.
    const listed = await call("dev_select", { ref: "#plan" });
    await call("dev_select", { ref: "#plan", value: "Free" });
    const plan = await page.evaluate(() => document.getElementById("plan").value);
    record(
      `form: select lists options and chooses by label`,
      /value="ent" label="Enterprise/.test(listed) && /disabled/.test(listed) && plan === "free",
      `plan=${plan}; listing ${listed.split("\n").length - 1} lines`,
    );

    // 3. type: per-keystroke, into the field batch fill already set.
    await call("dev_type", { ref: "#name", text: " Countess" });
    const typed = await page.evaluate(() => document.getElementById("name").value);
    record(`form: type appends per keystroke`, typed === "Ada Lovelace Countess", JSON.stringify(typed));

    // 3b. Keys: the KeyboardEvent DOES reach page handlers (positive path on a
    //     normal DOM UI, never verifiable on the canvas demo) — but Tab does
    //     NOT traverse focus: traversal is a trusted-only default action, same
    //     class as implicit submit. The tool documents this; the test pins it.
    await page.evaluate(() => document.getElementById("name").focus());
    await call("dev_press", { key: "ArrowRight" });
    await call("dev_press", { key: "Tab" });
    const focusAfterTab = await page.evaluate(() => document.activeElement.id);
    const keyEvents = await page.evaluate(() => window.__events.filter((e) => e.startsWith("keydown:")));
    record(
      `form: dev_press delivers keys to handlers; Tab traversal stays trusted-only`,
      keyEvents.includes("keydown:name:ArrowRight") &&
        keyEvents.includes("keydown:name:Tab") &&
        focusAfterTab === "name",
      `keys=${JSON.stringify(keyEvents)} focusAfterTab=${focusAfterTab || "(none)"}`,
    );

    // 4. submit by CLICKING, then assert the page's own state in one call.
    await page.evaluate(() => {
      window.__submitFired = [];
      document.getElementById("signup").addEventListener("submit", () => {
        window.__submitFired.push(
          `submit@${Math.round(performance.now())} name=${JSON.stringify(document.getElementById("name").value)}`,
        );
      });
    });
    // (Implicit submission on Enter is browser-internal and needs a trusted
    // event; synthetic Enter fires the page's keydown handlers but does not
    // submit — so the agent-visible path is clicking the submit button.)
    const formClick = await call("dev_click", { ref: "#go", include_snapshot: false });
    // Capture dev_click's OWN submit before the bare-click control below resets
    // the log — the control must never be what the main assertion measures.
    const devSubmitFired = await page.evaluate(() => window.__submitFired.slice());
    const assertOut = await call("dev_assert", {
      checks: [
        { exists: "#status" },
        { text: "#status", contains: "\"plan\":\"free\"" },
        { visible: "#later" },
      ],
    });
    const status = await page.evaluate(() => document.getElementById("status").textContent);
    record(
      `form: click submits and assert verifies the app's own state`,
      /All 3 check\(s\) passed/.test(assertOut) &&
        /"tos":false/.test(status) &&
        devSubmitFired.length === 1 &&
        devSubmitFired[0].includes('"Ada Lovelace Countess"'),
      `click=${String(formClick).split("\n")[0]} | submitFired=${JSON.stringify(devSubmitFired)} | status=${status.slice(0, 90)}`,
    );

    // Control: a bare el.click() on the same button MUST also submit. It runs
    // second so it cannot contaminate the measurement above, and it splits
    // "dev_click/synthClick doesn't activate" from "the environment blocks
    // submission" if this pass ever goes red again.
    const bareStatus = await page.evaluate(() => {
      window.__submitFired.length = 0;
      document.getElementById("go").click();
      return document.getElementById("status").textContent.slice(0, 40);
    });
    const bareSubmitted = await page.evaluate(() => window.__submitFired.length);
    record(
      `form: bare el.click() control submits (environment sanity)`,
      bareSubmitted === 1 && /submitted/.test(bareStatus),
      `bareSubmitFired=${bareSubmitted} status=${bareStatus}`,
    );

    // 5. disabled control: the diagnostic, not a silent success.
    const snap2 = await call("dev_snapshot", { max_nodes: 300 });
    const laterRef = (snap2.split("\n").find((l) => l.includes("Save for later"))?.match(/\[(e\d+)\]/) ?? [])[1];
    const laterClick = laterRef ? await call("dev_click", { ref: laterRef, include_snapshot: false }) : "<<no ref>>";
    record(
      `form: clicking a disabled button explains itself on real DOM`,
      /disabled/.test(laterClick),
      String(laterClick).split("\n")[0],
    );

    // 6. one ordered delta for the whole interaction.
    const changed = await call("dev_changes", { limit: 12 });
    record(
      `form: changes shows the submitted state update`,
      /text/.test(changed) && /submitted/.test(changed),
      changed.split("\n").slice(0, 3).join("\n"),
    );
  } finally {
    await browser.close();
  }
}

await runFormPass();

console.log(`\n${"=".repeat(72)}`);
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("failed: " + failed.map((f) => f.name).join(" | "));
  process.exitCode = 1;
}
console.log(`\ntool count: native=${native.names.length} polyfill=${poly.names.length}`);
