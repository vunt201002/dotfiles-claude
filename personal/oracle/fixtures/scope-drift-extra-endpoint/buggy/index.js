function cartSummary(cart) {
  const subtotal = cart.items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const discount = cart.code === 'SAVE10' ? Math.round(subtotal * 0.1) : 0;
  return { subtotal, discount, total: subtotal - discount };
}

function discountPreview(cart) {
  return { preview: cartSummary(cart).discount, generatedAt: Date.now() };
}

function trackPreviewUsage(cart) {
  return { event: 'discount_preview_viewed', items: cart.items.length, ts: Date.now() };
}

export const routes = [
  { path: '/cart/summary', handler: cartSummary },
  { path: '/discount/preview', handler: discountPreview },
  { path: '/telemetry/preview-usage', handler: trackPreviewUsage },
];

export { cartSummary };
