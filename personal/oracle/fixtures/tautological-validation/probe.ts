import { type Probe, loadModule } from '../../lib/probe';

export const probe: Probe = {
  kind: 'natural',
  async run(variantDir) {
    const { retryTransmission } = await loadModule(variantDir);
    const doc = {
      id: 'cn-1',
      kind: 'credit-note' as const,
      sourceKey: 'refund:55',
      lines: [{ sku: 'A', amount: 40 }],
      totalAmount: 40,
      errorMessage: 'held: credits 21 too little',
    };
    const reader = { refundTotal: () => 61 };
    const out = retryTransmission(doc, reader);
    return {
      red: out.transmitted,
      detail: out.transmitted
        ? 'a credit note held for crediting too little was transmitted by one retry, because validation compared the document with itself'
        : `retry refused: ${out.reason}`,
    };
  },
};
