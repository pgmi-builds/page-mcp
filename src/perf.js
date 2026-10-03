/**
 * Performance facts a page can measure about itself.
 *
 * Deliberately narrower than chrome-devtools-mcp's tracing tools: a trace is a
 * recording you analyse afterwards and belongs to the browser process. This is
 * the "is it slow, and where roughly" answer, available in-page with no
 * session — long tasks, cumulative layout shift, LCP, paint timings, resource
 * totals, and a live frame-rate sample.
 *
 * Everything here comes from PerformanceObserver with `buffered: true`, so
 * entries that fired before the call still show up. Each observer is started in
 * its own try/catch because entry types are not uniformly supported and one
 * unsupported type must not cost the rest of the report.
 */

function buffered(type) {
  return new Promise((resolve) => {
    try {
      const obs = new PerformanceObserver((list) => {
        obs.disconnect();
        resolve(list.getEntries());
      });
      obs.observe({ type, buffered: true });
      // Some engines accept the observe call and never deliver; do not hang.
      setTimeout(() => resolve([]), 250);
    } catch {
      resolve([]);
    }
  });
}

const ms = (n) => (n == null ? null : +n.toFixed(1));

export async function perfSnapshot({ frames = 12 } = {}) {
  const [paint, lcp, longtasks, shifts, nav] = await Promise.all([
    buffered("paint"),
    buffered("largest-contentful-paint"),
    buffered("longtask"),
    buffered("layout-shift"),
    buffered("navigation"),
  ]);

  const out = {};

  const fcp = paint.find((e) => e.name === "first-contentful-paint");
  out.firstContentfulPaintMs = ms(fcp?.startTime);
  const lcpEntry = lcp.length ? lcp[lcp.length - 1] : null;
  out.largestContentfulPaintMs = ms(lcpEntry?.startTime);
  // LCP is defined as the largest paint SO FAR, so in a long-lived session it
  // keeps updating — an upload that renders a big canvas at t=4min becomes the
  // new LCP and reads as an absurd load time. Say which paint it is.
  if (lcpEntry && lcpEntry.startTime > 10000) {
    out.lcpNote = `LCP is a paint from t=${ms(lcpEntry.startTime)}s after load, not from page load — ` +
      `in a long-lived session it tracks the newest large render, not load quality`;
  }

  const slow = longtasks.filter((t) => t.duration >= 50);
  out.longTasks = {
    count: slow.length,
    totalMs: ms(slow.reduce((s, t) => s + t.duration, 0)),
    worstMs: ms(slow.reduce((w, t) => Math.max(w, t.duration), 0)),
    // attribution is per-container; the closest honest wording is "somewhere on
    // this document", which is why the tool also samples frames live
  };

  let cls = 0;
  for (const s of shifts) if (!s.hadRecentInput) cls += s.value;
  out.cumulativeLayoutShift = +cls.toFixed(4);

  const n = nav[0];
  if (n) {
    out.navigation = {
      type: n.type,
      domContentLoadedMs: ms(n.domContentLoadedEventEnd - n.startTime),
      loadMs: ms(n.loadEventEnd - n.startTime),
      transferSizeKB: n.transferSize ? +(n.transferSize / 1024).toFixed(1) : 0,
    };
  }

  const res = performance.getEntriesByType?.("resource") ?? [];
  if (res.length) {
    const byDuration = [...res].sort((a, b) => b.duration - a.duration).slice(0, 5);
    out.resources = {
      count: res.length,
      totalTransferKB: +(res.reduce((s, e) => s + (e.transferSize || 0), 0) / 1024).toFixed(1),
      slowest: byDuration.map((e) => `${e.initiatorType} ${e.name.split("/").pop().slice(0, 40)} ${ms(e.duration)}ms`),
    };
  }

  try {
    const mem = performance.memory;
    if (mem) {
      out.heapMB = {
        used: +(mem.usedJSHeapSize / 1048576).toFixed(1),
        limit: +(mem.jsHeapSizeLimit / 1048576).toFixed(0),
      };
    }
  } catch {
    /* memory is Chromium-only */
  }

  // A live frame-rate sample: the honest way to say "is it janky NOW", which no
  // buffered entry can tell you because it only knows about the past.
  out.frameSample = await new Promise((resolve) => {
    const gaps = [];
    let last = performance.now();
    let done = 0;
    const tick = (now) => {
      gaps.push(now - last);
      last = now;
      if (++done >= Math.min(Math.max(Number(frames) || 12, 4), 60)) {
        const avg = gaps.reduce((s, g) => s + g, 0) / gaps.length;
        const worst = Math.max(...gaps);
        resolve({
          frames: gaps.length,
          avgFps: +(1000 / avg).toFixed(1),
          worstGapMs: ms(worst),
          note: worst > 50 ? "a frame took long enough to be visible as a stutter" : "no visible stutters in the sample",
        });
      } else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  return out;
}
