// A 30-minute gateway session, started by an (usually invisible) Turnstile
// check; the cookie itself is HttpOnly.

import { turnstileToken } from "./turnstile";

let sessionUntil = 0;
let pending: Promise<void> | null = null;

const MESSAGES: Record<string, string> = {
  unavailable: "Live runs aren't available on this deployment yet.",
  turnstile: "The bot check didn't pass. Reload the page and try again.",
  rate_limit:
    "Too many requests in the last minute. Wait a moment, then try again.",
};

async function newSession(
  container: HTMLElement,
  onInteractive: (active: boolean) => void,
): Promise<void> {
  const token = await turnstileToken(container, onInteractive);
  const res = await fetch("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ turnstileToken: token }),
  });
  if (!res.ok) {
    const { reason } = (await res.json().catch(() => ({}))) as {
      reason?: string;
    };
    throw new Error(
      MESSAGES[reason ?? ""] ?? `Couldn't start a session (${res.status}).`,
    );
  }
  sessionUntil = ((await res.json()) as { expiresAt: number }).expiresAt;
}

/** Starts a session unless one is valid for another minute; shares in-flight work. */
export function ensureSession(
  container: HTMLElement,
  onInteractive: (active: boolean) => void,
  force = false,
): Promise<void> {
  if (!force && sessionUntil - Date.now() > 60_000) return Promise.resolve();
  pending ??= newSession(container, onInteractive).finally(() => {
    pending = null;
  });
  return pending;
}
