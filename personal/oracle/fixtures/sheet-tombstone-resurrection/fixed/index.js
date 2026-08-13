const PID_COL = 'pid';

function isTombstone(row) {
  const visible = [row.title, row.status, row.points, row.date];
  return Boolean(row[PID_COL]) && visible.every(v => v === '' || v === null || v === undefined);
}

export function syncRows(rows, notionTasks) {
  const byPid = new Map(rows.map(r => [r[PID_COL], r]));
  const out = rows.map(r => ({ ...r }));
  for (const task of notionTasks) {
    const existing = byPid.get(task.pid);
    if (existing) {
      if (isTombstone(existing)) continue;
      const idx = out.findIndex(r => r[PID_COL] === task.pid);
      out[idx] = { ...out[idx], title: task.title, status: task.status, points: task.points, date: task.date };
    } else if (!byPid.has(task.pid)) {
      out.push({ [PID_COL]: task.pid, title: task.title, status: task.status, points: task.points, date: task.date });
    }
  }
  return out;
}

export { isTombstone };
