// CSP violations → the trace. The page hears its own through
// `securitypolicyviolation`; a violation inside a worker fires on the worker's
// global scope instead, so the Python and DuckDB workers forward theirs over
// a BroadcastChannel (see sandbox/csp-forward.ts).

export const CSP_CHANNEL = "csp-violations";

export interface CspViolation {
  blockedURI: string;
  directive: string;
  /** "page", or the worker that tried: "python", "duckdb". */
  source: string;
}

type Listener = (v: CspViolation) => void;
const listeners = new Set<Listener>();
let started = false;

const emit = (v: CspViolation) => {
  for (const fn of listeners) fn(v);
};

/** Starts listening once, at page load, so early violations aren't missed. */
export function startCspListener(): void {
  if (started) return;
  started = true;
  document.addEventListener("securitypolicyviolation", (e) =>
    emit({
      blockedURI: e.blockedURI,
      directive: e.effectiveDirective,
      source: "page",
    }),
  );
  if (typeof BroadcastChannel !== "undefined")
    new BroadcastChannel(CSP_CHANNEL).onmessage = (e: MessageEvent) =>
      emit(e.data as CspViolation);
}

export function onCspViolation(fn: Listener): () => void {
  startCspListener();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function where(uri: string): string {
  try {
    return new URL(uri).host || uri;
  } catch {
    return uri || "an inline resource";
  }
}

export const describeViolation = (v: CspViolation) =>
  `Blocked by CSP: ${where(v.blockedURI)} (${v.directive}${v.source === "page" ? "" : `, from the ${v.source} worker`})`;
