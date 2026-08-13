import { type Probe, loadModule } from '../../lib/probe';

export const probe: Probe = {
  kind: 'natural',
  async run(variantDir) {
    const { runIntegrationSuite } = await loadModule(variantDir);
    const cases = [
      { name: 'invoice persists', run: () => true },
      { name: 'queue drains', run: () => true },
    ];
    const result = runIntegrationSuite({}, cases);
    const lookedGreen = result.status === 'ok' && result.ran === 0;
    return {
      red: lookedGreen,
      detail: lookedGreen
        ? `${cases.length} integration cases did not run and the suite still reported ok`
        : `suite reported "${result.status}" — ${result.note || 'ran for real'}`,
    };
  },
};
