import type { TraceEvent } from "@browser-analyst/agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReplayPlayer } from "./player";

const ev = (stepId: string, at: number): TraceEvent => ({
  stepId,
  type: "model",
  input: null,
  outputPreview: "",
  durationMs: 0,
  at,
});

function setup(speed = 1) {
  const seen: string[] = [];
  const done = vi.fn();
  const p = new ReplayPlayer(
    [ev("1", 1_000), ev("2", 3_000), ev("3", 3_000)],
    5_000,
    { event: (e) => seen.push(e.stepId), done },
    speed,
  );
  p.start();
  return { p, seen, done };
}

describe("ReplayPlayer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("plays events at their recorded offsets, then finishes", () => {
    const { seen, done } = setup();
    vi.advanceTimersByTime(999);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual(["1"]);
    vi.advanceTimersByTime(2_000);
    expect(seen).toEqual(["1", "2", "3"]);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_000);
    expect(done).toHaveBeenCalledOnce();
  });

  it("2× halves the remaining waits, from the moment it is set", () => {
    const { p, seen, done } = setup();
    vi.advanceTimersByTime(2_000); // recording time 2 s
    p.setSpeed(2);
    vi.advanceTimersByTime(499);
    expect(seen).toEqual(["1"]);
    vi.advanceTimersByTime(1); // recording time 3 s
    expect(seen).toEqual(["1", "2", "3"]);
    vi.advanceTimersByTime(1_000); // recording time 5 s
    expect(done).toHaveBeenCalledOnce();
  });

  it("skip shows everything at once; stop shows nothing more", () => {
    const a = setup();
    a.p.skip();
    expect(a.seen).toEqual(["1", "2", "3"]);
    expect(a.done).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(10_000);
    expect(a.done).toHaveBeenCalledOnce();

    const b = setup();
    b.p.stop();
    vi.advanceTimersByTime(10_000);
    expect(b.seen).toEqual([]);
    expect(b.done).not.toHaveBeenCalled();
  });
});
