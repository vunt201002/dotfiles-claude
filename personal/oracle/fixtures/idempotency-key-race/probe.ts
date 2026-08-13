import { type Probe, loadModule } from '../../lib/probe';

export const probe: Probe = {
  kind: 'natural',
  async run(variantDir) {
    const { DocumentStore, issueFromWebhook, reconcileSweep } = await loadModule(variantDir);
    const store = new DocumentStore();
    let readerUp = false;
    const reader = {
      fetchRefundDetail(id: string) {
        if (!readerUp) throw new Error('shopify unreachable');
        return { id, lineTotal: 40, shippingTotal: 21 };
      },
    };

    try {
      issueFromWebhook({ id: '55', lineTotal: 40 }, reader, store);
    } catch {
      /* the fixed path rethrows so the queue can retry — that is the behaviour under test */
    }
    readerUp = true;
    reconcileSweep('55', reader, store);

    const note = store.find('refund:55');
    const correct = Boolean(note) && Math.abs(note.total - 61) < 0.01;
    return {
      red: !correct,
      detail: correct
        ? 'the sweep issued the full credit once the reader came back'
        : `the stored credit note is ${note ? note.total : 'missing'} instead of 61 — the losing path spent the idempotency key, so the correct document can never be issued`,
    };
  },
};
