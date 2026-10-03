/**
 * The ONLY module that touches the WebMCP standard surface.
 *
 * Why one file: WebMCP is a W3C Community Group draft, not a standard. Its IDL
 * has already moved once (`navigator.modelContext` -> `document.modelContext`,
 * webmachinelearning/webmcp#184) and it will move again. When it does, this
 * file changes and nothing else in the package does.
 *
 * Contract we target (Chrome imperative API, 2026-08):
 *   registerTool({name, description, inputSchema, execute, annotations},
 *                {signal, exposedTo})   -> Promise<undefined>
 *   getTools({fromOrigins})             -> Promise<RegisteredTool[]>
 *   executeTool(tool, inputArgsJson,
 *               {signal})               -> Promise<DOMString>   (null on navigation)
 *   execute(input, {signal})            -> the tool's result, serialized to a string
 *   lifecycle = AbortSignal (there is no unregisterTool)
 */
import { initializeWebMCPPolyfill } from "@mcp-b/webmcp-polyfill";

/** Local source of truth. Kept even when modelContext exists, so tools stay
 *  callable from page JS (and from our own harness) without a round trip. */
const local = new Map();

let booted = false;
let nativeAtBoot = false;
let polyfillFailed = false;

/**
 * Install the polyfill only when the browser has no native implementation.
 * Decided ONCE, before anything touches the property.
 */
function boot() {
  if (booted || typeof document === "undefined") return;
  // Capture native-ness before the polyfill can define anything.
  nativeAtBoot = typeof document.modelContext === "object" && document.modelContext !== null;
  if (!nativeAtBoot) {
    try {
      initializeWebMCPPolyfill();
    } catch {
      polyfillFailed = true;
    }
  }
  booted = true;
}

/** The live modelContext, or undefined outside a document. */
export function ctx() {
  if (typeof document === "undefined") return undefined;
  return document.modelContext ?? navigator.modelContext;
}

export function runtimeInfo() {
  boot();
  return {
    native: nativeAtBoot,
    polyfilled: !nativeAtBoot && !polyfillFailed,
    polyfillFailed,
    hasModelContext: !!ctx(),
  };
}

/**
 * Run a tool, converting a thrown error into a RETURNED message.
 *
 * This matters more than it looks. A tool that throws does not hand the model a
 * readable failure — the browser rejects `executeTool` with an opaque
 * DOMException ("Tool was executed but the invocation failed") and the page
 * also collects an uncaught error. The agent learns nothing and retries
 * blindly. Returning the message puts the diagnosis where the model can use
 * it.
 */
/**
 * Validate input against a tool's own schema before running it.
 *
 * Without this a schema is decoration: an app tool declaring `holo: boolean`
 * happily receives the string "yes", and a toggle written as
 * `typeof holo === 'boolean' ? holo : !current` silently flips to the OPPOSITE
 * of what the caller asked for. Type-coercion bugs are the caller's fault, but
 * silently doing the wrong thing is ours to prevent.
 *
 * Deliberately small: type, required, enum, properties, items. Enough to catch
 * the mistakes that actually happen; not a JSON Schema implementation.
 */
function validate(schema, value, path = "") {
	const errs = [];
	if (!schema || typeof schema !== "object") return errs;
	const at = path || "argument";

	if (schema.type === "object") {
		if (value !== undefined && (typeof value !== "object" || value === null || Array.isArray(value))) {
			return [`${at}: expected an object`];
		}
		const obj = value ?? {};
		for (const key of schema.required ?? []) {
			if (obj[key] === undefined) errs.push(`missing required property "${key}"`);
		}
		for (const [key, sub] of Object.entries(schema.properties ?? {})) {
			if (obj[key] === undefined) continue;
			errs.push(...validate(sub, obj[key], key));
		}
		return errs;
	}

	if (schema.type === "array") {
		if (!Array.isArray(value)) return [`${at}: expected an array, got ${JSON.stringify(value)}`];
		if (schema.items) value.forEach((v, i) => errs.push(...validate(schema.items, v, `${at}[${i}]`)));
		return errs.concat(enumError(schema, value, at));
	}

	const actual = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
	if (schema.type === "boolean" && actual !== "boolean") errs.push(`${at}: expected a boolean, got ${JSON.stringify(value)}`);
	else if ((schema.type === "number" || schema.type === "integer") && actual !== "number") errs.push(`${at}: expected a number, got ${JSON.stringify(value)}`);
	else if (schema.type === "string" && actual !== "string") errs.push(`${at}: expected a string, got ${JSON.stringify(value)}`);

	return errs.concat(enumError(schema, value, at));
}

