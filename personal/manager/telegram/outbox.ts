import { readJson, writeJsonAtomic } from './store';

export type OutboundKind = 'report' | 'question' | 'approval' | 'notice' | 'reply';

export interface OutboundItem {
  id: string;
  chatId: string;
  kind: OutboundKind;
  text: string;
  replyMarkup?: unknown;
  enqueuedAt: number;
  attempts: number;
  meta?: Record<string, unknown>;
}

interface OutboxShape {
  items: OutboundItem[];
  seq: number;
}

const EVICTABLE: ReadonlySet<OutboundKind> = new Set<OutboundKind>(['report', 'notice', 'reply']);

/**
 * Disk-backed FIFO of messages owed to Telegram. Survives restarts so a
 * Telegram outage never strands a task waiting on an approval or a question.
 * The size limit is soft when every queued item is protected: approvals and
 * questions remain durable until delivery instead of being silently evicted.
 * A failed head rotates behind its peers so one permanently bad payload cannot
 * prevent every later protected item from being attempted.
 */
export class Outbox {
  private items: OutboundItem[];
  private seq: number;

  private constructor(
    private readonly file: string,
    private readonly maxItems: number,
    shape: OutboxShape,
  ) {
    this.items = shape.items;
    this.seq = shape.seq;
  }

  static load(file: string, maxItems = 500): Outbox {
    const result = readJson<OutboxShape>(file);
    if (!result.ok && result.kind === 'error') {
      throw new Error(`cannot read Telegram outbox: ${result.reason}`);
    }
    const shape = result.ok ? result.value : { items: [], seq: 0 };
    const items = Array.isArray(shape.items) ? shape.items.filter((item) => item && typeof item.text === 'string') : [];
    return new Outbox(file, maxItems, { items, seq: Number.isFinite(shape.seq) ? shape.seq : 0 });
  }

  get size(): number {
    return this.items.length;
  }

  list(): readonly OutboundItem[] {
    return this.items;
  }

  enqueue(input: Omit<OutboundItem, 'id' | 'enqueuedAt' | 'attempts'>): OutboundItem {
    this.seq += 1;
    const item: OutboundItem = {
      ...input,
      id: `${Date.now().toString(36)}-${this.seq}`,
      enqueuedAt: Date.now(),
      attempts: 0,
    };
    this.items.push(item);
    const evicted = this.evictIfNeeded();
    this.persist();
    if (evicted.length > 0) this.onEvict?.(evicted);
    return item;
  }

  onEvict?: (items: OutboundItem[]) => void;

  peek(): OutboundItem | undefined {
    return this.items[0];
  }

  resolve(id: string): void {
    const before = this.items.length;
    this.items = this.items.filter((item) => item.id !== id);
    if (this.items.length !== before) this.persist();
  }

  fail(id: string): void {
    const index = this.items.findIndex((entry) => entry.id === id);
    if (index < 0) return;
    const item = this.items[index]!;
    item.attempts += 1;
    if (index === 0 && this.items.length > 1) {
      this.items.push(...this.items.splice(0, 1));
    }
    this.persist();
  }

  private evictIfNeeded(): OutboundItem[] {
    if (this.items.length <= this.maxItems) return [];
    const evicted: OutboundItem[] = [];
    while (this.items.length > this.maxItems) {
      const index = this.items.findIndex((item) => EVICTABLE.has(item.kind));
      if (index < 0) break;
      const [removed] = this.items.splice(index, 1);
      if (removed) evicted.push(removed);
    }
    return evicted;
  }

  private persist(): void {
    writeJsonAtomic(this.file, { items: this.items, seq: this.seq });
  }
}
