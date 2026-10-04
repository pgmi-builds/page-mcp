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
import { fillElement, highlight, hover, pressKey, scrollBy, scrollIntoView, selectOption, synthClick, synthDrag, typeInto } from "./act.js";
import { readLogs, clearLogs } from "./capture.js";
import { readNetwork, clearNetwork } from "./network.js";
import { storageOp } from "./storage.js";
import { boxOf, auditGeometry } from "./geometry.js";
import { readChanges } from "./observe.js";
import { perfSnapshot } from "./perf.js";

const refProp = (desc) => ({ type: "string", description: `${desc} A ref from the snapshot, or a CSS selector.` });

export function buildTools({ prefix = "dev_", maxNodes = 200, snapshotAfterAction = true } = {}) {
  const snap = new Snapshotter();
  const name = (n) => prefix + n;

  const snapshotText = (opts = {}) => snap.snapshot({ maxNodes: opts.maxNodes ?? maxNodes });

  /** Resolve a ref, or fail with a fresh outline so the model can re-orient. */
  /**
   * Resolve an element spec — a ref from the snapshot, or a CSS selector.
   *
   * Selectors exist because the thing an agent wants is sometimes the thing a
   * snapshot does not carry: a canvas, a map tile, a field it wants to address
   * before re-snapshotting. Refs stay the primary form (stable across
   * snapshots); a selector is resolved live, so it is always fresh but never
   * tracked. On failure the message says which of the two was attempted.
   */
  const need = (spec) => {
    const s = String(spec);
    const isRef = /^e\d+$/.test(s);
    const el = isRef ? snap.resolve(s) : document.querySelector(s);
    if (!el) {
      const what = isRef ? `live element for ref "${s}"` : `element matching selector "${s}"`;
      throw new Error(`No ${what} — ${isRef ? "it was removed or replaced" : "nothing on the page matches"}. Current page:\n${snapshotText()}`);
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
      name: name("find"),
      title: "Find elements",
      description:
        "Search the page for elements matching a word or phrase — by accessible name, the element's own " +
        "text, value, placeholder, aria-label or title, case-insensitively — and get back live refs you can " +
        "act on with click/fill/type right away. Use this instead of a full snapshot when you already know " +
        "roughly what you are looking for: a snapshot is budgeted to DESCRIBE the page, so on a long page " +
        "the element you want falls below the cut and that reads as if it did not exist. `query` is a " +
        "substring, not a selector. Refs are the same stable ones a snapshot mints, so mixing find and " +
        "snapshot is safe.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Text to look for (substring, case-insensitive)." },
          limit: { type: "number", description: "How many matches to return (default 10, max 50)." },
          include_hidden: {
            type: "boolean",
            description: "Also match elements that are hidden or not rendered (default false).",
          },
        },
        required: ["query"],
      },
      run: ({ query, limit, include_hidden }) => {
        const { total, rows, truncated } = snap.find(query, {
          limit,
          includeHidden: include_hidden,
        });
        if (!total) {
          return (
            `No element matching ${JSON.stringify(String(query))}. The query matches text, accessible names, ` +
            `values, tags and roles — "button" does find buttons, but a word that appears ON the element ` +
            `is usually the better query. Hidden elements are skipped unless include_hidden is set, and a ` +
            `canvas- or WebGL-driven page may have no text to match at all — take a snapshot to see what ` +
            `this page exposes.`
          );
        }
        return (
          `${total} match(es) for ${JSON.stringify(String(query))}` +
          `${truncated ? ` — showing the first ${rows.length}` : ""}\n${rows.join("\n")}`
        );
      },
    },
    {
      name: name("box"),
      title: "Element geometry",
      description:
        "Exact geometry and hit-test state for one element — the handoff for an element-scoped screenshot. " +
        "A page cannot rasterize itself, so the pixels belong to your CDP layer; this supplies the numbers " +
        "and pre-empts the two ways that goes wrong. Use documentRect (NOT viewportRect) as the clip, with " +
        `scale: devicePixelRatio and captureBeyondViewport: true. hitTestable false means a click here does ` +
        "nothing, and coveredBy names what is actually on top — a disabled element reports hitTestable " +
        "false rather than occluded, which is a different bug with a different fix.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: "object",
        properties: {
          ref: refProp("Element ref from the snapshot."),
        },
        required: ["ref"],
      },
      run: ({ ref }) => {
        const el = need(String(ref));
        return JSON.stringify({ ref, ...boxOf(el) }, null, 1);
      },
    },
    {
      name: name("geometry_audit"),
      title: "Audit layout defects",
      description:
        "Scan the page for layout defects that are provable from the box tree alone, no screenshot needed: " +
        "text clipped by its container, interactive elements with no box (unclickable by construction), " +
        "images that failed to decode, sideways page scroll, fonts still loading. Use it after a CSS or " +
        "layout change, or before claiming a visual bug is fixed — these are assertions about the layout, " +
        "not impressions about how it looks. Contrast and paint-order problems are NOT covered; those " +
        "need pixels.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: "object",
        properties: {
          max_examples: { type: "number", description: "Examples to show per category (default 4)." },
        },
      },
      run: ({ max_examples }) => {
        const { scanned, categories, page } = auditGeometry({ maxExamples: max_examples });
        if (!categories.length && !page.length) {
          return (
            `No layout defects found in ${scanned} element(s). (Checks: clipped text, zero-size ` +
            `interactive elements, broken images, sideways scroll.)`
          );
        }
        const parts = [];
        for (const { kind, count, examples } of categories) {
          const rows = examples
            .map(({ el, why }) => {
              const ref = snap.refFor(el);
              return `    [${ref}] ${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""} — ${why}`;
            })
            .join("\n");
          parts.push(`  ${kind}: ${count} found${count > examples.length ? ` (showing ${examples.length})` : ""}\n${rows}`);
        }
        if (page.length) parts.push(`  page:\n${page.map((p) => `    ${p}`).join("\n")}`);
        return `Layout audit — ${scanned} element(s) scanned:\n${parts.join("\n")}`;
      },
    },
    {
      name: name("changes"),
      title: "What changed",
      description:
        "Read the DOM changes recorded since a token, in order — the cheap way to learn what an action " +
        "actually did. Call it once BEFORE the action to get a token, do the action, then call it with " +
        "`since: <that token>`. Records added / removed nodes, text and attribute changes with timestamps, " +
        "so you can see whether the list re-rendered before the spinner went away — order that two " +
        "snapshots cannot show you. Recording starts when the script loads; shadow-DOM internals and this " +
        "package's own indicator and highlight are excluded. For console output in the same window use " +
        "dev_console, for network use dev_network.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: "object",
        properties: {
          since: { type: "number", description: "A `next` token from an earlier call. Omit to read everything recorded so far." },
          limit: { type: "number", description: "How many of the most recent records (default 40, max 200)." },
        },
      },
      run: ({ since, limit }) => readChanges({ since, limit }).text,
    },
    {
      name: name("perf"),
      title: "Performance snapshot",
      description:
        "Measure how this page is actually performing: first paint, LCP, long tasks (count/total/worst), " +
        "cumulative layout shift, navigation timings, resource totals with the slowest entries, heap use, " +
        "and a LIVE frame-rate sample. Use it to answer 'is it slow, and is it still slow after my change' " +
        "without opening a tracing session. The frame sample is taken while you wait, so it reflects now; " +
        "everything else is buffered history since the page loaded. This is a blunt instrument on purpose — " +
        "for attribution to code you need a real trace (CDP Tracing / the DevTools profiler).",
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: "object",
        properties: {
          frames: { type: "number", description: "Frames to sample for the rate estimate (default 12)." },
        },
      },
      run: async ({ frames }) => JSON.stringify(await perfSnapshot({ frames }), null, 1),
    },
    {
      name: name("assert"),
      title: "Assert page state",
      description:
        "Check several facts about the page in ONE call and get a per-check verdict — how you prove a fix " +
        "landed instead of eyeballing a snapshot. Each check object carries one of: `exists` (CSS selector), " +
        "`missing` (selector), `count` (selector, with atLeast/atMost), `visible` (selector — rendered with " +
        "a box), or `text` (a ref or selector) with `contains`. Failing ANY check is an error that names " +
        "every check and its result, so the tool result is the evidence either way. Selectors are CSS; " +
        "refs work wherever a ref is more convenient than a selector.",
      inputSchema: {
        type: "object",
        properties: {
          checks: {
            type: "array",
            description: "Each object carries exactly one of exists / missing / count / visible / text.",
            items: {
              type: "object",
              properties: {
                exists: { type: "string", description: "CSS selector that must match something." },
                missing: { type: "string", description: "CSS selector that must match nothing." },
                count: { type: "string", description: "CSS selector to count." },
                atLeast: { type: "number", description: "With count: minimum matches (default 1)." },
                atMost: { type: "number", description: "With count: maximum matches." },
                visible: { type: "string", description: "CSS selector that must be rendered with a box." },
                text: { type: "string", description: "Ref or CSS selector whose text/value to check." },
                contains: { type: "string", description: "With text: substring expected (case-insensitive)." },
              },
            },
          },
        },
        required: ["checks"],
      },
      run: ({ checks }) => {
        if (!Array.isArray(checks) || !checks.length) {
          throw new Error(
            `Pass "checks": a list like [{"exists":"#save"},{"text":{"ref":"e3","contains":"Saved"}}].`,
          );
        }
        const resolve = (spec) => {
          const s = String(spec);
          if (/^e\d+$/.test(s)) return snap.resolve(s) ?? null;
          return document.querySelector(s);
        };
        const rendered = (el) => {
          if (!el) return false;
          const s = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0;
        };

        const results = checks.map((c, i) => {
          const kind = c && Object.keys(c).find((k) => k !== "atLeast" && k !== "atMost" && k !== "contains");
          const fail = (msg) => `FAIL ${i + 1} (${kind}): ${msg}`;
          try {
            if (kind === "exists") {
              return resolve(c.exists) ? `ok   ${i + 1}: ${JSON.stringify(c.exists)} exists` : fail(`nothing matches ${JSON.stringify(c.exists)}`);
            }
            if (kind === "missing") {
              return resolve(c.missing) ? fail(`${JSON.stringify(c.missing)} is still on the page`) : `ok   ${i + 1}: ${JSON.stringify(c.missing)} absent`;
            }
            if (kind === "count") {
              const n = document.querySelectorAll(String(c.count)).length;
              const lo = c.atLeast ?? 1;
              const hi = c.atMost ?? Infinity;
              return n >= lo && n <= hi
                ? `ok   ${i + 1}: ${JSON.stringify(c.count)} matched ${n}`
                : fail(`${JSON.stringify(c.count)} matched ${n}, expected ${hi === Infinity ? `>= ${lo}` : `${lo}-${hi}`}`);
            }
            if (kind === "visible") {
              const el = resolve(c.visible);
              return rendered(el)
                ? `ok   ${i + 1}: ${JSON.stringify(c.visible)} is rendered`
                : fail(`${JSON.stringify(c.visible)} is absent, display:none, visibility:hidden, or has no box`);
            }
            if (kind === "text") {
              const el = resolve(c.text);
              if (!el) return fail(`nothing matches ${JSON.stringify(c.text)}`);
              // `el.value ?? textContent` is wrong twice over: a <button>'s value
              // is "" (defined, so ?? never falls through) and a div's value is
              // undefined. Ask the element what kind it is instead.
              const textual =
                el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
                  ? (el.value ?? "")
                  : (el.textContent ?? "");
              const actual = String(textual).replace(/\s+/g, " ").trim();
              const needle = String(c.contains ?? "").toLowerCase();
              if (!c.contains) return fail(`add "contains": the text is ${JSON.stringify(actual.slice(0, 120))}`);
              return actual.toLowerCase().includes(needle)
                ? `ok   ${i + 1}: text of ${JSON.stringify(c.text)} contains ${JSON.stringify(c.contains)}`
                : fail(`text of ${JSON.stringify(c.text)} is ${JSON.stringify(actual.slice(0, 120))}, which lacks ${JSON.stringify(c.contains)}`);
            }
            return fail(`unknown check kind — use exists, missing, count, visible or text`);
          } catch (e) {
            return fail(`${e?.message ?? e}`);
          }
        });

        const failures = results.filter((r) => r.startsWith("FAIL"));
        if (failures.length) {
          // Throwing (not returning FAILED) is deliberate: the harness turns a
          // thrown tool into a non-zero exit, so 'the assertion ran and passed'
          // and 'the assertion failed' are different shell outcomes.
          throw new Error(`${failures.length} of ${checks.length} check(s) failed:\n${results.join("\n")}`);
        }
        return `All ${checks.length} check(s) passed.\n${results.join("\n")}`;
      },
    },
    {
      name: name("click"),
      title: "Click",
      description:
        "Click an element by ref. Dispatches a real pointer/mouse sequence, so menus and popovers that " +
        "open on pointerdown work, then fires the click itself with activation behavior, so submit buttons " +
        "submit, links navigate and checkboxes toggle. The element is flashed on screen so a human can see " +
        "what was touched.",
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
          fields: {
            type: "array",
            description:
              "Fill several fields in one call instead of one round trip each. Each item is {ref, value}. " +
              "Fields are filled in order; if one fails, the ones before it stay filled and the error says " +
              "how far it got.",
            items: {
              type: "object",
              properties: {
                ref: refProp("Element ref from the snapshot."),
                value: { type: "string", description: "The text to set." },
              },
              required: ["ref", "value"],
            },
          },
          include_snapshot: includeSnapshotProp,
        },
        // No `required` here on purpose: a call carries either ref+value or
        // fields[], and run() produces the error that says which was missing.
      },
      run: ({ ref, value, fields, include_snapshot }) => {
        const one = (r, v) => {
          const el = actable(String(r), need(String(r)), "filling");
          scrollIntoView(el);
          highlight(el);
          fillElement(el, String(v ?? ""));
          return `  ${r} = ${JSON.stringify(String(v ?? ""))}`;
        };

        if (Array.isArray(fields) && fields.length) {
          const done = [];
          try {
            for (const f of fields) done.push(one(f.ref, f.value));
          } catch (e) {
            // Stopping at the first failure is right — the model has to know the
            // form is half-filled — but a bare error invites a retry that
            // re-fills everything from the start.
            throw new Error(
              `Filled ${done.length} of ${fields.length} field(s) before failing. Filled so far:\n` +
                `${done.join("\n")}\n\nThen: ${e.message}`,
            );
          }
          return after(`Filled ${fields.length} field(s):\n${done.join("\n")}`, {
            includeSnapshot: include_snapshot,
          });
        }

        if (ref === undefined || value === undefined) {
          throw new Error(
            `Give "ref" and "value" for one field, or "fields": [{ref, value}, ...] to fill several at once.`,
          );
        }
        one(ref, value);
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
        "Press a key or key name on an element or the focused element. Use it when the APP listens for the " +
        "key: Escape-to-close, arrow-key menus, Tab traps, an input with its own keydown handler. It does " +
        "NOT trigger browser-internal behaviors that require a trusted event — Enter will not implicitly " +
        "submit a form and Tab will not move focus; click the submit button or focus the next control " +
        "instead. Omit ref to target whatever currently has focus.",
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
        "Choose an option in a native <select> by its value, visible label or text. Omit `value` to list the " +
        "options first — cheaper than guessing and failing, and the failure lists them anyway. Only works " +
        "for real <select> elements; for custom dropdowns, click the trigger then click the option ref.",
      inputSchema: {
        type: "object",
        properties: {
          ref: refProp("Element ref of the <select>."),
          value: {
            type: "string",
            description: "Option value, label or text. Omit to list the options instead of choosing one.",
          },
          include_snapshot: includeSnapshotProp,
        },
        required: ["ref"],
      },
      run: ({ ref, value, include_snapshot }) => {
        const el = need(String(ref));
        if (!(el instanceof HTMLSelectElement)) {
          throw new Error(
            `Ref ${ref} is not a <select> (it is a ${el.tagName.toLowerCase()}). For a custom dropdown, click ` +
              `the trigger and then click the option that appears.`,
          );
        }
        highlight(el);

        if (value === undefined) {
          const rows = [...el.options].map(
            (o) =>
              `  ${o.selected ? "*" : " "} value=${JSON.stringify(o.value)} label=${JSON.stringify(
                (o.label || o.textContent || "").trim(),
              )}${o.disabled ? " disabled" : ""}`,
          );
          return (
            `<select> at ${ref}: ${el.options.length} option(s), currently ${JSON.stringify(el.value)}\n` +
            `${rows.join("\n")}\nPass one of these as "value" — a value or a label both match.`
          );
        }

        selectOption(el, String(value));
        return after(`Selected ${JSON.stringify(String(value))} in ${ref}.`, {
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
      name: name("drag"),
      title: "Drag",
      description:
        "Drag from one point to another: rotate or pan a canvas, move a slider handle, reorder a card, " +
        "sweep a range. `from` is a ref from the snapshot OR a CSS selector — a canvas is rarely in an " +
        "accessibility outline, so selector is the normal way to reach one. Give `to` (ref or selector) or " +
        "`dx`/`dy` in CSS pixels from `from`'s centre. The pointer runs down → interpolated moves → up on one " +
        "pointerId, which is what inertia and sortable handlers need; a click pair reads to them as a tap. " +
        "`steps` raises the move count for velocity-based handlers. Events are synthetic, so isTrusted is " +
        "false — application code sees them, browser-level gestures do not happen. If an app swallows the " +
        "false — application code sees them, browser-level gestures do not happen. Some apps swallow their " +
        "first interaction (to dismiss an intro or arm a gesture handler), so a drag can be a no-op the " +
        "first time: if nothing moved, drag again before concluding the gesture is broken.",
      inputSchema: {
        type: "object",
        properties: {
          from: {
            type: "string",
            description: "Element ref (e.g. e7) or CSS selector to start on. The drag starts at its centre.",
          },
          to: { type: "string", description: "Ref or CSS selector to drop on. Give this, or dx/dy." },
          dx: { type: "number", description: "Horizontal pixels from `from`'s centre. Give with dy, instead of `to`." },
          dy: { type: "number", description: "Vertical pixels from `from`'s centre." },
          steps: { type: "number", description: "Intermediate pointermove events (default 8)." },
          include_snapshot: includeSnapshotProp,
        },
        required: ["from"],
      },
      run: async ({ from, to, dx, dy, steps, include_snapshot }) => {
        const centre = (el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        };
        // A ref is the common case and is checked first; anything else is a
        // selector. Canvases, map tiles and other pointer surfaces usually have
        // no ref at all, which is why the selector path exists.
        const resolve = (spec, verb) => {
          const s = String(spec);
          if (/^e\d+$/.test(s)) return { el: actable(s, need(s), verb), label: `ref ${s}` };
          const el = document.querySelector(s);
          if (!el) {
            throw new Error(
              `No element matches selector ${JSON.stringify(s)}. Take a snapshot to see what is on the page.`,
            );
          }
          return { el, label: `selector ${JSON.stringify(s)}` };
        };

        const a = resolve(from, "dragging");
        const fromPt = centre(a.el);
        let toPt;
        let toLabel;
        if (to !== undefined) {
          const b = resolve(to, "dropping on");
          toPt = centre(b.el);
          toLabel = b.label;
        } else if (dx !== undefined || dy !== undefined) {
          toPt = { x: fromPt.x + (dx ?? 0), y: fromPt.y + (dy ?? 0) };
          toLabel = `(${Math.round(toPt.x)}, ${Math.round(toPt.y)})`;
        } else {
          throw new Error(`A drag needs somewhere to go: give "to" (a ref or selector) or "dx"/"dy" in pixels.`);
        }

        const n = Math.min(Math.max(Number(steps) || 8, 1), 60);
        await synthDrag(a.el, { from: fromPt, to: toPt, steps: n });
        return after(
          `Dragged on ${a.label} from (${Math.round(fromPt.x)}, ${Math.round(fromPt.y)}) to ${toLabel} over ${n} moves.`,
          { includeSnapshot: include_snapshot },
        );
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
        "as 'Uncaught …'. One expression evaluates to its value; a mix of statements and a trailing " +
        "expression runs as statements and returns undefined, so end with the expression alone or an " +
        "explicit return. Module-scoped variables are not reachable; globals and window properties are.",
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
      name: name("network"),
      title: "Read network activity",
      description:
        "Read the page's own HTTP activity — fetch, XMLHttpRequest and sendBeacon — captured in-page in a " +
        "ring buffer of 200. Call this when an action did nothing and the UI did not say why: a save that " +
        "silently failed is usually a 4xx/5xx or a rejected fetch that the app never surfaced, which is " +
        "invisible in a snapshot and in the console. Each entry has status, duration, size and the call site " +
        "that made the request, so you can go straight to the code that needs fixing. Failed requests are " +
        "listed, never dropped. WebSocket and EventSource frames are NOT captured. Runs in-page, so it needs " +
        "no devtools session.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "How many of the most recent matching requests (default 20, max 200)." },
          filter: {
            type: "string",
            description: "Only requests whose URL contains this string, or matches it as a regular expression.",
          },
          failed_only: {
            type: "boolean",
            description:
              "Only requests that failed outright or returned 4xx/5xx. Try this first when an action " +
              "silently did nothing.",
          },
          include_bodies: {
            type: "boolean",
            description:
              "Include request and response bodies (each truncated to 2000 chars). Off by default — bodies " +
              "are large and usually not needed to find the failure.",
          },
          clear: { type: "boolean", description: "Clear the buffer after reading." },
        },
      },
      run: ({ limit, filter, failed_only, include_bodies, clear }) => {
        const out = readNetwork({
          limit,
          filter,
          failedOnly: failed_only,
          includeBodies: include_bodies,
        });
        if (clear) clearNetwork();
        return out;
      },
    },
    {
      name: name("storage"),
      title: "Read and write storage",
      description:
        "Read or change this origin's localStorage, sessionStorage and document.cookie. Use it to set up a " +
        "state the UI depends on (a feature flag, a cached token, a half-finished draft) or to reset to a " +
        "fresh-user state without clearing the whole profile. Exactly one of get/set/remove needs a key; " +
        "list is the usual first call. Boundaries: HttpOnly cookies are invisible to document.cookie (read " +
        "those from CDP), IndexedDB is listed only by name, and values are strings — JSON.stringify " +
        "structured data before setting it.",
      inputSchema: {
        type: "object",
        properties: {
          area: {
            type: "string",
            enum: ["local", "session", "cookie"],
            description: "Which store (default local).",
          },
          action: {
            type: "string",
            enum: ["list", "get", "set", "remove", "clear"],
            description: "What to do (default list).",
          },
          key: { type: "string", description: "The storage key / cookie name. Required by get, set and remove." },
          value: { type: "string", description: "The value to store. Required by set." },
        },
      },
      run: ({ area, action, key, value }) => storageOp({ area, action, key, value }),
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
        "`JSON.parse(await pageMcp.invoke('app_state')).ready === true` — rather than polling from outside.",
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
        // Remember WHY a predicate failed. Swallowing the exception made
        // "the condition is not true yet" indistinguishable from "your predicate
        // is broken": an agent with a typo'd expression waited out the whole
        // timeout and then reported that the condition never became true.
        let lastError = null;
        const check = async () => {
          if (selector) {
            lastError = null;
            return !!document.querySelector(String(selector));
          }
          if (text) {
            lastError = null;
            return (document.body?.textContent ?? "").includes(String(text));
          }
          if (code) {
            try {
              const v = !!(await (0, eval)(`(async () => (${code}))()`));
              lastError = null;
              return v;
            } catch (e) {
              lastError = e;
              return false;
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
          `Timed out after ${timeout}ms waiting for ${label}.` +
            (lastError
              ? `\n\nThe predicate THREW on every attempt, so this may be a broken condition rather than a ` +
                `slow one: ${lastError.name}: ${lastError.message}`
              : "") +
            `\n\nCurrent state:\n${snapshotText({ maxNodes: 60 })}`,
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
          // Not includeSnapshotProp: this tool defaults the other way, and
          // advertising "Default true" here contradicted the implementation.
          include_snapshot: {
            type: "boolean",
            description:
              "Include a page outline in the result. Default false — file parsing is always async, so an " +
              "outline taken here would show pre-upload state.",
          },
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
