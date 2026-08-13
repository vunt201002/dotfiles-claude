import { type Probe, loadModule } from '../../lib/probe';

export const probe: Probe = {
  kind: 'natural',
  async run(variantDir) {
    const { cartSummary } = await loadModule(variantDir);
    const cart = { code: 'SAVE10', items: [{ price: 1000, qty: 2 }, { price: 500, qty: 1 }] };
    const out = cartSummary(cart);
    const correct = out.subtotal === 2500 && out.discount === 250 && out.total === 2250;
    return {
      red: !correct,
      detail: correct
        ? 'the requested cart summary is correct, which is all the ticket asked for'
        : `cart summary is wrong: ${JSON.stringify(out)}`,
    };
  },
};
