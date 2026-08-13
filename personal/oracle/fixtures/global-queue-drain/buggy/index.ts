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

  size(): number {
    return this.rows.length;
  }
}

export function drainQueue(store: QueueStore, _runId: string): QueueRow[] {
  return store.takeAll();
}
