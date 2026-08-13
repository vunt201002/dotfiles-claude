import { type Probe, loadModule } from '../../lib/probe';

export const witness: Probe = {
  kind: 'targeted',
  async run(variantDir) {
    const { overlapsControl } = await loadModule(variantDir);
    const positions = [0, 120, 240, 360];
    const hits = positions.filter(p => overlapsControl(p));
    return {
      red: hits.length > 0,
      detail: hits.length > 0
        ? `content runs under the control at scrollTop ${hits.join(', ')}`
        : `no overlap at any of scrollTop ${positions.join(', ')}`,
    };
  },
};
