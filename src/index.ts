/**
 * p-queue-x — Zero-dependency promise-based concurrency-limited task queue
 *
 * Features:
 * - Concurrency control (limit simultaneous async tasks)
 * - Priority support (higher priority tasks run first)
 * - Per-task timeout
 * - Pause / resume
 * - Event hooks (onIdle, onSizeLessThan, onEmpty)
 * - Dynamic concurrency adjustment
 * - Task results via .add() promise
 * - Zero external dependencies
 */

/** Version constant for API versioning. */
export const VERSION = '1.0.0' as const;

/** A queued task function. Must return a Promise. */
export type TaskFunction<T = unknown> = () => Promise<T>;

/** Options for adding a task to the queue. */
export interface TaskOptions {
  /** Priority (higher = runs first). Default 0. */
  priority?: number;
  /** Per-task timeout in ms. Rejects if exceeded. Default: no timeout. */
  timeout?: number;
}

/** Options for constructing a PQueue instance. */
export interface PQueueOptions {
  /** Max concurrent tasks. Default 1. */
  concurrency?: number;
  /** Auto-start processing. Default true. */
  autoStart?: boolean;
  /** Default per-task timeout in ms. */
  defaultTimeout?: number;
}

interface QueuedTask<T = unknown> {
  fn: TaskFunction<T>;
  priority: number;
  timeout: number | undefined;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
  id: number;
}

/** Event emitter — minimal internal helper (no deps). */
type EventName = 'idle' | 'empty' | 'add' | 'next' | 'complete' | 'error' | 'pause' | 'resume';
type Listener = (...args: unknown[]) => void;

class Emitter {
  private listeners = new Map<EventName, Set<Listener>>();

  on(event: EventName, fn: Listener): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return () => this.off(event, fn);
  }

  off(event: EventName, fn: Listener): void {
    this.listeners.get(event)?.delete(fn);
  }

  emit(event: EventName, ...args: unknown[]): void {
    this.listeners.get(event)?.forEach((fn) => {
      try {
        fn(...args);
      } catch {
        // listener errors are swallowed — don't break the queue
      }
    });
  }
}

/**
 * Promise-based concurrency-limited queue.
 *
 * @example
 * ```ts
 * const queue = new PQueue({ concurrency: 3 });
 *
 * // Add tasks — they start automatically (up to concurrency limit)
 * const result = await queue.add(() => fetch('https://api.example.com'));
 *
 * // Wait for all tasks to finish
 * await queue.onIdle();
 * ```
 */
export class PQueue<T = unknown> extends Emitter {
  private queue: QueuedTask<T>[] = [];
  private activeCount = 0;
  private _paused: boolean;
  private _concurrency: number;
  private defaultTimeout: number | undefined;
  private nextId = 0;
  private idleResolvers: (() => void)[] = [];

  constructor(options: PQueueOptions = {}) {
    super();
    this._concurrency = Math.max(1, options.concurrency ?? 1);
    this._paused = options.autoStart === false;
    this.defaultTimeout = options.defaultTimeout;
  }

  /** Current max concurrency. */
  get concurrency(): number {
    return this._concurrency;
  }

  /** Number of tasks waiting in the queue. */
  get size(): number {
    return this.queue.length;
  }

  /** Number of tasks currently executing. */
  get pending(): number {
    return this.activeCount;
  }

  /** True if the queue is paused. */
  get isPaused(): boolean {
    return this._paused;
  }

  /** True if no tasks are running and none are queued. */
  get idle(): boolean {
    return this.queue.length === 0 && this.activeCount === 0;
  }

