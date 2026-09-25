// Web-standard globals present in browsers, workers, and Node >= 22. The
// package compiles without DOM or Node types to stay environment-agnostic.
declare const performance: { now(): number };
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
declare function atob(data: string): string;
