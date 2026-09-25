// Public values only: everything under web/ ships to browsers.

const local = ["localhost", "127.0.0.1"].includes(location.hostname);

/**
 * Turnstile site key (public by design). Local dev uses Cloudflare's
 * always-pass test key, paired with the test secret in `pnpm dev`
 * (https://developers.cloudflare.com/turnstile/troubleshooting/testing/).
 * The production widget covers browser-analyst.azar-majed7.workers.dev.
 */
export const TURNSTILE_SITE_KEY = local
  ? "1x00000000000000000000AA"
  : "1x00000000000000000000AA";
