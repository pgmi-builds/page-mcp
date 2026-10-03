/**
 * The tool surface.
 *
 * Names are prefixed (default `dev_`) on purpose: a coding agent may also be
 * holding chrome-devtools-mcp's `click` / `fill` / `take_snapshot`, and two
 * tools with the same name in one context is a coin flip.
 *
 * Descriptions are written for a model, not for a human browsing a README —
 * they say WHEN to call the tool and what the output looks like, because that
 * is what changes behaviour.
 */
import { Snapshotter } from "./snapshot.js";
import { fillElement, highlight, hover, pressKey, scrollBy, scrollIntoView, selectOption, synthClick, typeInto } from "./act.js";
import { readLogs, clearLogs } from "./capture.js";

const refProp = (desc) => ({ type: "string", description: desc });

export function buildTools({ prefix = "dev_", maxNodes = 200, snapshotAfterAction = true } = {}) {
  const snap = new Snapshotter();
  const name = (n) => prefix + n;

  const snapshotText = (opts = {}) => snap.snapshot({ maxNodes: opts.maxNodes ?? maxNodes });

  /** Resolve a ref, or fail with a fresh outline so the model can re-orient. */
  const need = (ref) => {
    const el = snap.resolve(ref);
    if (!el) {
      throw new Error(
        `No live element for ref "${ref}" — it was removed or replaced. Current page:\n${snapshotText()}`,
      );
    }
    return el;
  };

  /**
   * A disabled control silently swallows every event we can synthesize — the
   * click "succeeds" and nothing happens, then the agent retries forever.
   * Say so instead, and say what is probably missing.
   */
  const actable = (ref, el, verb) => {
    if (el.disabled || el.getAttribute("aria-disabled") === "true") {
      throw new Error(
        `Ref ${ref} (${describeShort(el)}) is disabled — ${verb} it does nothing. ` +
          `The page state must change first (often a prerequisite action is required).\n\nPage now:\n${snapshotText()}`,
      );
    }
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      throw new Error(
        `Ref ${ref} (${describeShort(el)}) has zero size — it is not visible, so ${verb} cannot hit it. ` +
          `An ancestor may be collapsed, or the element is rendered off-screen.\n\nPage now:\n${snapshotText()}`,
      );
    }
    return el;
  };

  /**
   * Let one frame land before outlining the page.
   *
   * Snapshotting synchronously after an action reports the DOM as it was
   * BEFORE the action's own render — an agent that clicked a control and read
   * the fresh outline would see the old disabled/disabled state and conclude
   * the click did nothing. One frame is enough for synchronous renderers, and
   * genuinely async work still needs the wait tool.
   */
  const settle = () =>
    new Promise((resolve) => {
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => setTimeout(resolve, 0));
      else setTimeout(resolve, 0);
    });

  const after = async (msg, { includeSnapshot }) => {
    const wantSnapshot = includeSnapshot ?? snapshotAfterAction;
    if (!wantSnapshot) return msg;
    await settle();
    return `${msg}\n\nPage now (outline taken one frame after the action; async work may still be in flight — use ${name("wait")} to wait on it):\n${snapshotText({ maxNodes: 80 })}`;
  };

  const includeSnapshotProp = {
    type: "boolean",
    description: `Include a fresh page outline in the result. Default ${snapshotAfterAction}.`,
  };

  const tools = [
    {
      name: name("snapshot"),
      title: "Snapshot page",
      description:
        "Read a text outline of the current page: interactive elements with stable refs (e.g. e7), their " +
        "role, accessible name and state, plus headings. Call this first. Refs are stable across calls, so " +
        "you can keep using a ref you already hold. Set root to a CSS selector to narrow the outline on a " +
        "large page. On a canvas/WebGL page the outline will be nearly empty — that is real, not an error; " +
        "use the eval tool for application state. Set include_hidden to also list elements that are " +
        "display:none / visibility:hidden / aria-hidden — file inputs are usually hidden deliberately and " +
        "would otherwise be invisible to every ref-taking tool.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: "object",
        properties: {
          root: { type: "string", description: "CSS selector to scope the outline to (default: body)." },
          max_nodes: { type: "number", description: `Max elements to print. Default ${maxNodes}.` },
          include_hidden: {
            type: "boolean",
            description: "Also list hidden elements, marked `hidden`. Default false.",
          },
        },
      },
      run: ({ root, max_nodes, include_hidden }) => {
        const scope = root ? document.querySelector(root) : undefined;
        if (root && !scope) throw new Error(`no element matches root ${JSON.stringify(root)}`);
        return snap.snapshot({
          root: scope ?? undefined,
          maxNodes: max_nodes ?? maxNodes,
          includeHidden: !!include_hidden,
        });
      },
    },
    {
      name: name("read"),
      title: "Read element",
      description:
        "Full detail for one ref from the latest snapshot: text, bounding rect, all attributes, computed " +
        "style essentials, and a CSS path. Use when the outline was not enough to decide.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: "object",
        properties: { ref: refProp('Element ref from the snapshot, e.g. "e7".') },
        required: ["ref"],
      },
      run: ({ ref }) => snap.describe(String(ref)),
    },
    {
      name: name("click"),
      title: "Click",
      description:
        "Click an element by ref. Dispatches a real pointer/mouse sequence, so menus and popovers that " +
        "open on pointerdown work. The element is flashed on screen so a human can see what was touched.",
      inputSchema: {
        type: "object",
        properties: { ref: refProp("Element ref from the snapshot."), include_snapshot: includeSnapshotProp },
        required: ["ref"],
      },
      run: ({ ref, include_snapshot }) => {
        const el = actable(String(ref), need(String(ref)), "clicking");
        scrollIntoView(el);
        highlight(el);
        synthClick(el);
        return after(`Clicked ${ref} (${describeShort(el)}).`, { includeSnapshot: include_snapshot });
      },
    },
    {
      name: name("fill"),
      title: "Fill field",
      description:
        "Set the value of an input, textarea or contenteditable in one shot (not keystroke by keystroke). " +
        "Writes through the native value setter so React/Vue controlled inputs register the change. " +
        "Use type instead when the app reacts to individual keystrokes (autocomplete, search-as-you-type).",
      inputSchema: {
        type: "object",
        properties: {
          ref: refProp("Element ref from the snapshot."),
          value: { type: "string", description: "The text to set." },
          include_snapshot: includeSnapshotProp,
        },
        required: ["ref", "value"],
      },
      run: ({ ref, value, include_snapshot }) => {
        const el = actable(String(ref), need(String(ref)), "filling");
        scrollIntoView(el);
        highlight(el);
        fillElement(el, String(value ?? ""));
        return after(`Filled ${ref} with ${JSON.stringify(String(value ?? ""))}.`, {
          includeSnapshot: include_snapshot,
        });
      },
    },
    {
      name: name("type"),
      title: "Type text",
      description:
        "Type text into a field one character at a time, firing keydown/keypress/input/keyup per character. " +
        "Slower than fill but produces the event stream that autocomplete and search-as-you-type need.",
      inputSchema: {
        type: "object",
        properties: {
          ref: refProp("Element ref from the snapshot."),
          text: { type: "string", description: "The text to type." },
          include_snapshot: includeSnapshotProp,
        },
        required: ["ref", "text"],
      },
      run: ({ ref, text, include_snapshot }) => {
        const el = actable(String(ref), need(String(ref)), "typing into");
        scrollIntoView(el);
        highlight(el);
        typeInto(el, String(text ?? ""));
        return after(`Typed ${JSON.stringify(String(text ?? ""))} into ${ref}.`, {
          includeSnapshot: include_snapshot,
        });
      },
    },
    {
      name: name("press"),
      title: "Press key",
      description:
        "Press a key or key name on an element or the focused element. Use for Enter-to-submit, Escape-to-close, Tab, arrow keys. Omit ref to target whatever currently has focus.",
      inputSchema: {
        type: "object",
        properties: {
          key: { type: "string", description: 'Key name, e.g. "Enter", "Escape", "Tab", "ArrowDown".' },
          ref: refProp("Optional element ref; defaults to the focused element."),
          include_snapshot: includeSnapshotProp,
        },
        required: ["key"],
      },
      run: ({ key, ref, include_snapshot }) => {
        const el = ref ? need(String(ref)) : undefined;
        pressKey(el, String(key));
        return after(`Pressed ${key}${el ? ` on ${ref}` : ""}.`, { includeSnapshot: include_snapshot });
      },
    },
    {
      name: name("select"),
      title: "Select option",
      description:
        "Choose an option in a native <select> by its value, visible label or text. Only works for real " +
        "<select> elements — for custom dropdowns, click the trigger then click the option ref.",
      inputSchema: {
        type: "object",
        properties: {
          ref: refProp("Element ref of the <select>."),
          value: { type: "string", description: "Option value, label or text to choose." },
          include_snapshot: includeSnapshotProp,
        },
        required: ["ref", "value"],
      },
      run: ({ ref, value, include_snapshot }) => {
        const el = need(String(ref));
        highlight(el);
        selectOption(el, String(value ?? ""));
        return after(`Selected ${JSON.stringify(String(value ?? ""))} in ${ref}.`, {
          includeSnapshot: include_snapshot,
        });
      },
    },
    {
      name: name("hover"),
      title: "Hover",
      description: "Move the pointer over an element (tooltips, hover menus).",
      inputSchema: {
        type: "object",
        properties: { ref: refProp("Element ref from the snapshot."), include_snapshot: includeSnapshotProp },
        required: ["ref"],
      },
      run: ({ ref, include_snapshot }) => {
        const el = need(String(ref));
        scrollIntoView(el);
        highlight(el);
        hover(el);
        return after(`Hovered ${ref}.`, { includeSnapshot: include_snapshot });
      },
    },
    {
      name: name("scroll"),
      title: "Scroll",
      description:
        "Scroll the document by a pixel delta, or bring a ref into view. Use before clicking something " +
        "that is off-screen (intersection-observer lazy content only renders once scrolled near).",
      inputSchema: {
        type: "object",
        properties: {
          ref: refProp("Optional element ref to scroll into view."),
          dx: { type: "number", description: "Horizontal delta in px (default 0)." },
          dy: { type: "number", description: "Vertical delta in px (default 0 when ref is given)." },
          include_snapshot: includeSnapshotProp,
        },
      },
      run: ({ ref, dx, dy, include_snapshot }) => {
        let msg;
        if (ref) {
          scrollIntoView(need(String(ref)));
          msg = `Scrolled ${ref} into view.`;
        } else {
          msg = scrollBy(Number(dx) || 0, Number(dy) || 0);
        }
        return after(msg, { includeSnapshot: include_snapshot });
      },
    },
    {
      name: name("eval"),
      title: "Evaluate JavaScript",
      description:
        "Run JavaScript in the page and get back a JSON-ish representation of the result. Await is " +
        "supported. This is your console: use it for anything the DOM outline cannot show — application " +
        "state, framework internals, WebGL scene graphs, computed values, network calls. Errors come back " +
        "as 'Uncaught …'. Note: module-scoped variables are not reachable; globals and window properties are.",
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string", description: "JavaScript expression or statements. Await is allowed." },
        },
        required: ["code"],
      },
      run: async ({ code }) => evalInPage(String(code ?? "")),
    },
    {
      name: name("console"),
      title: "Read console",
      description:
        "Read console output, uncaught errors and unhandled promise rejections captured since the page " +
        "loaded (ring buffer of 500). This is the browser console, in-page, so it also works when no " +
        "devtools session is attached. Filter with level, take the last N with tail.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: "object",
        properties: {
          level: {
            type: "string",
            enum: ["all", "log", "info", "warn", "error", "debug", "uncaught", "unhandledrejection"],
            description: "Filter by level (default all).",
          },
          tail: { type: "number", description: "How many of the most recent entries (default 40, max 200)." },
          clear: { type: "boolean", description: "Clear the buffer after reading." },
        },
      },
      run: ({ level, tail, clear }) => {
        const out = readLogs({ level, tail });
        if (clear) clearLogs();
        return out;
      },
    },
    {
      name: name("wait"),
      title: "Wait",
      description:
        "Wait until a condition holds, then return. Use this instead of re-snapshotting in a loop after an " +
        "action that triggers async work (a load, a save, a transition). Exactly one of selector / text / " +
        "code is required. Returns as soon as the condition is satisfied, or reports the timeout with the " +
        "current state so you can see what it was still waiting for. To wait on APPLICATION state that is " +
        "not in the DOM, call the app's own tool from the predicate — e.g. code: " +
        "`JSON.parse(await devWebmcp.invoke('app_state')).ready === true` — rather than polling from outside.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "Wait until this CSS selector matches an element." },
          text: { type: "string", description: "Wait until the page text contains this substring." },
          code: {
            type: "string",
            description: "Wait until this JS expression returns something truthy. Await is supported.",
          },
          timeout_ms: { type: "number", description: "Give up after this long. Default 5000, max 60000." },
        },
      },
      run: async ({ selector, text, code, timeout_ms }) => {
        const timeout = Math.min(Math.max(Number(timeout_ms) || 5000, 1), 60000);
        const deadline = Date.now() + timeout;
        const started = Date.now();
        const check = async () => {
          if (selector) return !!document.querySelector(String(selector));
          if (text) return (document.body?.textContent ?? "").includes(String(text));
          if (code) {
            try {
              return !!(await (0, eval)(`(async () => (${code}))()`));
            } catch {
              return false; // a throwing predicate just means "not satisfied yet"
            }
          }
          return true;
        };
        const label = selector ? `selector ${JSON.stringify(selector)}` : text ? `text ${JSON.stringify(text)}` : code;
        while (Date.now() < deadline) {
          if (await check()) return `Condition met after ${Date.now() - started}ms: ${label}`;
          await new Promise((r) => setTimeout(r, 100));
        }
        if (await check()) return `Condition met after ${Date.now() - started}ms: ${label}`;
        throw new Error(
          `Timed out after ${timeout}ms waiting for ${label}. Current state:\n${snapshotText({ maxNodes: 60 })}`,
        );
      },
    },
    {
      name: name("upload"),
      title: "Upload file",
      description:
        "Put files into a file input or onto a dropzone. Give each file a url (fetched by the page — a path " +
        "the dev server already serves, e.g. /fixtures/model.glb) or inline base64. If ref is omitted, the " +
        "first <input type=file> on the page is used, including one that is hidden — which is how most apps " +
        "hide their file picker, and why a snapshot will not show it. NOTE: this tool runs in the page, so it " +
        "cannot read a path on the developer's disk; for that the agent's own browser/CDP layer must do the " +
        "upload (CDP DOM.setFileInputFiles).",
      inputSchema: {
        type: "object",
        properties: {
          files: {
            type: "array",
            description: "Files to attach.",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "Filename the app will see." },
                url: { type: "string", description: "URL the page can fetch the bytes from." },
                base64: { type: "string", description: "Inline file bytes, base64-encoded." },
                type: { type: "string", description: "MIME type, e.g. model/gltf-binary." },
              },
              required: ["name"],
            },
          },
          ref: refProp("File input or dropzone ref. Defaults to the first <input type=file>."),
          include_snapshot: includeSnapshotProp,
        },
        required: ["files"],
      },
      run: async ({ files, ref, include_snapshot }) => {
        const el = ref
          ? actable(String(ref), need(String(ref)), "uploading to")
          : document.querySelector('input[type="file"]');
        if (!el) {
          throw new Error(
            "no file input found on the page and no ref given. Pass the ref of the input or the dropzone.",
          );
        }
        const msg = await attachFiles(el, files ?? []);
        // Default OFF, unlike the other act tools: parsing an uploaded file is
        // always asynchronous (FileReader, decode, network), so a snapshot taken
        // here shows pre-upload state and reads as "the upload did nothing".
        // The useful next step is the wait tool or an app tool, not an outline.
        return after(msg, { includeSnapshot: include_snapshot ?? false });
      },
    },
  ];

  return tools;
}

