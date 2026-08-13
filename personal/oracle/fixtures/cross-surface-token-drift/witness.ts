import { type Probe, loadModule } from '../../lib/probe';

export const witness: Probe = {
  kind: 'targeted',
  async run(variantDir) {
    const { surfaces, renderCard } = await loadModule(variantDir);
    const rendered = surfaces.map((s: any) => ({ surface: s.surface, ...renderCard(s.surface) }));
    const paddings = new Set(rendered.map((r: any) => r.padding));
    const drifted = paddings.size > 1;
    return {
      red: drifted,
      detail: drifted
        ? `the same card renders ${paddings.size} different paddings across ${rendered.length} surfaces: ${rendered.map((r: any) => `${r.surface}=${r.padding}`).join(', ')}`
        : 'every surface renders the same token step',
    };
  },
};
