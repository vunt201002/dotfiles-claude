const adminCard = {
  surface: 'admin',
  className: 'reward-card',
  padding: 'var(--space-4)',
  gap: 'var(--space-3)',
};

const storefrontCard = {
  surface: 'storefront',
  className: 'reward-card',
  padding: 'var(--space-4)',
  gap: 'var(--space-3)',
};

const previewCard = {
  surface: 'preview',
  className: 'reward-card',
  padding: 'var(--space-3)',
  gap: 'var(--space-3)',
};

export const surfaces = [adminCard, storefrontCard, previewCard];

export function renderCard(surface) {
  const found = surfaces.find(s => s.surface === surface);
  if (!found) throw new Error(`unknown surface: ${surface}`);
  return { padding: found.padding, gap: found.gap };
}
