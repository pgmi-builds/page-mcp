#!/usr/bin/env node
/**
 * The browser tool an agent owns.
 *
 * This is NOT part of the page-mcp product and it is not a bridge to it. It
 * is the thing every coding agent already has: a Chrome it launched itself,
 * which it can attach to over CDP and evaluate JS in. Everything the agent
 * wants from the page — including the WebMCP tool surface — is reached through
 * that channel, with no relay, no extension and no MCP server in between.
 *
 * Keeping it as a detached process (rather than launch-per-call) matters: the
 * page keeps its state between commands, which is what makes multi-step work
 * possible.
 *
 *   node browser.mjs start [url]     launch Chrome and open a page (persists)
 *   node browser.mjs stop            shut it down
 *   node browser.mjs goto <url>      navigate the current tab
 *   node browser.mjs tools           list the page's WebMCP tools
 *   node browser.mjs call <tool> [json]   execute one WebMCP tool
 *   node browser.mjs eval <js>       evaluate JS in the page (devtools console)
 *   node browser.mjs status          is a browser up, what page is open
 */
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import puppeteer from "puppeteer-core";

const CHROME = "/usr/bin/google-chrome-stable";
const PORT = Number(process.env.CDP_PORT ?? 9222);
const PROFILE = process.env.CHROME_PROFILE ?? "/tmp/page-mcp-chrome";
const BROWSER_URL = `http://127.0.0.1:${PORT}`;
const ENDPOINT = `${BROWSER_URL}/json/version`;

const [cmd, ...args] = process.argv.slice(2);

function out(s) {
  process.stdout.write(typeof s === "string" ? s + "\n" : JSON.stringify(s, null, 2) + "\n");
}

async function connect() {
  try {
    return await puppeteer.connect({ browserURL: BROWSER_URL, defaultViewport: null });
  } catch {
    out(`no browser on ${BROWSER_URL} — run: node browser.mjs start <url>`);
    process.exit(2);
  }
}

async function currentPage(browser) {
  const pages = await browser.pages();
  const page = pages.find((p) => !p.url().startsWith("devtools://")) ?? pages[0];
  if (!page) throw new Error("browser has no pages");
  return page;
}

async function up() {
  try {
    const res = await fetch(ENDPOINT, { signal: AbortSignal.timeout(600) });
    return res.ok;
  } catch {
    return false;
  }
}

