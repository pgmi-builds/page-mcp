/**
 * DOM abstraction — the part that decides how much of the page the agent sees.
 *
 * Design notes, each one paid for by a real failure mode:
 *
 * 1. STABLE REFS. A ref (`e7`) is minted once per element and survives across
 *    snapshots (WeakMap element->ref, Map ref->WeakRef(element)). CDP-based
 *    tools re-mint uids every snapshot and tell the model "always use the
 *    latest snapshot"; that forces a re-read between every action. Stable refs
 *    let the model act, observe, and act again on the same handle.
 *
 * 2. TRUNCATION MUST BE VISIBLE. If the outline stops at a budget, it has to
 *    say so. Otherwise "the dialog is not in the list" and "the dialog is
 *    below the cut" look identical, and the agent concludes the dialog closed.
 *    Radix portals dialog content to the END of body, so that is exactly what
 *    falls off the budget first.
 *
 * 3. VALUE PREVIEWS MUST ADMIT THEY ARE PREVIEWS. Printing the first 60 chars
 *    of a field silently makes the agent believe the field has a character
 *    limit; it then retries shorter and shorter strings.
 *
 * 4. A CANVAS PAGE HAS (ALMOST) NO DOM. That is not a bug in this snapshotter
 *    — it is the reason the `eval` tool exists next to it.
 */
// Deep import on purpose: the package root re-exports the description and role
// algorithms as well, which costs ~10 KB gzipped instead of ~5. We want exactly
// one function, and nothing here should be hand-rolled (see docs/08 §3.3).
import { computeAccessibleName } from "../node_modules/dom-accessibility-api/dist/accessible-name.mjs";

const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "textarea",
  "select",
  "summary",
  "details",
  "[role=button]",
  "[role=link]",
  "[role=checkbox]",
  "[role=radio]",
  "[role=tab]",
  "[role=menuitem]",
  "[role=switch]",
  "[role=option]",
  "[role=combobox]",
  "[role=slider]",
  "[contenteditable=true]",
  "[contenteditable='']",
  "[tabindex]:not([tabindex='-1'])",
  "[onclick]",
].join(",");

const HEADING_SELECTOR = "h1,h2,h3,h4,h5,h6,[role=heading]";
const VALUE_PREVIEW = 60;

export class Snapshotter {
  constructor() {
    this.elToRef = new WeakMap();
    this.refToEl = new Map();
    this.counter = 0;
  }

  refFor(el) {
    let ref = this.elToRef.get(el);
    if (!ref) {
      ref = `e${++this.counter}`;
      this.elToRef.set(el, ref);
    }
    this.refToEl.set(ref, new WeakRef(el));
    return ref;
  }

  /** Resolve a ref from an earlier snapshot back to a live element. */
  resolve(ref) {
    const el = this.refToEl.get(ref)?.deref();
    return el && el.isConnected ? el : undefined;
  }

  /** Which ref (if any) currently identifies this element. */
  refOf(el) {
    return this.elToRef.get(el);
  }

  snapshot({ root, maxNodes = 200, includeHidden = false } = {}) {
    if (typeof document === "undefined") return "(no document)";
    const scope = root ?? document.body;
    if (!scope) return "(no body)";

    const lines = [];
    const seen = new Set();
    let truncated = false;

    const collect = (selector, render) => {
      for (const el of scope.querySelectorAll(selector)) {
        if (seen.has(el)) continue;
        const hidden = isHidden(el);
        if (hidden && !includeHidden) continue;
        if (lines.length >= maxNodes) {
          truncated = true;
          return;
        }
        const line = render(el, hidden);
        if (line) {
          seen.add(el);
          lines.push(line);
        }
      }
    };

    collect(HEADING_SELECTOR, (el) => {
      const name = accessibleName(el);
      return name ? `# ${name}` : undefined;
    });

    collect(INTERACTIVE_SELECTOR, (el, hidden) => {
      const ref = this.refFor(el);
      const parts = [`[${ref}]`, roleOf(el), JSON.stringify(accessibleName(el) || "(no label)")];
      if (hidden) parts.push("hidden");
      const state = stateOf(el);
      if (state) parts.push(state);
      return parts.join(" ");
    });

    const header =
      `# page url=${location.href} title=${JSON.stringify(document.title)} ` +
      `viewport=${innerWidth}x${innerHeight} scroll=${Math.round(scrollY)}`;

    if (lines.length === 0) {
      return (
        `${header}\n(no interactive elements found — the page may be canvas/WebGL driven; ` +
        `use the eval tool to inspect application state)`
      );
    }

    const out = [header, ...lines];
    if (truncated) {
      out.push(
        `(outline truncated at the ${maxNodes}-element budget — more elements exist, ` +
        `including anything rendered last, such as an open dialog. Do NOT read a missing ` +
        `element as absent: narrow the outline with a CSS root, or act on refs you already hold.)`,
      );
    }
    return out.join("\n");
  }

