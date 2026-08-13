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

export function orderFromShopify(raw: { id: string; total_price: number; vat_rate: number; lines: OrderLine[] }): OrderInput {
  return { id: raw.id, totalPrice: raw.total_price, vatRate: raw.vat_rate, lines: raw.lines };
}
