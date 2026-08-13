import { type Probe, loadModule } from '../../lib/probe';

export const probe: Probe = {
  kind: 'natural',
  async run(variantDir) {
    const { renderCard } = await loadModule(variantDir);
    const reported = renderCard('admin');
    const wrong = reported.padding !== 'var(--space-4)';
    return {
      red: wrong,
      detail: wrong
        ? `admin card padding is ${reported.padding}`
        : 'admin card matches the spec, which is the only surface QC named',
    };
  },
};