function enumError(schema, value, at) {
	if (!Array.isArray(schema.enum)) return [];
	return schema.enum.includes(value)
		? []
		: [`${at}: expected one of ${JSON.stringify(schema.enum)}, got ${JSON.stringify(value)}`];
}

/**
 * Run a tool, converting a thrown error into a RETURNED message.
 *
 * This matters more than it looks. A tool that throws does not hand the model a
 * readable failure — the browser rejects `executeTool` with an opaque
 * DOMException ("Tool was executed but the invocation failed") and the page
 * also collects an uncaught error. The agent learns nothing and retries
 * blindly. Returning the message puts the diagnosis where the model can use
 * it.
 */
async function safeRun(def, input, opts) {
	const args = input ?? {};

	const problems = validate(def.inputSchema, args);
	if (problems.length) {
		return `Error from ${def.name}: invalid arguments — ${problems.join("; ")}. Rejected without running.`;
	}

	try {
		const r = await def.run(args, opts ?? {});
		return typeof r === "string" ? r : JSON.stringify(r);
	} catch (err) {
		const msg = err && err.message ? err.message : String(err);
		// A ReferenceError/TypeError escaping a tool body is a bug in the tool,
		// not a condition the caller can fix. Say so, so the agent does not sit
		// there retrying its input.
		if (err instanceof ReferenceError || err instanceof TypeError) {
			const site = String(err.stack ?? "").split("\n")[1]?.trim() ?? "";
			return (
				`Error from ${def.name}: internal failure — ${msg}. This is a bug in the tool ` +
				`implementation, not in your arguments; retrying will not help.${site ? `\n  ${site}` : ""}`
			);
		}
		return `Error from ${def.name}: ${msg}`;
	}
}

/**
 * Register one tool.
 * @param {{name,title?,description,inputSchema?,annotations?,run}} def
 *   `run(input, {signal})` -> any (stringified for the model)
 * @returns {() => void} dispose
 */
export function register(def, { signal } = {}) {
  boot();
  local.set(def.name, def);

  const c = ctx();
  if (c) {
    try {
      Promise.resolve(
        c.registerTool(
          {
            name: def.name,
            title: def.title,
            description: def.description,
            inputSchema: def.inputSchema ?? { type: "object", properties: {} },
            // Every tool in this pack is dev tooling. `debugging` (Chrome 156+)
            // lets an end-user agent filter our tools out of its surface.
            annotations: { debugging: true, ...def.annotations },
            execute: async (input, opts) => safeRun(def, input, opts),
          },
          signal ? { signal } : undefined,
        ),
      ).catch(() => {
        /* a rejected mirror must not break the local registry */
      });
    } catch {
      /* same */
    }
  }

  const dispose = () => local.delete(def.name);
  if (signal) {
    if (signal.aborted) dispose();
    else signal.addEventListener("abort", dispose, { once: true });
  }
  return dispose;
}

/** JSON-safe specs for every tool this pack owns. */
export function specs() {
  return [...local.values()].map(({ name, title, description, inputSchema, annotations }) => ({
    name,
    title,
    description,
    inputSchema: inputSchema ?? { type: "object", properties: {} },
    annotations: annotations ?? {},
  }));
}

/** Call a tool directly, bypassing modelContext. Used by the page handle/harness. */
export async function invoke(name, input) {
  const def = local.get(name);
  if (!def) return `Error: no tool named "${name}". Registered: ${[...local.keys()].join(", ")}`;
  return safeRun(def, input, {});
}


/** Names of everything registered, for the page badge. */
export function names() {
  return [...local.keys()];
}
