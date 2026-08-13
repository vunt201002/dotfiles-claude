export interface QueueRow {
  id: string;
  runId: string;
  payload: string;
}

export class QueueStore {
  private rows: QueueRow[] = [];

  enqueue(row: QueueRow): void {
    this.rows.push(row);
  }

  takeAll(): QueueRow[] {
    const taken = this.rows;
    this.rows = [];
    return taken;
  }

  takeForRun(runId: string): QueueRow[] {
    const mine = this.rows.filter(r => r.runId === runId);
    this.rows = this.rows.filter(r => r.runId !== runId);
    return mine;
  }

  size(): number {
    return this.rows.length;
  }
}

export function drainQueue(store: QueueStore, runId: string): QueueRow[] {
  return store.takeForRun(runId);
}
