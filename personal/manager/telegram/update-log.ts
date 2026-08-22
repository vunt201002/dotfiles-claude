import { readJson, writeJsonAtomic } from './store';

interface UpdateLogShape {
  offset: number;
  seen: number[];
}

const RING_SIZE = 1000;

/**
 * Remembers which Telegram update_ids were already taken in, so a restart
 * replays nothing. Marking happens before the command runs (at-most-once):
 * a re-run of `/run` is worse than a dropped one the user can retype.
 */
export class UpdateLog {
  private offsetValue: number;
  private seen: Set<number>;
  private order: number[];

  private constructor(private readonly file: string, shape: UpdateLogShape) {
    this.offsetValue = shape.offset;
    this.order = shape.seen.slice(-RING_SIZE);
    this.seen = new Set(this.order);
  }

  static load(file: string): UpdateLog {
    const result = readJson<UpdateLogShape>(file);
    if (!result.ok && result.kind === 'error') {
      throw new Error(`cannot read Telegram update log: ${result.reason}`);
    }
    const shape = result.ok ? result.value : { offset: 0, seen: [] };
    return new UpdateLog(file, {
      offset: Number.isFinite(shape.offset) ? shape.offset : 0,
      seen: Array.isArray(shape.seen) ? shape.seen.filter((n) => Number.isFinite(n)) : [],
    });
  }

  get offset(): number {
    return this.offsetValue;
  }

  has(updateId: number): boolean {
    return this.seen.has(updateId);
  }

  mark(updateId: number): void {
    if (this.seen.has(updateId)) return;
    this.seen.add(updateId);
    this.order.push(updateId);
    while (this.order.length > RING_SIZE) {
      const dropped = this.order.shift();
      if (dropped !== undefined) this.seen.delete(dropped);
    }
    if (updateId + 1 > this.offsetValue) this.offsetValue = updateId + 1;
    this.persist();
  }

  private persist(): void {
    writeJsonAtomic(this.file, { offset: this.offsetValue, seen: this.order });
  }
}
