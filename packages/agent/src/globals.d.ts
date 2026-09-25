// Web-standard globals present in browsers, workers, and Node >= 22. The
// package compiles without DOM or Node types to stay environment-agnostic.
declare const performance: { now(): number };
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
declare function atob(data: string): string;
declare function setTimeout(
  handler: (...args: never[]) => void,
  ms?: number,
): unknown;
declare function clearTimeout(id: unknown): void;
declare class TextDecoder {
  decode(input?: Uint8Array, options?: { stream?: boolean }): string;
}
interface AbortSignal {
  readonly aborted: boolean;
}
interface ReadableStreamDefaultReader<R> {
  read(): Promise<
    { done: true; value?: undefined } | { done: false; value: R }
  >;
  cancel(reason?: unknown): Promise<void>;
  releaseLock(): void;
}
interface ReadableStream<R = unknown> {
  getReader(): ReadableStreamDefaultReader<R>;
}
declare const ReadableStream: {
  new <R = unknown>(source: {
    start?(controller: { enqueue(chunk: R): void; close(): void }): void;
    pull?(controller: { enqueue(chunk: R): void; close(): void }): void;
    cancel?(): void;
  }): ReadableStream<R>;
};
interface Response {
  readonly ok: boolean;
  readonly status: number;
  readonly body: ReadableStream<Uint8Array> | null;
  json(): Promise<unknown>;
}
declare function fetch(
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    credentials?: "same-origin" | "include" | "omit";
    signal?: AbortSignal;
  },
): Promise<Response>;
declare class AbortController {
  readonly signal: AbortSignal;
  abort(): void;
}
declare const Response: {
  new (
    body?: string | null,
    init?: { status?: number; headers?: Record<string, string> },
  ): Response;
  json(data: unknown, init?: { status?: number }): Response;
};
declare const crypto: {
  getRandomValues<T extends Uint8Array>(array: T): T;
};
