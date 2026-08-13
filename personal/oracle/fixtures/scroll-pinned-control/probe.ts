import { type Probe, loadModule } from '../../lib/probe';

export const probe: Probe = {
  kind: 'natural',
  async run(variantDir) {
    const { overlapsControl } = await loadModule(variantDir);
    const overlapping = overlapsControl(0);
    return {
      red: overlapping,
      detail: overlapping
        ? 'the close control sits on top of content'
        : 'nothing overlaps the close control in the state the screenshot was taken in',
    };
  },
};
