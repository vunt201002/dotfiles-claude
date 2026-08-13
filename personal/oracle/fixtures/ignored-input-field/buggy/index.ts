export interface OrderLine {
  sku: string;
  price: number;
  quantity: number;
}

export interface OrderInput {
  id: string;
  totalPrice: number;
  vatRate: number;
  lines: OrderLine[];
  taxesIncluded?: boolean;
}

export interface UblDocument {
  netTotal: number;
  taxTotal: number;
  payableAmount: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildUbl(order: OrderInput): UblDocument {
  const netTotal = round2(order.lines.reduce((sum, l) => sum + l.price * l.quantity, 0));
  const taxTotal = round2(netTotal * order.vatRate);
  return { netTotal, taxTotal, payableAmount: round2(netTotal + taxTotal) };
}

export function orderFromShopify(raw: { id: string; total_price: number; vat_rate: number; lines: OrderLine[] }): OrderInput {
  return { id: raw.id, totalPrice: raw.total_price, vatRate: raw.vat_rate, lines: raw.lines };
}
