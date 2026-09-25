// Worker side of security/csp.ts: CSP violations fire on the worker's global
// scope, where the page can't hear them, so forward them to the page.
// CSP_FORWARD_JS is the same code as text, for the DuckDB blob worker.

import { CSP_CHANNEL } from "../security/csp";

export function forwardCspViolations(source: string): void {
  const channel = new BroadcastChannel(CSP_CHANNEL);
  self.addEventListener("securitypolicyviolation", (e) =>
    channel.postMessage({
      blockedURI: e.blockedURI,
      directive: e.effectiveDirective,
      source,
    }),
  );
}

export const CSP_FORWARD_JS = `(() => {
  const channel = new BroadcastChannel(${JSON.stringify(CSP_CHANNEL)});
  self.addEventListener("securitypolicyviolation", (e) =>
    channel.postMessage({ blockedURI: e.blockedURI, directive: e.effectiveDirective, source: "duckdb" }));
})();`;
