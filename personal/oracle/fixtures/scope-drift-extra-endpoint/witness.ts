import { type Probe, loadModule } from '../../lib/probe';

const REQUESTED = ['/cart/summary'];

export const witness: Probe = {
  kind: 'targeted',
  async run(variantDir) {
    const { routes } = await loadModule(variantDir);
    const shipped = routes.map((r: any) => r.path).sort();
    const extra = shipped.filter((p: string) => !REQUESTED.includes(p));
    return {
      red: extra.length > 0,
      detail: extra.length > 0
        ? `the change shipped ${extra.length} routes nobody asked for: ${extra.join(', ')}`
        : 'the change shipped exactly the requested surface',
    };
  },
};
