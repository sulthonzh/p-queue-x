/**
 * p-queue-x tests
 * Run with: node --test dist/test/index.test.js
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PQueue, createQueue } from '../index.js';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Basic functionality ─────────────────────────────────

describe('PQueue — basic', () => {
  it('should run a single task', async () => {
    const q = new PQueue({ concurrency: 1 });
    const result = await q.add(async () => 42);
    assert.equal(result, 42);
  });

  it('should run multiple tasks sequentially with concurrency=1', async () => {
    const q = new PQueue({ concurrency: 1 });
    const order: number[] = [];

    await Promise.all([
      q.add(async () => { order.push(1); }),
      q.add(async () => { order.push(2); }),
      q.add(async () => { order.push(3); }),
    ]);

    assert.deepEqual(order, [1, 2, 3]);
  });

  it('should run tasks concurrently up to concurrency limit', async () => {
    const q = new PQueue({ concurrency: 3 });
    let maxConcurrent = 0;
    let current = 0;

    const tasks: Promise<unknown>[] = [];
    for (let i = 0; i < 10; i++) {
      tasks.push(
        q.add(async () => {
          current++;
          maxConcurrent = Math.max(maxConcurrent, current);
          await sleep(20);
          current--;
        }),
      );
    }

    await Promise.all(tasks);
    assert.equal(maxConcurrent, 3);
  });

  it('should return the correct result for each task', async () => {
    const q = new PQueue({ concurrency: 2 });
    const results = await Promise.all([
      q.add(async () => 'a'),
      q.add(async () => 'b'),
      q.add(async () => 'c'),
    ]);
    assert.deepEqual(results, ['a', 'b', 'c']);
  });
});

// ─── Concurrency control ─────────────────────────────────

describe('PQueue — concurrency', () => {
  it('should report correct size and pending', async () => {
    const q = new PQueue({ concurrency: 2 });

    // Add 5 tasks, each taking 30ms
    const promises: Promise<unknown>[] = [];
    for (let i = 0; i < 5; i++) {
      promises.push(q.add(() => sleep(30)));
    }

    // After a tiny delay, 2 should be running, 3 queued
    await sleep(5);
    assert.equal(q.pending, 2);
    assert.equal(q.size, 3);

    await Promise.all(promises);
    assert.equal(q.pending, 0);
    assert.equal(q.size, 0);
  });

  it('should allow dynamic concurrency change', async () => {
    const q = new PQueue({ concurrency: 1 });
    assert.equal(q.concurrency, 1);
    q.setConcurrency(5);
    assert.equal(q.concurrency, 5);
  });

  it('should reject invalid concurrency values', async () => {
    const q = new PQueue({ concurrency: 3 });
    q.setConcurrency(0);
    assert.equal(q.concurrency, 1); // clamped to 1
    q.setConcurrency(-5);
    assert.equal(q.concurrency, 1);
  });
});

// ─── Priority ────────────────────────────────────────────

describe('PQueue — priority', () => {
  it('should execute higher priority tasks first when queue is full', async () => {
    const q = new PQueue({ concurrency: 1 });
    const order: string[] = [];

    // Block the queue with an initial task
    const blocker = q.add(async () => {
      await sleep(30);
      order.push('blocker');
    });

    // While blocked, add tasks with different priorities
    q.add(async () => { order.push('low'); }, { priority: 1 });
    q.add(async () => { order.push('high'); }, { priority: 10 });
    q.add(async () => { order.push('medium'); }, { priority: 5 });

    await blocker;
    await q.onIdle();

    assert.equal(order[0], 'blocker');
    assert.equal(order[1], 'high');   // priority 10
    assert.equal(order[2], 'medium'); // priority 5
    assert.equal(order[3], 'low');    // priority 1
  });

  it('should maintain FIFO for equal priority', async () => {
    const q = new PQueue({ concurrency: 1 });
    const order: string[] = [];

    q.add(async () => { await sleep(10); order.push('first'); });
    q.add(async () => { order.push('second'); }, { priority: 5 });
    q.add(async () => { order.push('third'); }, { priority: 5 });

    await q.onIdle();
    assert.equal(order[1], 'second');
    assert.equal(order[2], 'third');
  });
});

// ─── Pause / Resume ──────────────────────────────────────

describe('PQueue — pause / resume', () => {
  it('should pause and resume', async () => {
    const q = new PQueue({ concurrency: 1 });
    const order: string[] = [];

    q.pause();
    assert.equal(q.isPaused, true);

    q.add(async () => { order.push('task'); });
    await sleep(20); // should NOT execute while paused
    assert.deepEqual(order, []);

    q.start();
    assert.equal(q.isPaused, false);
    await q.onIdle();
    assert.deepEqual(order, ['task']);
  });

  it('should support autoStart=false', async () => {
    const q = new PQueue({ concurrency: 1, autoStart: false });
    assert.equal(q.isPaused, true);

    let ran = false;
    q.add(async () => { ran = true; });
    await sleep(20);
    assert.equal(ran, false);

    q.start();
    await q.onIdle();
    assert.equal(ran, true);
  });
});

// ─── Timeout ─────────────────────────────────────────────

describe('PQueue — timeout', () => {
  it('should reject a task that exceeds timeout', async () => {
    const q = new PQueue({ concurrency: 1 });
    await assert.rejects(
      q.add(() => sleep(200), { timeout: 50 }),
      /timed out/i,
    );
  });

  it('should support default timeout from constructor', async () => {
    const q = new PQueue({ concurrency: 1, defaultTimeout: 50 });
    await assert.rejects(
      q.add(() => sleep(200)),
      /timed out/i,
    );
  });
});

// ─── Error handling ──────────────────────────────────────

describe('PQueue — error handling', () => {
  it('should propagate task errors to the caller', async () => {
    const q = new PQueue({ concurrency: 1 });
    await assert.rejects(
      q.add(async () => { throw new Error('boom'); }),
      /boom/,
    );
  });

  it('should continue processing after a task throws', async () => {
    const q = new PQueue({ concurrency: 1 });
    const results: number[] = [];

    const tasks: Promise<unknown>[] = [
      q.add(async () => { results.push(1); }).catch(() => {}),
      q.add(async () => { throw new Error('fail'); }).catch(() => {}),
      q.add(async () => { results.push(3); }).catch(() => {}),
    ];

    await Promise.all(tasks);
    assert.deepEqual(results, [1, 3]);
  });
});

// ─── Lifecycle: clear, idle, onIdle ──────────────────────

describe('PQueue — lifecycle', () => {
  it('should detect idle state', async () => {
    const q = new PQueue({ concurrency: 2 });
    assert.equal(q.idle, true);

    const p = q.add(() => sleep(30));
    assert.equal(q.idle, false);

    await p;
    assert.equal(q.idle, true);
  });

  it('onIdle should resolve when queue becomes idle', async () => {
    const q = new PQueue({ concurrency: 1 });
    q.add(() => sleep(30));
    q.add(() => sleep(30));

    const start = Date.now();
    await q.onIdle();
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 50, 'should wait for both tasks');
    assert.equal(q.idle, true);
  });

  it('onIdle should resolve immediately if already idle', async () => {
    const q = new PQueue();
    const start = Date.now();
    await q.onIdle();
    assert.ok(Date.now() - start < 10);
  });

  it('clear should reject pending tasks', async () => {
    const q = new PQueue({ concurrency: 1 });

    // Block the queue
    q.add(() => sleep(50));

    // Add tasks that will be stuck
    const task2 = q.add(() => sleep(10));
    const task3 = q.add(() => sleep(10));

    q.clear();

    await assert.rejects(task2, /cleared/i);
    await assert.rejects(task3, /cleared/i);
  });

  it('onSizeLessThan should resolve when size drops', async () => {
    const q = new PQueue({ concurrency: 1 });
    q.add(() => sleep(30));

    for (let i = 0; i < 5; i++) {
      q.add(() => sleep(10));
    }

    const sizePromise = q.onSizeLessThan(3);
    await sizePromise;
    assert.ok(q.size < 3);
  });
});

// ─── addAll ──────────────────────────────────────────────

describe('PQueue — addAll', () => {
  it('should add multiple tasks and return all results', async () => {
    const q = new PQueue({ concurrency: 3 });
    const results = await Promise.all(
      q.addAll([
        async () => 1,
        async () => 2,
        async () => 3,
      ]),
    );
    assert.deepEqual(results, [1, 2, 3]);
  });
});

// ─── Factory ─────────────────────────────────────────────

describe('createQueue', () => {
  it('should create a working queue', async () => {
    const q = createQueue({ concurrency: 2 });
    const result = await q.add(async () => 'hello');
    assert.equal(result, 'hello');
    assert.equal(q.concurrency, 2);
  });
});

// ─── onEmpty ───────────────────────────────────────────

describe('PQueue — onEmpty', () => {
  it('should resolve immediately when queue is already empty', async () => {
    const q = new PQueue({ concurrency: 1 });
    const start = Date.now();
    await q.onEmpty();
    assert.ok(Date.now() - start < 10);
  });

  it('should resolve when queue becomes empty (active tasks may remain)', async () => {
    const q = new PQueue({ concurrency: 2 });

    // Block with a long task
    const blocker = q.add(() => sleep(60));

    // Add shorter tasks that fill the queue
    q.add(() => sleep(20));
    q.add(() => sleep(20));

    // Wait until queue drains but blocker still active
    await q.onEmpty();
    assert.equal(q.size, 0);
    assert.ok(q.pending >= 1, 'blocker should still be running');

    await blocker;
    await q.onIdle();
  });
});

// ─── Edge cases ─────────────────────────────────────────

describe('PQueue — edge cases', () => {
  it('start() should be a no-op when not paused', async () => {
    const q = new PQueue({ concurrency: 1 });
    const events: string[] = [];
    q.on('resume', () => events.push('resume'));

    q.start(); // not paused — should not emit resume
    assert.deepEqual(events, []);

    const result = await q.add(async () => 99);
    assert.equal(result, 99);
  });

  it('pause() should be a no-op when already paused', async () => {
    const q = new PQueue({ concurrency: 1 });
    q.pause();
    q.pause(); // second pause should not throw or double-emit

    const events: string[] = [];
    q.on('pause', () => events.push('pause'));
    q.pause(); // third pause — listener added after first two, should not fire
    assert.deepEqual(events, []);

    q.start();
    await q.onIdle();
  });

  it('should swallow listener errors without breaking the queue', async () => {
    const q = new PQueue({ concurrency: 1 });

    // Register a listener that throws
    q.on('complete', () => {
      throw new Error('listener boom');
    });

    // Queue should still work fine
    const result = await q.add(async () => 42);
    assert.equal(result, 42);
  });

  it('onEmpty should work with clear()', async () => {
    const q = new PQueue({ concurrency: 1 });

    // Block the queue
    q.add(() => sleep(50));

    // Fill queue
    for (let i = 0; i < 3; i++) {
      q.add(() => sleep(10)).catch(() => {});
    }

    assert.ok(q.size > 0);
    q.clear();
    assert.equal(q.size, 0);

    // onEmpty should resolve since size is now 0
    await q.onEmpty();
    await q.onIdle();
  });
});

// ─── Events ──────────────────────────────────────────────

describe('PQueue — events', () => {
  it('should emit add, complete, and idle events', async () => {
    const q = new PQueue({ concurrency: 1 });
    const events: string[] = [];

    q.on('add', () => events.push('add'));
    q.on('complete', () => events.push('complete'));
    q.on('idle', () => events.push('idle'));

    await q.add(async () => 1);
    assert.ok(events.includes('add'));
    assert.ok(events.includes('complete'));
    assert.ok(events.includes('idle'));
  });

  it('should emit pause and resume events', async () => {
    const q = new PQueue({ concurrency: 1 });
    const events: string[] = [];

    q.on('pause', () => events.push('pause'));
    q.on('resume', () => events.push('resume'));

    q.pause();
    q.start();

    assert.deepEqual(events, ['pause', 'resume']);
  });
});