/** REPL semantics: try as an expression, fall back to a statement block. */
export async function evalInPage(code) {
  const runner = (src) => (0, eval)(`(async () => { ${src} })()`);
  try {
    let result;
    try {
      result = await runner(`return (${code});`);
    } catch (e) {
      if (e instanceof SyntaxError) result = await runner(code);
      else throw e;
    }
    return `→ ${clip(repr(result), 4000)}`;
  } catch (e) {
    const stack = String(e?.stack ?? "")
      .split("\n")
      .slice(0, 3)
      .join("\n  ");
    return `Uncaught ${e?.name ?? "Error"}: ${e?.message ?? String(e)}${stack ? `\n  ${stack}` : ""}`;
  }
}

function repr(v, depth = 4, seen = new Set()) {
  try {
    if (v === null) return "null";
    if (v === undefined) return "undefined";
    const t = typeof v;
    if (t === "string") return JSON.stringify(clip(v, 800));
    if (t === "number" || t === "boolean" || t === "bigint") return String(v);
    if (t === "function") return `ƒ ${v.name || "anonymous"}()`;
    if (t === "symbol") return v.toString();
    if (v instanceof Error) return `${v.name}: ${v.message}`;
    if (v instanceof Element) return `<${v.tagName.toLowerCase()}${v.id ? "#" + v.id : ""}>`;
    if (v instanceof NodeList || Array.isArray(v)) {
      const arr = [...v];
      const head = arr.slice(0, 20).map((x) => repr(x, depth - 1, seen)).join(", ");
      return `[${head}${arr.length > 20 ? `, …(${arr.length})` : ""}]`;
    }
    if (depth <= 0) return "{…}";
    if (seen.has(v)) return "[Circular]";
    seen.add(v);
    const keys = Object.keys(v);
    const head = keys.slice(0, 25).map((k) => `${k}: ${repr(v[k], depth - 1, seen)}`).join(", ");
    return `{ ${head}${keys.length > 25 ? ", …" : ""} }`;
  } catch {
    return String(v);
  }
}

