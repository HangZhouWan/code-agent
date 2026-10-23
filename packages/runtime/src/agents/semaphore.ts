/**
 * 简单异步 Semaphore
 */

export class Semaphore {
  private available: number;
  private readonly queue: Array<(release: () => void) => void> = [];

  constructor(max: number) {
    this.available = Math.max(1, Math.floor(max));
  }

  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available--;
      return this.makeRelease();
    }
    return new Promise<() => void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  private makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.queue.shift();
      if (next) {
        next(this.makeRelease());
      } else {
        this.available++;
      }
    };
  }
}
