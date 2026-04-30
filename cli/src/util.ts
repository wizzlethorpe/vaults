/**
 * Run an async function over an iterable with bounded concurrency.
 * onProgress is called once per completed item.
 */
export async function pMap<T, U>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<U>,
  onProgress?: (done: number, total: number) => void,
): Promise<U[]> {
  const results: U[] = new Array(items.length);
  let cursor = 0;
  let done = 0;
  const total = items.length;

  const workers = Array.from({ length: Math.min(concurrency, total) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= total) return;
      results[i] = await fn(items[i]!, i);
      done++;
      onProgress?.(done, total);
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * Inline progress reporter. Prints a single line that updates in place,
 * then a newline once finished. No-op if stdout isn't a TTY.
 */
export class Progress {
  private label: string;
  private finished = false;

  constructor(label: string) {
    this.label = label;
  }

  update(done: number, total: number): void {
    if (this.finished) return;
    if (process.stdout.isTTY) {
      const bar = renderBar(done, total);
      process.stdout.write(`\r  ${this.label} ${bar} ${done}/${total}`);
    }
  }

  done(summary?: string): void {
    if (this.finished) return;
    this.finished = true;
    if (process.stdout.isTTY) process.stdout.write("\r\x1b[K");
    console.log(`  ${this.label} ${summary ?? "done"}`);
  }
}

function renderBar(done: number, total: number, width = 20): string {
  const ratio = total === 0 ? 1 : done / total;
  const filled = Math.round(ratio * width);
  return "[" + "█".repeat(filled) + "░".repeat(width - filled) + "]";
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