  /**
   * Add a task to the queue.
   * Returns a promise that resolves with the task result.
   * If the queue is paused, the task waits until `.start()` is called.
   */
  add(fn: TaskFunction<T>, options: TaskOptions = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const task: QueuedTask<T> = {
        fn,
        priority: options.priority ?? 0,
        timeout: options.timeout ?? this.defaultTimeout,
        resolve,
        reject,
        id: this.nextId++,
      };

      // Insert in priority order (stable: same priority = FIFO)
      let lo = 0;
      let hi = this.queue.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (this.queue[mid].priority >= task.priority) {
          lo = mid + 1;
        } else {
          hi = mid;
        }
      }
      this.queue.splice(lo, 0, task);

      this.emit('add', task.id);
      this.tryRunNext();
    });
  }

  /** Add multiple tasks at once. Returns array of result promises. */
  addAll(fns: TaskFunction<T>[], options: TaskOptions = {}): Promise<T>[] {
    return fns.map((fn) => this.add(fn, options));
  }

  /** Pause processing. Tasks already running continue. */
  pause(): void {
    if (!this._paused) {
      this._paused = true;
      this.emit('pause');
    }
  }

  /** Resume processing. */
  start(): void {
    if (this._paused) {
      this._paused = false;
      this.emit('resume');
      this.tryRunNext();
    }
  }

  /** Dynamically change the concurrency limit. */
  setConcurrency(n: number): void {
    this._concurrency = Math.max(1, Math.floor(n));
    this.tryRunNext();
  }

  /**
   * Remove all pending tasks (not active ones).
   * Removed tasks are rejected with an error.
   */
  clear(): void {
    const removed = this.queue.splice(0);
    for (const task of removed) {
      task.reject(new Error('Task cleared from queue'));
    }
  }

  /**
   * Wait until the queue is idle (size === 0 && pending === 0).
   * Resolves immediately if already idle.
   */
  onIdle(): Promise<void> {
    if (this.idle) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }

  /** Wait until queue size drops below the given threshold. */
  onSizeLessThan(threshold: number): Promise<void> {
    if (this.queue.length < threshold) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const check = () => {
        if (this.queue.length < threshold) {
          resolve();
          this.off('next', check);
        }
      };
      this.on('next', check);
    });
  }

  /** Wait until the queue is empty (size === 0, may have active tasks). */
  onEmpty(): Promise<void> {
    if (this.queue.length === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const check = () => {
        if (this.queue.length === 0) {
          resolve();
          this.off('next', check);
        }
      };
      this.on('next', check);
    });
  }

  // ─── Internal ────────────────────────────────────────────

  private tryRunNext(): void {
    if (this._paused) return;
    while (this.activeCount < this._concurrency && this.queue.length > 0) {
      const task = this.queue.shift()!;
      this.activeCount++;
      this.execute(task);
    }
  }

  private async execute(task: QueuedTask<T>): Promise<void> {
    this.emit('next');

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const cleanup = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    };

    const finish = (error: Error | null, result?: T) => {
      if (settled) return;
      settled = true;
      cleanup();
      this.activeCount--;
      this.tryRunNext();

      if (error) {
        this.emit('error', error);
        task.reject(error);
      } else {
        this.emit('complete', result);
        task.resolve(result as T);
      }

      // Check idle
      if (this.idle) {
        this.emit('idle');
        // Resolve onIdle() promises
        const resolvers = this.idleResolvers.splice(0);
        for (const r of resolvers) r();
      }
    };

    // Timeout wrapper
    if (task.timeout && task.timeout > 0) {
      timeoutHandle = setTimeout(() => {
        finish(new Error(`Task timed out after ${task.timeout}ms`));
      }, task.timeout);
    }

    try {
      const result = await task.fn();
      finish(null, result);
    } catch (err) {
      finish(err instanceof Error ? err : new Error(String(err)));
    }
  }
}

/**
 * Convenience factory function.
 * @example
 * ```ts
 * const q = createQueue({ concurrency: 5 });
 * await q.add(() => doWork());
 * ```
 */
export function createQueue<T = unknown>(options?: PQueueOptions): PQueue<T> {
  return new PQueue<T>(options);
}

export default PQueue;
