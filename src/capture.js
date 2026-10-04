/**
 * In-page capture of console output, uncaught errors and unhandled rejections.
 *
 * This is the half that CDP-based tools get "for free" but only while the agent
 * holds the CDP session. Doing it in-page means the buffer survives navigation
 * within the SPA, works when the agent does not own the browser, and is
 * available to the page's own tests.
 *
 * Patching must happen BEFORE the app logs anything, which is why the entry
 * point calls `installCapture()` as its first statement.
 */

const RING_MAX = 500;
const MAX_ARG = 2000;
const ring = [];

let installed = false;

function push(level, text) {
  ring.push({ t: Date.now(), level, text });
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
}

function repr(v, depth = 3, seen = new Set()) {
  try {
    if (v === null) return "null";
    if (v === undefined) return "undefined";
    const t = typeof v;
    if (t === "string") return v.length > 300 ? JSON.stringify(v.slice(0, 300)) + `…(${v.length})` : JSON.stringify(v);
    if (t === "number" || t === "boolean" || t === "bigint") return String(v);
    if (t === "function") return `ƒ ${v.name || "anonymous"}()`;
    if (t === "symbol") return v.toString();
    if (v instanceof Error) return `${v.name}: ${v.message}`;
    if (v.nodeType === 1) return `<${v.tagName.toLowerCase()}${v.id ? "#" + v.id : ""}>`;
    if (depth <= 0) return Array.isArray(v) ? "[…]" : "{…}";
    if (seen.has(v)) return "[Circular]";
    seen.add(v);
    if (Array.isArray(v)) {
      const head = v.slice(0, 40).map((x) => repr(x, depth - 1, seen)).join(", ");
      return `[${head}${v.length > 40 ? `, …(${v.length})` : ""}]`;
    }
    const keys = Object.keys(v);
    const head = keys.slice(0, 25).map((k) => `${k}: ${repr(v[k], depth - 1, seen)}`).join(", ");
    return `{ ${head}${keys.length > 25 ? ", …" : ""} }`;
  } catch {
    return String(v);
  }
}

const fmt = (args) => args.map((a) => (typeof a === "string" ? a : repr(a))).join(" ").slice(0, MAX_ARG);

function patch(w) {
  if (!w || w.__pageMcpPatched) return;
  try {
    w.__pageMcpPatched = true;
  } catch {
    return;
  }
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    const orig = w.console?.[level];
    if (typeof orig !== "function") continue;
    w.console[level] = (...args) => {
      push(level, fmt(args));
      orig.apply(w.console, args);
    };
  }
  w.addEventListener("error", (e) => {
    const where = e.filename ? ` (${e.filename}:${e.lineno}:${e.colno})` : "";
    push("uncaught", `${e.message}${where}`);
  });
  w.addEventListener("unhandledrejection", (e) => {
    push("unhandledrejection", repr(e?.reason ?? "unknown"));
  });
}

/** Patch this window plus every same-origin iframe we can reach, now and later. */
export function installCapture() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  patch(window);

  const patchFrames = () => {
    for (const frame of document.querySelectorAll("iframe")) {
      try {
        if (frame.contentWindow) patch(frame.contentWindow);
      } catch {
        /* cross-origin — out of reach, by design */
      }
    }
  };
  patchFrames();
  // iframes that appear later
  new MutationObserver(patchFrames).observe(document.documentElement, { childList: true, subtree: true });
}

export function readLogs({ level = "all", tail = 40, since } = {}) {
  let rows = ring;
  if (level && level !== "all") rows = rows.filter((r) => r.level === level);
  if (since) rows = rows.filter((r) => r.t > since);
  const n = Math.min(Math.max(Number(tail) || 40, 1), 200);
  const slice = rows.slice(-n);
  if (!slice.length) return `(no captured console output${level !== "all" ? ` at level=${level}` : ""})`;
  return slice
    .map((r) => `[${new Date(r.t).toISOString().slice(11, 23)}][${r.level}] ${r.text}`)
    .join("\n");
}

export function clearLogs() {
  ring.length = 0;
  return "cleared";
}

export function logCount() {
  return ring.length;
}
