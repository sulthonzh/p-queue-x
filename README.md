# p-queue-x

> Zero-dependency promise-based concurrency-limited task queue for Node.js

Control how many async tasks run at the same time. Add priority, timeouts, pause/resume, and lifecycle hooks — all with zero dependencies.

## Why?

`Promise.all([...])` runs everything at once. That's fine for 3 API calls, but what about 10,000? Or when each task hits a rate-limited API?

**p-queue-x** gives you a simple queue that runs at most N tasks concurrently, with priority support, per-task timeouts, and pause/resume — no dependencies, no bloat.

## Install

```bash
npm install p-queue-x
```

## Quick Start

```typescript
import { PQueue } from 'p-queue-x';

// Allow 3 concurrent tasks
const queue = new PQueue({ concurrency: 3 });

// Add tasks — they start running automatically (up to concurrency limit)
const results = await Promise.all([
  queue.add(() => fetch('https://api.example.com/users')),
  queue.add(() => fetch('https://api.example.com/posts')),
  queue.add(() => fetch('https://api.example.com/comments')),
  queue.add(() => fetch('https://api.example.com/likes')),  // waits for a slot
]);

// Wait for everything to finish
await queue.onIdle();
```

## Features

### Concurrency Control

```typescript
const queue = new PQueue({ concurrency: 5 });

// Only 5 tasks run at once, rest are queued
urls.forEach(url => queue.add(() => fetch(url)));
```

### Priority

Higher priority tasks jump the queue:

```typescript
const queue = new PQueue({ concurrency: 1 });

queue.add(() => processEmail(newsletter), { priority: 1 });
queue.add(() => processEmail(urgent), { priority: 10 });  // runs first
queue.add(() => processEmail(regular), { priority: 5 });
```

### Timeout

Per-task or default timeout:

```typescript
const queue = new PQueue({ defaultTimeout: 5000 });

// Uses default 5s timeout
queue.add(() => slowApiCall());

// Override per-task
queue.add(() => slowApiCall(), { timeout: 10000 });
```

### Pause / Resume

```typescript
const queue = new PQueue({ concurrency: 2 });
queue.pause();   // running tasks continue, queued tasks wait
queue.start();   // resume processing
```

### Dynamic Concurrency

```typescript
const queue = new PQueue({ concurrency: 2 });
// API just gave us a higher rate limit
queue.setConcurrency(10);
```

### Lifecycle Hooks

```typescript
const queue = new PQueue({ concurrency: 3 });

queue.on('idle', () => console.log('All done!'));
queue.on('error', (err) => console.error('Task failed:', err));

// Await idle state
await queue.onIdle();

// Wait until fewer than 10 tasks are queued
await queue.onSizeLessThan(10);
```

### Clear Pending Tasks

```typescript
queue.clear();  // rejects all waiting tasks with an error
```

## API

### `new PQueue(options?)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `concurrency` | `number` | `1` | Max concurrent tasks |
| `autoStart` | `boolean` | `true` | If false, queue starts paused |
| `defaultTimeout` | `number` | — | Default per-task timeout (ms) |

### `.add(fn, options?) → Promise<T>`

Adds a task. Returns a promise that resolves with the result.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `priority` | `number` | `0` | Higher runs first |
| `timeout` | `number` | — | Per-task timeout (ms) |

### `.addAll(fns, options?) → Promise<T>[]`

Adds multiple tasks at once.

### `.pause()` / `.start()`

Pause and resume processing.

### `.setConcurrency(n)`

Dynamically change max concurrency.

### `.clear()`

Remove all pending tasks (rejects them with an error).

### `.onIdle() → Promise<void>`

Resolves when the queue is fully idle (no active or queued tasks).

### `.onEmpty() → Promise<void>`

Resolves when the queue is empty (no queued tasks, may have active ones).

### `.onSizeLessThan(n) → Promise<void>`

Resolves when queue size drops below `n`.

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `size` | `number` | Tasks waiting in queue |
| `pending` | `number` | Tasks currently running |
| `concurrency` | `number` | Max concurrent tasks |
| `idle` | `boolean` | True if `size === 0 && pending === 0` |
| `isPaused` | `boolean` | True if queue is paused |

### Events

| Event | Args | Description |
|-------|------|-------------|
| `add` | `taskId` | A task was added |
| `next` | — | A task started executing |
| `complete` | `result` | A task completed successfully |
| `error` | `error` | A task threw an error |
| `idle` | — | Queue became idle |
| `empty` | — | Queue became empty |
| `pause` | — | Queue was paused |
| `resume` | — | Queue was resumed |

### `createQueue(options?)`

Factory function — same as `new PQueue(options)`.

## CLI

```bash
# Visual demo
npx p-queue-x demo --concurrency 4 --tasks 20

# Benchmark
npx p-queue-x bench --concurrency 10 --tasks 500 --work 20

# Priority demo
npx p-queue-x test-priority --tasks 12
```

## Real-World Example: Rate-Limited API Crawler

```typescript
import { PQueue } from 'p-queue-x';

const queue = new PQueue({ concurrency: 5 }); // 5 concurrent requests

async function crawlAll(urls: string[]): Promise<string[]> {
  const tasks = urls.map(url =>
    queue.add(
      async () => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
        return res.text();
      },
      { timeout: 10000, priority: url.includes('urgent') ? 10 : 0 }
    )
  );

  return Promise.allSettled(tasks);
}
```

## Zero Dependencies

No `node_modules` bloat. Just clean TypeScript that compiles to plain JS.

## License

MIT
