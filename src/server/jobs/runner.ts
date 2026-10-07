import { log } from "../log.ts";

type Task = { key: string; run: (signal: AbortSignal) => Promise<void> };

/**
 * A lane runs one task at a time in arrival order (app-design.md section 7.1).
 * S-1 uses the single-evaluation lane; S-2 adds the batch lane.
 */
export class Lane {
  private readonly queue: Task[] = [];
  private active: { key: string; controller: AbortController } | null = null;
  private idleResolvers: (() => void)[] = [];
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  enqueue(key: string, run: (signal: AbortSignal) => Promise<void>): void {
    if (this.active?.key === key || this.queue.some((t) => t.key === key)) return;
    this.queue.push({ key, run });
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.active) return;
    const task = this.queue.shift();
    if (!task) {
      this.idleResolvers.splice(0).forEach((r) => r());
      return;
    }
    const controller = new AbortController();
    this.active = { key: task.key, controller };
    try {
      await task.run(controller.signal);
    } catch (e) {
      log.error("lane.task_crashed", { lane: this.name, key: task.key, error: (e as Error)?.stack ?? String(e) });
    } finally {
      this.active = null;
      void this.pump();
    }
  }

  /** Key of the running task, or of the next queued one. */
  activeKey(): string | null {
    return this.active?.key ?? this.queue[0]?.key ?? null;
  }

  abortAll(): void {
    this.queue.length = 0;
    this.active?.controller.abort();
  }

  /** Resolves when nothing is running or queued (tests, shutdown). */
  idle(): Promise<void> {
    if (!this.active && this.queue.length === 0) return Promise.resolve();
    return new Promise((r) => this.idleResolvers.push(r));
  }
}
