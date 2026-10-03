/**
 * Styling that survives a Content Security Policy.
 *
 * Measured on Chrome 151, on a page served with
 * `default-src 'self'; script-src 'self'; style-src 'self'`:
 *
 *   <style> in a shadow root      -> blocked (computed style unchanged)
 *   element.style.x = ...         -> blocked (a violation is logged and the
 *                                    CSSOM write does not take effect)
 *   new CSSStyleSheet() +
 *     adoptedStyleSheets          -> WORKS
 *
 * So anything we draw into someone else's page uses a constructable
 * stylesheet. The `<style>` fallback is only for engines that lack
 * adoptedStyleSheets (Safari < 16.4), which by definition also tend not to be
 * the ones with a strict style-src in front of a dev server.
 */

const supported = typeof CSSStyleSheet !== "undefined" && "adoptedStyleSheets" in Document.prototype;

/**
 * Attach a stylesheet to a shadow root or document.
 * @returns {CSSStyleSheet|null} the live sheet, so the caller can rewrite it
 *   with `replaceSync` on later updates; null when the fallback was used.
 */
export function adopt(root, cssText) {
  if (supported) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(cssText);
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
      return sheet;
    } catch {
      /* fall through */
    }
  }
  const style = document.createElement("style");
  style.textContent = cssText;
  root.appendChild(style);
  return null;
}
