#!/usr/bin/env node
/**
 * p-queue-x CLI — Demo and testing tool
 *
 * Usage:
 *   p-queue-x demo [--concurrency N] [--tasks N]
 *   p-queue-x bench [--concurrency N] [--tasks N] [--work MS]
 *   p-queue-x test-priority [--tasks N]
 */

import { PQueue } from './index.js';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs(argv: string[]): Record<string, string | number | boolean> {
  const args: Record<string, string | number | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (val && !val.startsWith('--')) {
        const num = Number(val);
        args[key] = isNaN(num) ? val : num;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

async function demo(args: Record<string, string | number | boolean>): Promise<void> {
  const concurrency = (args.concurrency as number) ?? 3;
  const taskCount = (args.tasks as number) ?? 10;

  console.log(`\n🚀 p-queue-x demo: ${taskCount} tasks, concurrency=${concurrency}\n`);

  const queue = new PQueue({ concurrency });

  const tasks: Promise<unknown>[] = [];
  for (let i = 0; i < taskCount; i++) {
    const taskNum = i + 1;
    tasks.push(
      queue.add(async () => {
        const start = Date.now();
        const workMs = 100 + Math.random() * 200;
        await sleep(workMs);
        const elapsed = Date.now() - start;
        console.log(`  ✅ Task ${String(taskNum).padStart(2, '0')} done in ${elapsed}ms (pending: ${queue.pending}, queued: ${queue.size})`);
        return taskNum;
      }),
    );
  }

  const start = Date.now();
  await Promise.all(tasks);
  const total = Date.now() - start;
  console.log(`\n📊 All ${taskCount} tasks finished in ${total}ms (concurrency=${concurrency})\n`);
}

async function bench(args: Record<string, string | number | boolean>): Promise<void> {
  const concurrency = (args.concurrency as number) ?? 5;
  const taskCount = (args.tasks as number) ?? 100;
  const workMs = (args.work as number) ?? 50;

  console.log(`\n🔥 p-queue-x benchmark: ${taskCount} tasks × ${workMs}ms work, concurrency=${concurrency}`);

  const queue = new PQueue({ concurrency });
  const start = Date.now();

  const tasks: Promise<unknown>[] = [];
  for (let i = 0; i < taskCount; i++) {
    tasks.push(queue.add(() => sleep(workMs)));
  }

  await Promise.all(tasks);
  const elapsed = Date.now() - start;
  const serial = taskCount * workMs;
  const speedup = (serial / elapsed).toFixed(2);

  console.log(`  Elapsed: ${elapsed}ms (serial would be ~${serial}ms)`);
  console.log(`  Speedup: ${speedup}x\n`);
}

async function testPriority(args: Record<string, string | number | boolean>): Promise<void> {
  const taskCount = (args.tasks as number) ?? 8;
  console.log(`\n🎯 p-queue-x priority test: ${taskCount} tasks, concurrency=1\n`);

  const queue = new PQueue({ concurrency: 1 });
  const results: string[] = [];

  // Add a blocker task first
  await queue.add(async () => {
    await sleep(50);
    results.push('blocker');
  });

  // Add tasks with varying priority (higher = first)
  for (let i = 0; i < taskCount; i++) {
    const priority = i % 3 === 0 ? 10 : i % 3 === 1 ? 5 : 0;
    const label = `task-${i}(pri=${priority})`;
    queue.add(
      async () => {
        results.push(label);
      },
      { priority },
    );
  }

  await queue.onIdle();
  console.log('  Execution order:');
  results.forEach((r, i) => console.log(`    ${i + 1}. ${r}`));
  console.log('');
}

// ─── Main ─────────────────────────────────────────────────

const command = process.argv[2];
const args = parseArgs(process.argv.slice(3));

switch (command) {
  case 'demo':
    demo(args);
    break;
  case 'bench':
    bench(args);
    break;
  case 'test-priority':
    testPriority(args);
    break;
  default:
    console.log(`
  p-queue-x — Zero-dependency promise-based concurrency queue

  Commands:
    demo            Run a visual demo of concurrent task processing
    bench           Benchmark throughput vs serial execution
    test-priority   Demonstrate priority-based ordering

  Options:
    --concurrency N   Max concurrent tasks (default: 3 or 5)
    --tasks N         Number of tasks to enqueue (default: 10 or 100)
    --work MS         Simulated work per task in ms (bench only)

  Examples:
    p-queue-x demo --concurrency 4 --tasks 20
    p-queue-x bench --concurrency 10 --tasks 500 --work 20
    p-queue-x test-priority --tasks 12
`);
    break;
}
