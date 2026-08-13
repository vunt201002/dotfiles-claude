export interface Refund {
  id: string;
  lineTotal: number;
  shippingTotal: number;
}

export interface CreditNote {
  sourceKey: string;
  total: number;
}

export interface RefundReader {
  fetchRefundDetail(id: string): Refund;
}

export class DocumentStore {
  private readonly keys = new Set<string>();
  private readonly notes: CreditNote[] = [];

  claim(sourceKey: string): boolean {
    if (this.keys.has(sourceKey)) return false;
    this.keys.add(sourceKey);
    return true;
  }

  release(sourceKey: string): void {
    this.keys.delete(sourceKey);
  }

  issue(note: CreditNote): void {
    this.notes.push(note);
  }

  find(sourceKey: string): CreditNote | undefined {
    return this.notes.find(n => n.sourceKey === sourceKey);
  }
}

export function issueFromWebhook(
  payload: { id: string; lineTotal: number },
  reader: RefundReader,
  store: DocumentStore,
): void {
  const sourceKey = `refund:${payload.id}`;
  if (!store.claim(sourceKey)) return;
  try {
    const detail = reader.fetchRefundDetail(payload.id);
    store.issue({ sourceKey, total: detail.lineTotal + detail.shippingTotal });
  } catch (err) {
    store.release(sourceKey);
    throw err;
  }
}

export function reconcileSweep(refundId: string, reader: RefundReader, store: DocumentStore): void {
  const sourceKey = `refund:${refundId}`;
  if (!store.claim(sourceKey)) return;
  const detail = reader.fetchRefundDetail(refundId);
  store.issue({ sourceKey, total: detail.lineTotal + detail.shippingTotal });
}
