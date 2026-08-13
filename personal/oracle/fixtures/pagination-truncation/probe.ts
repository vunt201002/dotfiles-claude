import { type Probe, loadModule } from '../../lib/probe';

export const probe: Probe = {
  kind: 'natural',
  async run(variantDir) {
    const { issueInvoice } = await loadModule(variantDir);
    const lines = Array.from({ length: 60 }, (_, i) => ({ sku: `SKU-${i}`, amount: 10 }));
    const order = { id: 'o-1', totalPrice: 600, lines };
    const { invoice, held } = issueInvoice(order);
    const short = invoice.totalAmount < order.totalPrice;
    return {
      red: short,
      detail: short
        ? `invoice charged ${invoice.totalAmount} against an order total of ${order.totalPrice}${held ? ' (held)' : ' and every guard passed it'}`
        : 'invoice total matches what the customer was charged',
    };
  },
};
