import { type Probe, loadModule } from '../../lib/probe';

export const probe: Probe = {
  kind: 'natural',
  async run(variantDir) {
    const { buildUbl } = await loadModule(variantDir);
    const order = {
      id: 'o-2',
      totalPrice: 72.6,
      vatRate: 0.21,
      taxesIncluded: true,
      lines: [
        { sku: 'ITEM', price: 60.5, quantity: 1 },
        { sku: 'SHIP', price: 12.1, quantity: 1 },
      ],
    };
    const ubl = buildUbl(order);
    const matches = Math.abs(ubl.payableAmount - order.totalPrice) < 0.01;
    return {
      red: !matches,
      detail: matches
        ? 'the document demands exactly what the customer paid'
        : `the document demands ${ubl.payableAmount} while the customer paid ${order.totalPrice}`,
    };
  },
};
