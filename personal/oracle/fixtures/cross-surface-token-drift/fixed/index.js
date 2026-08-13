const REWARD_CARD = {
  className: 'reward-card',
  padding: 'var(--space-4)',
  gap: 'var(--space-3)',
};

export const surfaces = ['admin', 'storefront', 'preview'].map(surface => ({
  surface,
  ...REWARD_CARD,
}));

export function renderCard(surface) {
  const found = surfaces.find(s => s.surface === surface);
  if (!found) throw new Error(`unknown surface: ${surface}`);
  return { padding: found.padding, gap: found.gap };
}
