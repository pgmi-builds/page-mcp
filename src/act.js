/**
 * Interaction — turning "the model said click e7" into what a real hand does.
 *
 * Every function here exists because the naive version silently fails on a
 * class of real UI:
 *
 *   - `el.click()` fires only `click`. Anything that opens on `pointerdown`
 *     (Radix menus/selects/popovers) never opens, and the agent loops on a
 *     menu that never appears. -> synthClick dispatches the full sequence.
 *   - Assigning `input.value` is swallowed by React's patched value setter.
 *     -> setNativeValue writes through the prototype descriptor.
 *   - Setting `.value` directly does not update a controlled component's
 *     state, and firing only `input` misses validators.
 *     -> both `input` and `change` are dispatched.
 */

import { adopt } from "./style.js";

/** Full pointer/mouse sequence, then the native click for activation behavior. */
export function synthClick(el) {
  const rect = el.getBoundingClientRect();
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: rect.x + rect.width / 2,
    clientY: rect.y + rect.height / 2,
    button: 0,
    pointerId: 1,
    isPrimary: true,
    pointerType: "mouse",
  };
  const Pointer = typeof PointerEvent !== "undefined" ? PointerEvent : MouseEvent;
  el.dispatchEvent(new Pointer("pointerover", init));
  el.dispatchEvent(new MouseEvent("mouseover", init));
  el.dispatchEvent(new Pointer("pointerdown", { ...init, buttons: 1 }));
  el.dispatchEvent(new MouseEvent("mousedown", { ...init, buttons: 1 }));
  el.dispatchEvent(new Pointer("pointerup", { ...init, buttons: 0 }));
  el.dispatchEvent(new MouseEvent("mouseup", { ...init, buttons: 0 }));
  el.click();
}

export function hover(el) {
  const rect = el.getBoundingClientRect();
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: rect.x + rect.width / 2,
    clientY: rect.y + rect.height / 2,
    pointerId: 1,
    isPrimary: true,
    pointerType: "mouse",
  };
  const Pointer = typeof PointerEvent !== "undefined" ? PointerEvent : MouseEvent;
  el.dispatchEvent(new Pointer("pointerover", init));
  el.dispatchEvent(new MouseEvent("mouseover", init));
  el.dispatchEvent(new MouseEvent("mousemove", init));
}

export function fillElement(el, value) {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.focus?.();
    setNativeValue(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  if (el.isContentEditable) {
    el.focus?.();
    el.textContent = value;
    el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    return;
  }
  throw new Error("element is not fillable (expected input, textarea, or contenteditable)");
}

/** Type as a user does: focus, then per-character key events + value growth. */
export function typeInto(el, text) {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable)) {
    throw new Error("element is not typable (expected input, textarea, or contenteditable)");
  }
  el.focus?.();
  for (const ch of text) {
    const keyInit = { key: ch, bubbles: true, cancelable: true, composed: true };
    el.dispatchEvent(new KeyboardEvent("keydown", keyInit));
    el.dispatchEvent(new KeyboardEvent("keypress", keyInit));
    if (el.isContentEditable) el.textContent = (el.textContent ?? "") + ch;
    else setNativeValue(el, (el.value ?? "") + ch);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, data: ch, inputType: "insertText" }));
    el.dispatchEvent(new KeyboardEvent("keyup", keyInit));
  }
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

export function pressKey(el, key) {
  const target = el ?? document.activeElement ?? document.body;
  const init = { key, code: codeFor(key), bubbles: true, cancelable: true, composed: true };
  target.dispatchEvent(new KeyboardEvent("keydown", init));
  target.dispatchEvent(new KeyboardEvent("keypress", init));
  target.dispatchEvent(new KeyboardEvent("keyup", init));
  // Enter on a form control should submit; Space/Enter on a button should click.
  if (key === "Enter" || key === " ") {
    if (target instanceof HTMLElement && target.tagName === "BUTTON") target.click();
  }
}

export function selectOption(el, value) {
  if (!(el instanceof HTMLSelectElement)) throw new Error("element is not a <select>");
  const match = [...el.options].find(
    (o) => o.value === value || o.label === value || (o.textContent ?? "").trim() === value,
  );
  if (!match) {
    const available = [...el.options].map((o) => o.value || o.label).join(", ");
    throw new Error(`no option matching ${JSON.stringify(value)}; available: ${available}`);
  }
  el.value = match.value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

export function scrollBy(dx, dy) {
  window.scrollBy(dx, dy);
  return `scrolled to y=${Math.round(window.scrollY)}`;
}

export function scrollIntoView(el) {
  el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
}

/**
 * Flash a box over the element so a human watching the browser can see what
 * the agent just touched. Purely visual; lives in a top-layer overlay so page
 * CSS cannot hide it.
 */
/**
 * Flash a box over the element so a human watching the browser can see what the
 * agent just touched.
 *
 * Geometry changes per call, and inline styles are blocked on any page with a
 * strict style-src — so the boxes are positioned by rewriting a constructable
 * stylesheet (one class per live box) and faded with the Web Animations API,
 * neither of which CSP governs.
 */
let overlayHost = null;
let overlayRoot = null;
let geomSheet = null;
const live = new Map();
let boxSeq = 0;

function ensureOverlay() {
	if (overlayHost) return;
	// The host element itself needs positioning, and it lives in the document
	// tree, so its rule goes on the document's adopted sheets.
	adopt(document, '[data-dev-webmcp="highlight"]{position:fixed;inset:0;pointer-events:none;z-index:2147483647}');
	overlayHost = document.createElement("div");
	overlayHost.setAttribute("data-dev-webmcp", "highlight");
	overlayRoot = overlayHost.attachShadow({ mode: "open" });
	adopt(overlayRoot, ".box{position:fixed;outline:2px solid #ffa245;background:rgba(255,162,69,.18);border-radius:2px}");
	geomSheet = adopt(overlayRoot, "");
	document.body.appendChild(overlayHost);
}

function paintGeometry() {
	if (!geomSheet) return;
	geomSheet.replaceSync(
		[...live.entries()]
			.map(([cls, r]) => `.${cls}{left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px}`)
			.join("\n"),
	);
}

export function highlight(el, ms = 900) {
	if (!document.body) return;
	ensureOverlay();
	const r = el.getBoundingClientRect();
	const cls = `b${++boxSeq}`;
	const box = document.createElement("div");
	box.className = `box ${cls}`;
	if (!geomSheet) {
		// No adoptedStyleSheets (Safari < 16.4). Best effort — such engines are
		// unlikely to be the ones enforcing a strict style-src.
		box.setAttribute(
			"style",
			`position:fixed;left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px`,
		);
	}
	live.set(cls, r);
	paintGeometry();
	overlayRoot.appendChild(box);

	const drop = () => {
		live.delete(cls);
		paintGeometry();
		box.remove();
	};
	try {
		const anim = box.animate([{ opacity: 1 }, { opacity: 0 }], {
			duration: 320,
			delay: ms,
			fill: "forwards",
		});
		anim.addEventListener("finish", drop);
	} catch {
		/* web animations unavailable */
	}
	setTimeout(drop, ms + 1500);
}

/** Write through the prototype setter so React/Vue controlled inputs notice. */
export function setNativeValue(el, value) {
  const proto = Object.getPrototypeOf(el);
  const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
  if (descriptor?.set) descriptor.set.call(el, value);
  else el.value = value;
}

function codeFor(key) {
  if (key.length === 1 && /[a-zA-Z]/.test(key)) return `Key${key.toUpperCase()}`;
  if (key.length === 1 && /[0-9]/.test(key)) return `Digit${key}`;
  return key;
}