switch (cmd) {
  case "start": {
    const url = args[0] ?? "about:blank";
    if (await up()) {
      out(`browser already running on ${BROWSER_URL}`);
    } else {
      const child = spawn(
        CHROME,
        [
          `--remote-debugging-port=${PORT}`,
          `--user-data-dir=${PROFILE}`,
          "--no-first-run",
          "--no-default-browser-check",
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--use-gl=swiftshader",
          "--enable-unsafe-swiftshader",
          "--headless=new",
          url,
        ],
        { detached: true, stdio: "ignore" },
      );
      child.unref();
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        if (await up()) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      if (!(await up())) {
        out("chrome failed to expose a CDP endpoint");
        process.exit(1);
      }
      out(`browser up on ${BROWSER_URL}, profile ${PROFILE}`);
    }
    break;
  }

  case "stop": {
    const browser = await connect();
    await browser.close();
    try {
      rmSync(PROFILE, { recursive: true, force: true });
    } catch { }
    out("browser closed");
    break;
  }

  case "goto": {
    const browser = await connect();
    const page = await currentPage(browser);
    await page.goto(args[0], { waitUntil: "load", timeout: 45000 });
    out(`at ${page.url()} — title ${JSON.stringify(await page.title())}`);
    browser.disconnect();
    break;
  }

  case "status": {
    if (!(await up())) {
      out("no browser running");
      break;
    }
    const browser = await connect();
    const page = await currentPage(browser);
    const info = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      webmcp:
        typeof document.modelContext === "object" && document.modelContext !== null
          ? "available"
          : "absent",
      pageMcp: globalThis.pageMcp ? globalThis.pageMcp.version : null,
    }));
    out(info);
    browser.disconnect();
    break;
  }

  case "tools": {
    const browser = await connect();
    const page = await currentPage(browser);
    const tools = await page.evaluate(async () => {
      if (!document.modelContext) return { error: "document.modelContext is not available on this page" };
      const list = await document.modelContext.getTools();
      return list.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        annotations: t.annotations,
      }));
    });
    out(tools);
    browser.disconnect();
    break;
  }

  case "call": {
    // `--json` gives scripted callers an unambiguous {ok, tool, result} instead
    // of forcing them to pattern-match the result text to decide success.
    const asJson = args.includes("--json");
    const positional = args.filter((a) => a !== "--json");
    const name = positional[0];
    const input = positional[1] ? JSON.parse(positional[1]) : {};
    if (!name) {
      out("usage: call <tool> [json]");
      process.exit(2);
    }
    const browser = await connect();
    const page = await currentPage(browser);
    try {
      const result = await page.evaluate(
        async (n, i) => {
          const list = await document.modelContext.getTools();
          const tool = list.find((t) => t.name === n);
          if (!tool) return `no tool named "${n}". Available: ${list.map((t) => t.name).join(", ")}`;
          return await document.modelContext.executeTool(tool, JSON.stringify(i));
        },
        name,
        input,
      );
      const failed =
        typeof result === "string" && (/^Error from |^Error: /.test(result) || /^no tool named /.test(result));
      if (asJson) {
        out(JSON.stringify({ ok: !failed, tool: name, result }, null, 2));
      } else {
        out(result);
      }
      // Tools report failure as a RETURNED message (a throw would surface as an
      // opaque DOMException and tell the caller nothing), so the status has to
      // be derived from the text — otherwise a hard failure looks like success
      // to anything scripting this.
      if (failed) process.exitCode = 1;
    } catch (e) {
      out(`call failed: ${e.message}`);
      process.exitCode = 1;
    }
    browser.disconnect();
    break;
  }

  case "upload": {
    // The CDP-side counterpart to the page's dev_upload, and the ONLY way to
    // move a file from the developer's disk into the page: an in-page tool
    // cannot read host paths at all.  usage: upload <path...> [--selector <css>]
    const selIdx = args.indexOf("--selector");
    const selector = selIdx >= 0 ? args[selIdx + 1] : 'input[type="file"]';
    // With no --selector, selIdx is -1 and the naive filter would drop arg[0].
    const paths = selIdx >= 0 ? args.filter((_, i) => i !== selIdx && i !== selIdx + 1) : args;
    if (!paths.length) {
      out("usage: upload <path...> [--selector <css>]");
      process.exit(2);
    }
    const browser = await connect();
    const page = await currentPage(browser);
    const handle = await page.$(selector);
    if (!handle) {
      out(`no element matches ${selector} — pass --selector for the file input`);
      process.exitCode = 1;
    } else {
      await handle.uploadFile(...paths);
      out(`set ${paths.length} file(s) on ${selector}: ${paths.join(", ")}`);
    }
    browser.disconnect();
    break;
  }

  case "screenshot": {
    // Screenshots belong on THIS side of the boundary, not in the page: an
    // in-page tool can only reach pixels it can already draw (canvas.toDataURL),
    // and only when the app preserved the drawing buffer.
    const browser = await connect();
    const page = await currentPage(browser);
    const path = args[0] ?? "/tmp/page-mcp-shot.png";
    const buf = await page.screenshot({ fullPage: args.includes("--full") });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(path, buf);
    out(`wrote ${path} (${buf.length} bytes)`);
    browser.disconnect();
    break;
  }

  case "eval": {
    const code = args.join(" ");
    const browser = await connect();
    const page = await currentPage(browser);
    try {
      const result = await page.evaluate(async (src) => {
        try {
          const v = await (0, eval)(`(async () => (${src}))()`);
          return typeof v === "string" ? v : JSON.stringify(v, null, 2);
        } catch (e) {
          if (e instanceof SyntaxError) {
            const v = await (0, eval)(`(async () => { ${src} })()`);
            return typeof v === "string" ? v : JSON.stringify(v, null, 2);
          }
          throw e;
        }
      }, code);
      out(result);
    } catch (e) {
      out(`Uncaught ${e.name}: ${e.message}`);
      process.exitCode = 1;
    }
    browser.disconnect();
    break;
  }

  default:
    out(
      [
        "node browser.mjs start [url]        launch Chrome, open a page (state persists)",
        "node browser.mjs stop               shut it down",
        "node browser.mjs goto <url>         navigate the current tab",
        "node browser.mjs status             what page is open, is modelContext available",
        "node browser.mjs tools              list the page's WebMCP tools",
        "node browser.mjs call <tool> [json] execute a WebMCP tool",
        "node browser.mjs eval <js>          evaluate JS in the page",
				"node browser.mjs screenshot [path]  save a PNG of the page (--full for full page)",
				"node browser.mjs upload <path...>     put host files into a file input (CDP side)",
      ].join("\n"),
    );
}