/**
 * Attach files to a file input, or drop them on a dropzone.
 *
 * The bytes have to come from somewhere the PAGE can reach — a URL the dev
 * server is already serving, or inline base64. A path on the developer's own
 * disk is not reachable from here at all: that is a job for the agent's
 * browser/CDP layer (CDP `DOM.setFileInputFiles`), not for an in-page tool.
 */
async function attachFiles(el, specs) {
	if (!specs.length) throw new Error("no files given");
	const built = [];
	for (const spec of specs) {
		let blob;
		if (spec.url) {
			const res = await fetch(String(spec.url));
			if (!res.ok) throw new Error(`fetch ${spec.url} -> HTTP ${res.status}`);
			blob = await res.blob();
		} else if (spec.base64) {
			const bin = atob(String(spec.base64));
			const bytes = new Uint8Array(bin.length);
			for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
			blob = new Blob([bytes]);
		} else {
			throw new Error(`file ${JSON.stringify(spec.name)} needs either a url or base64`);
		}
		built.push(
			new File([blob], String(spec.name ?? "file"), {
				type: spec.type || blob.type || "application/octet-stream",
			}),
		);
	}

	const dt = new DataTransfer();
	for (const f of built) dt.items.add(f);
	const summary = built.map((f) => `${f.name} (${f.size} bytes)`).join(", ");

	if (el instanceof HTMLInputElement && el.type === "file") {
		el.files = dt.files;
		el.dispatchEvent(new Event("input", { bubbles: true }));
		el.dispatchEvent(new Event("change", { bubbles: true }));
		highlight(el);
		return `Attached ${summary} to the file input and fired input+change.`;
	}

	// Dropzone: some apps only listen for the drag sequence, so send all of it.
	const r = el.getBoundingClientRect();
	const init = {
		bubbles: true,
		cancelable: true,
		composed: true,
		clientX: r.x + r.width / 2,
		clientY: r.y + r.height / 2,
		dataTransfer: dt,
	};
	highlight(el);
	el.dispatchEvent(new DragEvent("dragenter", init));
	el.dispatchEvent(new DragEvent("dragover", init));
	el.dispatchEvent(new DragEvent("drop", init));
	return `Dropped ${summary} on ${describeShort(el)}.`;
}

function describeShort(el) {
  const tag = el.tagName.toLowerCase();
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  return `<${tag}${el.id ? "#" + el.id : ""}>${text ? ` ${JSON.stringify(clip(text, 40))}` : ""}`;
}

function clip(s, n) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
