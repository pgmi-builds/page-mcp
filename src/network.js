/**
 * In-page capture of network activity: fetch, XMLHttpRequest and sendBeacon.
 *
 * Same reasoning as capture.js. A CDP-based tool only sees this while the agent
 * holds the session; patching in the page means the buffer survives in-page
 * navigation, works with no devtools attached, AND can tell you *who* made the
 * request — the initiator call site. That last part is the reason to do it
 * in-page rather than reading CDP Network events: CDP gives you the request,
 * this gives you `src/api.ts:44`.
 *
 * A failure the UI swallowed is the single most common thing an agent has to
 * debug ("I clicked save, nothing happened"), and it is invisible in a snapshot
 * and invisible in the console. It is only visible here.
 *
 * NOT captured: WebSocket and EventSource frames. They are long-lived streams,
 * not request/response pairs, and the cost of intercepting them is not worth it
 * for this job. The tool description says so rather than pretending.
 */

const RING_MAX = 200;
const MAX_BODY = 2000;

/** @type {Array<object>} */
const ring = [];
let seq = 0;
let installed = false;

/** Our own script URL, so the initiator stack can skip our own frame. */
let selfUrl = null;

function push(rec) {
  ring.push(rec);
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
  return rec;
}

function truncate(s) {
  const str = String(s);
  return str.length > MAX_BODY ? str.slice(0, MAX_BODY) + `…(+${str.length - MAX_BODY} chars)` : str;
}

/** Only text-ish responses are worth keeping; a 40 MB video is not. */
function isTexty(contentType) {
  if (!contentType) return true;
  return /json|text|xml|javascript|urlencoded|graphql|html|csv/i.test(contentType);
}

