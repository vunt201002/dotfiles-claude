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
  return { ...order, lines: order.lines.slice(0, PAGE_SIZE) };
}

export function buildInvoice(order: Order): Invoice {
  const lines = order.lines;
  return {
    orderId: order.id,
    lines,
    totalAmount: lines.reduce((sum, l) => sum + l.amount, 0),
  };
}

export function reconcile(invoice: Invoice): { ok: boolean; reason: string } {
  const lineSum = invoice.lines.reduce((sum, l) => sum + l.amount, 0);
  const ok = Math.abs(lineSum - invoice.totalAmount) < 0.01;
  return { ok, reason: ok ? '' : 'line sum does not match document total' };
}

export function issueInvoice(order: Order): { invoice: Invoice; held: boolean } {
  const fetched = fetchOrderDetail(order);
  const invoice = buildInvoice(fetched);
  const check = reconcile(invoice);
  return { invoice, held: !check.ok };
}
