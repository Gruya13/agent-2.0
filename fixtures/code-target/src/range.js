/**
 * Parsira opseg "1-5" ili pojedinačan broj "7" u { from, to }.
 *
 * POZNATI BUG: nula je falsy, pa se granica 0 gubi.
 */
export function parseRange(text) {
  const [a, b] = String(text).trim().split('-');
  const from = Number(a) || null;
  const to = b === undefined ? from : Number(b) || null;
  return { from, to };
}
