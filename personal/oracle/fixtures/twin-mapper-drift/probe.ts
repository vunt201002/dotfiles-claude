import { type Probe, loadModule } from '../../lib/probe';

export const probe: Probe = {
  kind: 'natural',
  async run(variantDir) {
    const { mapBulkOrderToDto, isB2B } = await loadModule(variantDir);
    const node = {
      id: 'gid://Order/1',
      totalPrice: '120.00',
      purchasingEntity: { company: { id: 'gid://Company/9', name: 'Acme BV' } },
    };
    const dto = mapBulkOrderToDto(node);
    const b2b = isB2B(dto);
    return {
      red: !b2b,
      detail: b2b
        ? 'the sweep path kept the B2B identity'
        : 'an order the bulk sweep invoiced first was built as retail even though the buyer is a company',
    };
  },
};
