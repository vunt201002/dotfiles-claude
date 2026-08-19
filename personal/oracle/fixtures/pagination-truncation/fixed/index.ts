export interface LineItem {
  sku: string;
  amount: number;
}

export interface Order {
  id: string;
  totalPrice: number;
  lines: LineItem[];
}

export interface Invoice {
  orderId: string;
  lines: LineItem[];
  totalAmount: number;
}

const PAGE_SIZE = 50;

export function fetchOrderDetail(order: Order): Order {
  const lines: LineItem[] = [];
  for (let page = 0; ; page++) {
    const chunk = order.lines.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    if (chunk.length === 0) break;
    lines.push(...chunk);
  }
  return { ...order, lines };
}

export function buildInvoice(order: Order): Invoice {
  const lines = order.lines;
  return {
    orderId: order.id,
    lines,
    totalAmount: lines.reduce((sum, l) => sum + l.amount, 0),
  };
}

export function reconcileAgainstOrderTotal(
  invoice: Invoice,
  chargedTotal: number,
): { ok: boolean; reason: string } {
  const ok = Math.abs(invoice.totalAmount - chargedTotal) < 0.01;
  return { ok, reason: ok ? '' : 'document total does not match what the customer was charged' };
}

export function issueInvoice(order: Order): { invoice: Invoice; held: boolean } {
  const fetched = fetchOrderDetail(order);
  const invoice = buildInvoice(fetched);
  const check = reconcileAgainstOrderTotal(invoice, order.totalPrice);
  return { invoice, held: !check.ok };
}
