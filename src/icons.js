// Shape-coded symbols so nothing depends on colour alone:
// Sun = ☉ (circle with centre dot), Earth = ⊕ (circle with cross), Both = overlap.
export function icon(kind, cls = '') {
  if (kind === 'sun')
    return `<svg class="ico ico-sun ${cls}" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7"/><circle cx="10" cy="10" r="2" class="fill"/></svg>`;
  if (kind === 'earth')
    return `<svg class="ico ico-earth ${cls}" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="M10 3v14M3 10h14"/></svg>`;
  return `<svg class="ico ico-both ${cls}" viewBox="0 0 20 20" aria-hidden="true"><circle cx="7.5" cy="10" r="5.5"/><circle cx="12.5" cy="10" r="5.5"/></svg>`;
}
