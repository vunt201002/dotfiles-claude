const DATA_COLS = ['title', 'status', 'points', 'date', 'note', 'link', 'have', 'comment'];

export function findAppendRow(rows) {
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i].title) return i;
  }
  return rows.length;
}

export function appendTask(rows, task) {
  const idx = findAppendRow(rows);
  const out = rows.map(r => ({ ...r }));
  const blank = Object.fromEntries(DATA_COLS.map(c => [c, '']));
  out[idx] = { ...blank, ...task };
  return out;
}
