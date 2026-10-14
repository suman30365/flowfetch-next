/**
 * Bounded concurrency semaphore.
 * Prevents more than `maxJobs` simultaneous yt-dlp child processes.
 */
export class JobQueue {
  private running = 0;
  private readonly max: number;

  constructor(max: number) {
    this.max = max;
  }

  get isFull(): boolean {
    return this.running >= this.max;
  }

  acquire(): void {
    if (this.isFull) {
      throw Object.assign(
        new Error(`Server busy — max ${this.max} concurrent downloads`),
        { code: 'concurrent_limit_exceeded' },
      );
    }
    this.running++;
  }

  release(): void {
    if (this.running > 0) this.running--;
  }

  get currentCount(): number {
    return this.running;
  }
}

export const jobQueue = new JobQueue(
  parseInt(process.env.MAX_CONCURRENT_JOBS ?? '3', 10),
);
