/**
 * Geometry: what the layout itself can prove, without a single pixel.
 *
 * A screenshot shows what a page looks like; these checks show what is
 * *measurably wrong* with it — text that is clipped, a control that cannot be
 * hit, an image that failed to decode. They are computed from the box tree and
 * computed styles, so they are assertions rather than impressions, and they
 * cost nothing to run.
 *
 * The other half of this module, `boxOf`, is the contract for element-scoped
 * screenshots. A page cannot rasterize itself (docs/07 §3.1: toDataURL on a
 * WebGL canvas outside the frame returns a *valid but all-black* PNG), so the
 * pixels belong to the agent's CDP layer — but the CDP side needs coordinates,
 * and viewport-vs-document confusion is how an agent crops the wrong element.
 * This hands over both, plus the hit-test result, because the three most common
 * ways an element "cannot be clicked" are disabled, pointer-events:none and
 * genuinely covered — and they have different fixes.
 *
 * Hit-testing rules (each one paid for by a false positive on this very demo):
 *   - walk `elementsFromPoint`, not `elementFromPoint`: a disabled control's
 *     centre can report its PARENT as the top element;
 *   - an ancestor in the stack is not an occluder;
 *   - the element's own disabled / pointer-events:none is not occlusion either,
 *     it is `hitTestable: false` — a different bug with a different fix.
 */

import { INTERACTIVE_SELECTOR } from "./snapshot.js";

const ownText = (el) => {
  let s = "";
  for (const n of el.childNodes) if (n.nodeType === 3) s += n.textContent;
  return s.replace(/\s+/g, " ").trim();
};

const round2 = (n) => +n.toFixed(2);

export function boxOf(el) {
  const r = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const stack = r.width > 0 && r.height > 0 ? document.elementsFromPoint(cx, cy) : [];

  const disabled = el.disabled === true || el.getAttribute?.("aria-disabled") === "true";
  const peNone = style.pointerEvents === "none";
  const top = stack[0];
  const hitTestable = !disabled && !peNone && top !== undefined && (top === el || el.contains(top));
  const occluder = stack.find((s) => s !== el && !el.contains(s) && !s.contains(el));

  const ix = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
  const iy = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
  const area = r.width * r.height;

  return {
    viewportRect: { x: round2(r.x), y: round2(r.y), w: round2(r.width), h: round2(r.height) },
    // CDP's Page.captureScreenshot takes DOCUMENT coordinates. Getting this
    // wrong crops the neighbour, which is the failure the agent cannot see.
    documentRect: {
      x: round2(r.x + scrollX),
      y: round2(r.y + scrollY),
      w: round2(r.width),
      h: round2(r.height),
    },
    devicePixelRatio: devicePixelRatio,
    scroll: { x: Math.round(scrollX), y: Math.round(scrollY) },
    visibleFraction: area > 0 ? round2((ix * iy) / area) : 0,
    // Fraction of the viewport only. An element inside an inner scroll
    // container can be further clipped by it; scrollWidth/Height in the audit
    // catches that case separately.
    hitTestable,
    disabled,
    pointerEvents: style.pointerEvents,
    coveredBy: hitTestable || occluder === undefined ? null : describeEl(occluder),
    isCanvas: el.tagName === "CANVAS",
  };
}

function describeEl(el) {
  const name = el.id ? `#${el.id}` : "";
  return `${el.tagName.toLowerCase()}${name}`;
}

/**
 * Scan for visual defects that do not need pixels to prove. Returns categories
 * with counts and a few example elements each; the caller attaches refs.
 *
 * Deliberately NOT here: contrast (needs real rendering), z-index wars
 * (needs paint order), anything about how it looks. Those are pixel questions.
 */
export function auditGeometry({ maxExamples = 4, maxNodes = 6000 } = {}) {
  const found = new Map();
  const add = (kind, el, why) => {
    if (!found.has(kind)) found.set(kind, []);
    if (found.get(kind).length < maxExamples) found.get(kind).push({ el, why });
  };

  let scanned = 0;
  let overflowX = false;
  for (const el of document.body.querySelectorAll("*")) {
    if (++scanned > maxNodes) break;

    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") continue;

    // 1. text the layout could not fit
    const text = ownText(el);
    if (text && el.scrollWidth > el.clientWidth + 1) {
      add("clipped-text", el, `"${text.slice(0, 60)}" needs ${el.scrollWidth}px in ${el.clientWidth}px`);
    }

    // 2. an interactive element with no box — unclickable by construction
    if (el.matches(INTERACTIVE_SELECTOR)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) add("zero-size", el, "interactive but 0x0");
    }

    // 3. an image that failed to decode
    if (el.tagName === "IMG" && el.complete && el.naturalWidth === 0 && el.getAttribute("src")) {
      add("broken-image", el, `src ${el.getAttribute("src").slice(0, 80)}`);
    }
  }

  const page = [];
  const doc = document.documentElement;
  if (doc.scrollWidth > innerWidth + 1) {
    page.push(`the page scrolls sideways: scrollWidth ${doc.scrollWidth} > viewport ${innerWidth}`);
  }
  if (document.fonts?.status === "loading") page.push("web fonts are still loading — text metrics are provisional");
  const pending = [...document.images].filter((i) => i.src && !i.complete).length;
  if (pending) {
    page.push(
      `${pending} image(s) still loading — a broken-image result from this run may be incomplete; re-run once they settle`,
    );
  }

  return {
    scanned,
    categories: [...found.entries()].map(([kind, examples]) => ({ kind, count: examples.length, examples })),
    page,
  };
}
