/**
 * Storage inspection and mutation for the page's own origin: localStorage,
 * sessionStorage and document.cookie.
 *
 * Why in-page: this is the state that makes a UI behave differently for the
 * developer than for a fresh user — a stale feature flag, a half-written draft,
 * a token the app cached and refuses to refresh. A DOM snapshot cannot show it,
 * and a CDP-based tool only reaches it while the agent holds the session.
 *
 * Boundaries, stated rather than papered over:
 *   - `document.cookie` cannot read HttpOnly cookies (by design) and sees only
 *     this origin's. HttpOnly is a job for CDP `Network.getCookies`.
 *   - Cookies set with a non-root `path` cannot be overwritten or cleared from
 *     here, because a cookie is only writable on its own path.
 *   - IndexedDB is listed (name + version) but not read or written. Its API is
 *     async, per-database and versioned; that is a tool of its own, not a branch
 *     of this one.
 *   - Values are strings. Structured values should be JSON.stringify'd before
 *     they are set, and parsed after they are read.
 */

const LIST_VALUE_MAX = 120;

function areaOf(area) {
  if (area === "session") return window.sessionStorage;
  if (area === "local") return window.localStorage;
  return null; // cookies are not a Storage object
}

function clip(s, n = LIST_VALUE_MAX) {
  const str = String(s);
  return str.length > n ? str.slice(0, n) + `…(+${str.length - n} chars)` : str;
}

function cookiePairs() {
  const raw = document.cookie;
  if (!raw) return [];
  return raw
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const i = p.indexOf("=");
      return i === -1 ? { name: p, value: "" } : { name: p.slice(0, i), value: p.slice(i + 1) };
    });
}

function listLines(entries) {
  if (!entries.length) return "(empty)";
  const bytes = entries.reduce((n, e) => n + e.name.length + e.value.length, 0);
  const rows = entries.map((e) => `${e.name} = ${clip(e.value)}`);
  return `${entries.length} entr${entries.length === 1 ? "y" : "ies"}, ${bytes} chars stored\n${rows.join("\n")}`;
}

export function storageOp({ area = "local", action = "list", key, value } = {}) {
  const where = String(area ?? "local");

  if (where === "cookie") {
    if (action === "list") return listLines(cookiePairs().map((c) => ({ name: c.name, value: c.value })));
    if (!key) throw new Error(`storage ${action} needs a "key" (a cookie name).`);
    if (action === "get") {
      const hit = cookiePairs().find((c) => c.name === key);
      if (!hit) {
        return `(no cookie named ${JSON.stringify(key)} readable here). Note: HttpOnly cookies are ` +
          `invisible to document.cookie — read those from CDP if you need them.`;
      }
      return hit.value;
    }
    if (action === "set") {
      if (value === undefined) throw new Error(`storage set needs a "value".`);
      document.cookie = `${key}=${value}; path=/`;
      return `set cookie ${JSON.stringify(key)} (${String(value).length} chars, path=/). If the app re-reads it on ` +
        `the next request only, a reload may be needed before the UI reflects it.`;
    }
    if (action === "remove") {
      // Path must match the one it was set with; a root-path clear is the best
      // a page can do, and it is also what most apps use.
      document.cookie = `${key}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
      const gone = !cookiePairs().some((c) => c.name === key);
      return gone
        ? `removed cookie ${JSON.stringify(key)}.`
        : `sent an expiry for ${JSON.stringify(key)} at path=/ but it is still readable — it was probably set ` +
        `on a narrower path or is HttpOnly. Clear those from CDP.`;
    }
    if (action === "clear") {
      const names = cookiePairs().map((c) => c.name);
      for (const n of names) document.cookie = `${n}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
      const left = cookiePairs().length;
      return `cleared ${names.length - left} of ${names.length} readable cookies. Cookies on non-root paths or ` +
        `HttpOnly ones survive; use CDP for those.`;
    }
    throw new Error(`unknown action ${JSON.stringify(action)}`);
  }

  const store = areaOf(where);
  if (!store) throw new Error(`unknown area ${JSON.stringify(where)} — expected "local", "session" or "cookie".`);

  if (action === "list") {
    const entries = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      entries.push({ name: k, value: store.getItem(k) ?? "" });
    }
    return listLines(entries);
  }

  if (!key) throw new Error(`storage ${action} needs a "key".`);

  if (action === "get") {
    const v = store.getItem(key);
    if (v === null) {
      const near = [];
      for (let i = 0; i < store.length; i++) near.push(store.key(i));
      const suggestion = near
        .filter((k) => k.toLowerCase().includes(String(key).toLowerCase().slice(0, 4)))
        .slice(0, 5);
      return (
        `(no ${where}Storage key ${JSON.stringify(key)})` +
        (suggestion.length ? ` — similar keys: ${suggestion.join(", ")}` : "") +
        (near.length ? `. ${near.length} key(s) exist; list them with action "list".` : " Storage is empty.")
      );
    }
    return v;
  }

  if (action === "set") {
    if (value === undefined) throw new Error(`storage set needs a "value" (a string; JSON.stringify structured data).`);
    const had = store.getItem(key) !== null;
    store.setItem(key, String(value));
    // Storage events only fire in OTHER windows, so the app will not notice a
    // change until it next reads the key. Say so instead of implying the UI
    // just updated.
    return `set ${where}Storage[${JSON.stringify(key)}] (${String(value).length} chars, ${had ? "overwrote" : "created"}). ` +
      `No storage event fires in this window — the app sees it on its next read or on reload.`;
  }

  if (action === "remove") {
    const had = store.getItem(key) !== null;
    store.removeItem(key);
    return had ? `removed ${where}Storage[${JSON.stringify(key)}].` : `${JSON.stringify(key)} was not set; nothing removed.`;
  }

  if (action === "clear") {
    const n = store.length;
    store.clear();
    return `cleared ${n} ${where}Storage key(s).`;
  }

  throw new Error(`unknown action ${JSON.stringify(action)} — expected list, get, set, remove or clear.`);
}
