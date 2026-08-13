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
  taxesIncluded: boolean;
}

export interface UblDocument {
  netTotal: number;
  taxTotal: number;
  payableAmount: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function splitTax(gross: number, vatRate: number): { net: number; tax: number } {
  const net = round2(gross / (1 + vatRate));
  return { net, tax: round2(gross - net) };
}

export function buildUbl(order: OrderInput): UblDocument {
  const gross = round2(order.lines.reduce((sum, l) => sum + l.price * l.quantity, 0));
  if (order.taxesIncluded) {
    const { net, tax } = splitTax(gross, order.vatRate);
    return { netTotal: net, taxTotal: tax, payableAmount: round2(net + tax) };
  }
  const taxTotal = round2(gross * order.vatRate);
  return { netTotal: gross, taxTotal, payableAmount: round2(gross + taxTotal) };
}

export function orderFromShopify(raw: {
  id: string;
  total_price: number;
  vat_rate: number;
  taxes_included: boolean;
  lines: OrderLine[];
}): OrderInput {
  return {
    id: raw.id,
    totalPrice: raw.total_price,
    vatRate: raw.vat_rate,
    taxesIncluded: raw.taxes_included,
    lines: raw.lines,
  };
}
