/** An expected failure, returned to the client as `{reason}`. */
export class HttpError extends Error {
  readonly status: number;
  readonly reason: string;
  readonly headers: HeadersInit | undefined;
  constructor(status: number, reason: string, headers?: HeadersInit) {
    super(reason);
    this.status = status;
    this.reason = reason;
    this.headers = headers;
  }
}

export function json(
  body: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  const res = Response.json(body, { status, headers });
  res.headers.set("cache-control", "no-store");
  return res;
}

export function requireMethod(request: Request, method: string): void {
  if (request.method !== method) {
    throw new HttpError(405, "method_not_allowed", { allow: method });
  }
}

export const clientIp = (request: Request) =>
  request.headers.get("cf-connecting-ip") ?? "unknown";

/** Approximate, per Cloudflare location (fine for a demo). */
export async function rateLimit(
  limiter: RateLimit,
  request: Request,
): Promise<void> {
  const { success } = await limiter.limit({ key: clientIp(request) });
  if (!success) throw new HttpError(429, "rate_limit", { "retry-after": "60" });
}

/** Structured log line. Never includes message content or IPs. */
export function log(entry: {
  route: string;
  provider?: string;
  status: number | string;
  latencyMs?: number;
  tokens?: number;
  steps?: number;
}): void {
  console.log(JSON.stringify(entry));
}
