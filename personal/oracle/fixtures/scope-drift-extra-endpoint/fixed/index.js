function cartSummary(cart) {
  const subtotal = cart.items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const discount = cart.code === 'SAVE10' ? Math.round(subtotal * 0.1) : 0;
  return { subtotal, discount, total: subtotal - discount };
}

export const routes = [
  { path: '/cart/summary', handler: cartSummary },
];

export { cartSummary };
