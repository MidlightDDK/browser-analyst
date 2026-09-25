// Plays recorded trace events at their original offsets (`at`, ms since the run
// started), scaled by the speed, then finishes at the run's total duration.

import type { Replay, TraceEvent } from "@browser-analyst/agent";

export class ReplayPlayer {
  private i = 0;
  /** Recording time reached so far, in ms. */
  private played = 0;
  private wall = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private finished = false;
  private readonly events: readonly TraceEvent[];
  private readonly endAt: number;
  private readonly on: { event: (e: TraceEvent) => void; done: () => void };
  private speed: number;

  constructor(
    events: readonly TraceEvent[],
    endAt: number,
    on: { event: (e: TraceEvent) => void; done: () => void },
    speed = 1,
  ) {
    this.events = events;
    this.endAt = endAt;
    this.on = on;
    this.speed = speed;
  }

  start(): void {
    this.wall = Date.now();
    this.schedule();
  }

  setSpeed(speed: number): void {
    if (this.finished) return;
    this.sync();
    this.speed = speed;
    this.schedule();
  }

  /** Shows everything left at once. */
  skip(): void {
    if (this.finished) return;
    this.played = Number.POSITIVE_INFINITY;
    this.flush();
  }

  /** Stops without finishing (the component went away). */
  stop(): void {
    clearTimeout(this.timer);
    this.finished = true;
  }

  private sync(): void {
    const now = Date.now();
    this.played += (now - this.wall) * this.speed;
    this.wall = now;
  }

  private nextAt(): number {
    return this.events[this.i]?.at ?? this.endAt;
  }

  private schedule(): void {
    clearTimeout(this.timer);
    const wait = Math.max(0, (this.nextAt() - this.played) / this.speed);
    this.timer = setTimeout(() => {
      this.sync();
      this.played = Math.max(this.played, this.nextAt());
      this.flush();
    }, wait);
  }

  private flush(): void {
    const e = this.events;
    while (this.i < e.length && (e[this.i]?.at ?? 0) <= this.played)
      this.on.event(e[this.i++] as TraceEvent);
    if (this.i < e.length || this.played < this.endAt) {
      this.schedule();
      return;
    }
    clearTimeout(this.timer);
    this.finished = true;
    this.on.done();
  }
}

/** `/replays/<id>.json`, or null when missing or not a replay (the SPA
 * fallback answers unknown paths with the page itself). */
export async function fetchReplay(id: string): Promise<Replay | null> {
  try {
    const res = await fetch(`/replays/${id}.json`);
    if (!res.ok) return null;
    const r = (await res.json()) as Partial<Replay>;
    return r.version === 1 && Array.isArray(r.events) && r.outcome
      ? (r as Replay)
      : null;
  } catch {
    return null;
  }
}
