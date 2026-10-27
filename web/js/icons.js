// Inline icons from the sprite in index.html (one 24-grid, 1.75-stroke set).
export const ico = (name, cls = 'i') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
// "2 part(s)" -> "2 parts", "1 loop(s)" -> "1 loop" (planner strings use the (s) form).
export const plural = (t) => String(t).replace(/(\d[\d.,]*)\s+([A-Za-z-]+(?: [A-Za-z-]+)?)\(s\)/g, (_, n, w) => `${n} ${w}${+n.replace(/,/g, '') === 1 ? '' : 's'}`);