/** A byte count the model can read at a glance. */
function size(n) {
  if (n == null || Number.isNaN(n)) return "";
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}kB`;
  return `${(n / 1048576).toFixed(1)}MB`;
}

/**
 * The call site that made the request. Two frames are dropped: the Error
 * constructor and our own wrapper. In the built bundle our wrapper lives in
 * the same file as everything else, so we match on the script URL we were
 * loaded from rather than on a filename.
 */
function initiatorStack() {
  try {
    const lines = String(new Error().stack ?? "").split("\n").slice(1);
    for (const line of lines) {
      const at = line.trim();
      if (!at.startsWith("at ")) continue;
      if (selfUrl && at.includes(selfUrl)) continue;
      if (at.includes("__devWebmcp")) continue;
      // `at fn (url:line:col)` -> `url:line:col`, or `at url:line:col`
      const m = at.match(/\(([^)]+)\)\s*$/) ?? at.match(/at\s+(.+)$/);
      const loc = m ? m[1] : at.slice(3);
      if (!loc || loc.includes("<anonymous>")) continue;
      return formatLocation(loc);
    }
  } catch {
    /* stacks are best-effort */
  }
  return null;
}

/**
 * Turn a raw stack frame into `path:line:col`.
 *
 * Page code should read like source (`/src/api.ts:44:12`), not like a URL. Code
 * injected by the agent's own devtools connection has no meaningful URL at all,
 * so naming it beats printing a 200-character percent-encoded blob.
 */
function formatLocation(raw) {
  const m = raw.match(/^(.*):(\d+):(\d+)$/);
  if (!m) return raw.length > 120 ? raw.slice(0, 120) + "…" : raw;
  const [, url, line, col] = m;
  if (/^(pptr:|data:|blob:|eval\b|about:)/i.test(url)) return `(agent-injected script):${line}:${col}`;
  try {
    const u = new URL(url);
    const where = u.origin === location.origin ? u.pathname : `${u.host}${u.pathname}`;
    return `${where}:${line}:${col}`;
  } catch {
    return `${url.length > 90 ? url.slice(0, 90) + "…" : url}:${line}:${col}`;
  }
}

function absolute(url) {
  try {
    return new URL(String(url), location.href).href;
  } catch {
    return String(url);
  }
}

function patchFetch(w) {
  const orig = w.fetch;
  if (typeof orig !== "function") return;
  w.fetch = function(input, init) {
    let url = "";
    let method = "GET";
    try {
      if (typeof input === "string" || input instanceof URL) {
        url = String(input);
      } else if (input && typeof input === "object") {
        url = input.url ?? "";
        if (input.method) method = String(input.method);
      }
      if (init?.method) method = String(init.method);
    } catch {
      /* never let bookkeeping break the request */
    }

    const rec = push({
      id: ++seq,
      kind: "fetch",
      method: method.toUpperCase(),
      url: absolute(url),
      startedAt: Date.now(),
      ms: null,
      status: null,
      ok: null,
      failed: false,
      error: null,
      contentType: null,
      bytes: null,
      reqBody: null,
      resBody: null,
      initiator: initiatorStack(),
    });

    try {
      if (typeof init?.body === "string") rec.reqBody = truncate(init.body);
    } catch {
      /* ignore */
    }

    const startedAt = performance.now();
    let promise;
    try {
      promise = orig.apply(this, arguments);
    } catch (e) {
      // A synchronous throw (bad Request object) still counts as a failed call.
      rec.failed = true;
      rec.ms = Math.round(performance.now() - startedAt);
      rec.error = `${e?.name ?? "Error"}: ${e?.message ?? e}`;
      throw e;
    }

    return promise.then(
      (res) => {
        try {
          rec.status = res.status;
          rec.ok = res.ok;
          rec.ms = Math.round(performance.now() - startedAt);
          rec.contentType = res.headers?.get?.("content-type") ?? null;
          // `Number(null)` is 0, which is how a missing header became "0B".
          const cl = res.headers?.get?.("content-length");
          const len = cl == null ? NaN : Number(cl);
          rec.bytes = Number.isFinite(len) ? len : null;
          // Cloning costs a copy of the body; skip it when it is obviously big.
          const capped = rec.bytes == null || rec.bytes <= 256 * 1024;
          if (capped && isTexty(rec.contentType)) {
            res
              .clone()
              .text()
              .then((t) => {
                rec.resBody = truncate(t);
                if (rec.bytes == null) rec.bytes = t.length;
              })
              .catch(() => {
                /* body already consumed elsewhere — not our problem */
              });
          } else if (capped && rec.bytes == null) {
            // A binary body with no content-length header. Measure it so that
            // "the image loaded but is 0 bytes" is visible; the clone is
            // dropped as soon as we have the count.
            res
              .clone()
              .arrayBuffer()
              .then((b) => {
                rec.bytes = b.byteLength;
              })
              .catch(() => {});
          }
        } catch {
          /* ignore */
        }
        return res;
      },
      (err) => {
        try {
          rec.failed = true;
          rec.ms = Math.round(performance.now() - startedAt);
          rec.error = `${err?.name ?? "Error"}: ${err?.message ?? err}`;
        } catch {
          /* ignore */
        }
        throw err;
      },
    );
  };
}

function patchXhr(w) {
  const XHR = w.XMLHttpRequest;
  if (!XHR?.prototype) return;
  const origOpen = XHR.prototype.open;
  const origSend = XHR.prototype.send;

  XHR.prototype.open = function(method, url, ...rest) {
    try {
      this.__devNet = {
        id: ++seq,
        kind: "xhr",
        method: String(method ?? "GET").toUpperCase(),
        url: absolute(url),
        startedAt: Date.now(),
        ms: null,
        status: null,
        ok: null,
        failed: false,
        error: null,
        contentType: null,
        bytes: null,
        reqBody: null,
        resBody: null,
        initiator: initiatorStack(),
      };
    } catch {
      /* ignore */
    }
    return origOpen.apply(this, [method, url, ...rest]);
  };

  XHR.prototype.send = function(body) {
    const rec = this.__devNet;
    if (rec) {
      try {
        rec.startedAt = Date.now();
        if (typeof body === "string") rec.reqBody = truncate(body);
        push(rec);
        const startedAt = performance.now();
        this.addEventListener(
          "loadend",
          () => {
            try {
              rec.ms = Math.round(performance.now() - startedAt);
              rec.status = this.status;
              rec.ok = this.status >= 200 && this.status < 300;
              rec.contentType = this.getResponseHeader?.("content-type") ?? null;
              if (this.status === 0) {
                rec.failed = true;
                rec.error = "status 0 — network error, CORS block, or aborted";
              }
              const type = this.responseType;
              if (type === "" || type === "text") {
                if (isTexty(rec.contentType)) {
                  const text = this.responseText ?? "";
                  rec.resBody = truncate(text);
                  rec.bytes = text.length;
                }
              } else if (type === "json") {
                rec.resBody = truncate(JSON.stringify(this.response));
              }
            } catch {
              /* ignore */
            }
          },
          { once: true },
        );
      } catch {
        /* ignore */
      }
    }
    return origSend.apply(this, arguments);
  };
}

function patchBeacon(w) {
  const orig = w.navigator?.sendBeacon;
  if (typeof orig !== "function") return;
  w.navigator.sendBeacon = function(url, data) {
    try {
      push({
        id: ++seq,
        kind: "beacon",
        method: "POST",
        url: absolute(url),
        startedAt: Date.now(),
        ms: null,
        status: null,
        ok: null,
        failed: false,
        error: null,
        contentType: null,
        bytes: null,
        reqBody: typeof data === "string" ? truncate(data) : null,
        resBody: null,
        initiator: initiatorStack(),
      });
    } catch {
      /* ignore */
    }
    return orig.apply(this, arguments);
  };
}

function patch(w) {
  if (!w || w.__devWebmcpNetPatched) return;
  try {
    w.__devWebmcpNetPatched = true;
  } catch {
    return;
  }
  try {
    patchFetch(w);
    patchXhr(w);
    patchBeacon(w);
  } catch {
    /* a page that froze these keeps working; we just see less */
  }
}

/** Patch this window plus every same-origin iframe we can reach, now and later. */
export function installNetwork() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  try {
    selfUrl = document.currentScript?.src ?? null;
  } catch {
    selfUrl = null;
  }
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
  new MutationObserver(patchFrames).observe(document.documentElement, { childList: true, subtree: true });
}

const clock = (t) => new Date(t).toISOString().slice(11, 23);

function statusCell(r) {
  if (r.failed) return "FAIL";
  if (r.status === null) return "··· ";
  return String(r.status).padEnd(4);
}

function line(r) {
  const url = r.url.length > 160 ? r.url.slice(0, 160) + "…" : r.url;
  const bits = [
    `[${clock(r.startedAt)}]`,
    statusCell(r),
    r.method.padEnd(5),
    url,
    r.ms == null ? "" : `${r.ms}ms`,
    size(r.bytes),
  ].filter(Boolean);
  let out = bits.join(" ");
  if (r.failed && r.error) out += `\n    error  ${r.error}`;
  if (r.initiator) out += `\n    at     ${r.initiator}`;
  return out;
}

export function readNetwork({ limit = 20, filter, failedOnly = false, includeBodies = false } = {}) {
  const n = Math.min(Math.max(Number(limit) || 20, 1), 200);
  const failedAll = ring.filter((r) => r.failed || (r.status != null && r.status >= 400)).length;

  let rows = ring;
  if (failedOnly) rows = rows.filter((r) => r.failed || (r.status != null && r.status >= 400));
  if (filter) {
    const f = String(filter);
    let rx = null;
    try {
      rx = new RegExp(f, "i");
    } catch {
      rx = null;
    }
    rows = rx
      ? rows.filter((r) => rx.test(r.url))
      : rows.filter((r) => r.url.toLowerCase().includes(f.toLowerCase()));
  }

  const clauses = [`${rows.length} of ${ring.length} captured`];
  if (failedAll) clauses.push(`${failedAll} failed`);
  if (filter) clauses.push(`filter ${JSON.stringify(String(filter))}`);
  if (failedOnly) clauses.push("failures only");
  const head = clauses.join(" · ");

  const slice = rows.slice(-n);
  if (!slice.length) {
    return `(no matching requests) — ${head}. Requests are only captured after this script loads; ` +
      `a page that fetched before that will not appear.`;
  }

  const body = slice.map((r) => {
    let out = line(r);
    if (includeBodies) {
      if (r.reqBody) out += `\n    req    ${r.reqBody}`;
      if (r.resBody) out += `\n    res    ${r.resBody}`;
    }
    return out;
  });

  const shown = rows.length > n ? ` (showing the last ${n} of ${rows.length} matching)` : "";
  return `${head}${shown}\n${body.join("\n")}`;
}

export function clearNetwork() {
  ring.length = 0;
  return "cleared";
}

export function networkCount() {
  return ring.length;
}