  /** Full detail for one ref. */
  describe(ref) {
    const el = this.resolve(ref);
    // THROW, do not return: a returned diagnosis is indistinguishable from a
    // successful result to anything reading the tool output, which makes
    // failures look like successes to scripts and to the model.
    if (!el) throw new Error(`No live element for ref "${ref}" — it was removed or replaced. Take a new snapshot.`);
    const r = el.getBoundingClientRect();
    const attrs = [...el.attributes]
      .map((a) => `${a.name}=${JSON.stringify(clip(a.value, 80))}`)
      .join(" ");
    const lines = [
      `ref=${ref} <${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}>`,
      `role=${roleOf(el)} name=${JSON.stringify(accessibleName(el))}`,
      `text=${JSON.stringify(clip((el.textContent ?? "").replace(/\s+/g, " ").trim(), 400))}`,
      `rect=x:${Math.round(r.x)} y:${Math.round(r.y)} w:${Math.round(r.width)} h:${Math.round(r.height)}`,
      `attrs=${attrs || "—"}`,
    ];
    if ("value" in el) lines.push(`value=${valueFlag(String(el.value ?? ""))}`);
    if ("checked" in el) lines.push(`checked=${el.checked}`);
    const styles = getComputedStyle(el);
    lines.push(
      `style=display:${styles.display} visibility:${styles.visibility} opacity:${styles.opacity} ` +
      `pointer-events:${styles.pointerEvents} z-index:${styles.zIndex}`,
    );
    lines.push(`selector=${cssPath(el)}`);
    return lines.join("\n");
  }
}

/** A short, reasonably stable CSS path — for handing back to source/human. */
export function cssPath(el) {
  const parts = [];
  let node = el;
  while (node && node.nodeType === 1 && parts.length < 6) {
    let part = node.tagName.toLowerCase();
    if (node.id) {
      part += `#${node.id}`;
      parts.unshift(part);
      break;
    }
    const cls = typeof node.className === "string" ? node.className.trim().split(/\s+/).filter(Boolean) : [];
    if (cls.length) part += "." + cls.slice(0, 2).join(".");
    const parent = node.parentElement;
    if (parent) {
      const sibs = [...parent.children].filter((c) => c.tagName === node.tagName);
      if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    node = node.parentElement;
  }
  return parts.join(" > ");
}

/**
 * The accessible name of an element.
 *
 * This used to be hand-rolled, and it was wrong in ways that matter: an
 * `<input type=submit value="Go">` got no name at all, an `aria-hidden` icon
 * inside a button leaked into the button's name ("* Delete"), and hidden
 * elements were named as if they were visible. The accessible name is how an
 * agent identifies an element, so being wrong here means acting on the wrong
 * node. `dom-accessibility-api` (MIT, 5 KB gzipped) implements the spec, so we
 * use it and keep the old heuristic only as a fallback.
 */
export function accessibleName(el) {
  try {
    const n = computeAccessibleName(el);
    if (n) return clip(n.replace(/\s+/g, " ").trim(), 120);
  } catch {
    /* fall through to the heuristic below */
  }
  return heuristicName(el);
}

/** Kept for the cases where the spec computation throws on a detached node. */
function heuristicName(el) {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria.trim();

  const labelledby = el.getAttribute("aria-labelledby");
  if (labelledby) {
    const text = labelledby
      .split(/\s+/)
      .map((id) => el.ownerDocument?.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
    if (text) return text;
  }

  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") {
    if (el.id) {
      const label = el.ownerDocument?.querySelector(`label[for="${cssEscape(el.id)}"]`);
      if (label?.textContent) return label.textContent.trim();
    }
    const wrapping = el.closest("label");
    if (wrapping?.textContent) return wrapping.textContent.trim();
    const value = el.getAttribute("value");
    if (value && ["submit", "reset", "button"].includes(el.type)) return value.trim();
    const ph = el.getAttribute("placeholder");
    if (ph) return ph.trim();
    const nm = el.getAttribute("name");
    if (nm) return nm.trim();
  }
  if (tag === "img") {
    const alt = el.getAttribute("alt");
    if (alt) return alt.trim();
  }
  const title = el.getAttribute("title");
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  if (text) return clip(text, 120);
  if (title) return title.trim();
  return "";
}

export function roleOf(el) {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === "a") return "link";
  if (tag === "button" || tag === "summary") return "button";
  if (tag === "textarea") return "textbox";
  if (tag === "select") return "combobox";
  if (tag === "details") return "group";
  if (tag === "input") {
    const type = el.type;
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "button" || type === "submit" || type === "reset") return "button";
    if (type === "search") return "searchbox";
    if (type === "file") return "file";
    if (type === "range") return "slider";
    return "textbox";
  }
  if (el.getAttribute("contenteditable") != null) return "textbox";
  return "control";
}

function stateOf(el) {
  const flags = [];
  if (el.disabled) flags.push("disabled");
  const tag = el.tagName.toLowerCase();
  if (tag === "input") {
    if (el.type === "checkbox" || el.type === "radio") flags.push(el.checked ? "checked" : "unchecked");
    else if (el.value) flags.push(valueFlag(el.value));
  } else if (tag === "textarea" && el.value) {
    flags.push(valueFlag(el.value));
  }
  const expanded = el.getAttribute("aria-expanded");
  if (expanded) flags.push(`expanded=${expanded}`);
  const pressed = el.getAttribute("aria-pressed");
  if (pressed) flags.push(`pressed=${pressed}`);
  const selected = el.getAttribute("aria-selected");
  if (selected) flags.push(`selected=${selected}`);
  return flags.length ? flags.join(" ") : undefined;
}

/** Report a value, and say so when the print is only a preview. */
function valueFlag(value) {
  if (value.length <= VALUE_PREVIEW) return `value=${JSON.stringify(value)}`;
  return (
    `value=${JSON.stringify(value.slice(0, VALUE_PREVIEW))} ` +
    `(${value.length} chars, preview truncated — the field kept all of it)`
  );
}

function isHidden(el) {
  if (el.closest("[hidden]")) return true;
  if (el.closest('[aria-hidden="true"]')) return true;
  const inline = el.style;
  if (inline && (inline.display === "none" || inline.visibility === "hidden")) return true;
  if (typeof getComputedStyle === "function") {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return true;
  }
  return false;
}

function cssEscape(v) {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(v) : v.replace(/["\\]/g, "\\$&");
}

function clip(s, n) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
