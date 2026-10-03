/**
 * In-page record of what actually changed in the DOM, in order.
 *
 * The question this answers is "my action ran — what did it do?", and it is
 * surprisingly hard to answer with the tools a snapshot gives you: you take a
 * before-shot, act, take an after-shot, and diff them by eye. Two snapshots of
 * a busy page differ in a hundred irrelevant ways (clocks, cursors, animation
 * frames) and say nothing about ORDER — whether the list re-rendered before or
 * after the spinner went away is often the whole bug.
 *
 * So: a MutationObserver records change records continuously from the moment
 * the script loads, in a ring. `readChanges({ since })` returns what happened
 * after a token, so the natural loop is:
 *
 *   const { next } = readChanges();   // note where we are now
 *   ... do the action ...
 *   readChanges({ since: next });     // what the action caused, in order
 *
 * Self-noise is filtered: the indicator badge and the click highlight both live
 * under [data-dev-webmcp] hosts, and a highlight's geometry is painted inside a
 * shadow root this observer cannot see. An action that mutates the page still
 * shows up — that is the point.
 */

const RING_MAX = 300;
const DETAIL_MAX = 120;

const ring = [];
let seq = 0;
let installed = false;

function isOurs(el) {
  try {
    return !!(el && el.nodeType === 1 && el.closest?.("[data-dev-webmcp]"));
  } catch {
    return false;
  }
}

/** A stable-enough name for a node, captured NOW — nodes do not live forever. */
function label(node) {
  if (!node) return "(null)";
  if (node.nodeType === 3) return `text in ${node.parentElement?.tagName?.toLowerCase() ?? "?"}`;
  if (node.nodeType !== 1) return `#${node.nodeName ?? "?"}`;
  const tag = node.tagName.toLowerCase();
  const id = node.id ? `#${node.id}` : "";
  const cls =
    typeof node.className === "string" && node.className.trim()
      ? `.${node.className.trim().split(/\s+/).slice(0, 2).join(".")}`
      : "";
  return `${tag}${id}${cls}`;
}

function snippet(node) {
  try {
    const t = (node.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!t) return "";
    return t.length > DETAIL_MAX ? `"${t.slice(0, DETAIL_MAX)}…"` : `"${t}"`;
  } catch {
    return "";
  }
}

function push(rec) {
  rec.id = ++seq;
  ring.push(rec);
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
  return rec;
}

function onMutations(batch) {
  try {
    for (const m of batch) {
      if (m.type === "childList") {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1 || isOurs(n)) continue;
          // One appendChild arrives as a single record for the top node, so name
          // what came in with it — otherwise "added div" hides the button the
          // agent actually cares about.
          const kids = n.children ? [...n.children].slice(0, 3).map((c) => c.tagName.toLowerCase()) : [];
          // Show the children even when the parent has text: "added div —
          // \"onetwo\"" hides the two elements an agent would act on next.
          const withKids = kids.length ? ` (+${n.children.length}: ${kids.join(", ")})` : "";
          push({ t: Date.now(), kind: "added", target: label(n), detail: `${withKids} ${snippet(n)}`.trim() });
        }
        for (const n of m.removedNodes) {
          // The node is detached but still readable here — this callback is the
          // last chance to say what it was.
          if (n.nodeType !== 1 || isOurs(n)) continue;
          push({ t: Date.now(), kind: "removed", target: label(n), detail: snippet(n) });
        }
      } else if (m.type === "attributes") {
        if (isOurs(m.target)) continue;
        const v = m.target?.getAttribute?.(m.attributeName) ?? "";
        push({
          t: Date.now(),
          kind: "attr",
          target: label(m.target),
          detail: `${m.attributeName} = ${v.length > 80 ? v.slice(0, 80) + "…" : v || "(empty)"}`,
        });
      } else if (m.type === "characterData") {
        if (isOurs(m.target?.parentElement)) continue;
        push({ t: Date.now(), kind: "text", target: label(m.target), detail: snippet(m.target) });
      }
    }
  } catch {
    /* recording must never break the page */
  }
}

/** Watch this document. Shadow roots are their own trees and are not observed. */
export function installObserve() {
  if (installed || typeof MutationObserver === "undefined") return;
  const root = typeof document !== "undefined" ? document.documentElement : null;
  if (!root) return;
  installed = true;
  try {
    new MutationObserver(onMutations).observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
  } catch {
    installed = false;
  }
}

const clock = (t) => new Date(t).toISOString().slice(11, 23);

/**
 * Changes recorded after the token `since` (a `next` from an earlier call;
 * omit it to read the whole ring). Returns text plus the token to pass next
 * time — the caller should treat `next` as "where I am now".
 */
export function readChanges({ since = 0, limit = 40 } = {}) {
  const n = Math.min(Math.max(Number(limit) || 40, 1), 200);
  const rows = ring.filter((r) => r.id > (Number(since) || 0));
  const slice = rows.slice(-n);
  const next = ring.length ? ring[ring.length - 1].id : Number(since) || 0;

  if (!rows.length) {
    return {
      next,
      text:
        `(no recorded changes after #${Number(since) || 0}). The ring starts when the script loads and holds ` +
        `${RING_MAX} records — a very busy page can push older ones out.`,
    };
  }

  const head =
    `${rows.length} change(s) after #${Number(since) || 0}` +
    (rows.length > slice.length ? ` — showing the last ${slice.length}` : "") +
    ` · pass since: ${next} to read only newer ones`;

  const body = slice
    .map((r) => `[${clock(r.t)}] ${r.kind.padEnd(7)} ${r.target}${r.detail ? ` — ${r.detail}` : ""}`)
    .join("\n");

  return { next, text: `${head}\n${body}` };
}

export function changeCount() {
  return ring.length;
}
