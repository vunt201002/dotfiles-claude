import { type Probe, loadModule } from '../../lib/probe';

export const probe: Probe = {
  kind: 'natural',
  async run(variantDir) {
    const { appendTask } = await loadModule(variantDir);
    const rows = [
      { title: 'Fix checkout total', status: 'Done', points: 3, date: '2026-08-01', note: '', link: '', have: '', comment: '' },
      { title: '', status: 'In progress', points: 8, date: '2026-08-09', note: 'waiting on QC', link: 'notion/abc', have: 'yes', comment: 'mine' },
    ];
    const before = JSON.stringify(rows[1]);
    const out = appendTask(rows, { title: 'New task from Notion', status: 'Todo', points: 2, date: '2026-08-12' });
    const after = JSON.stringify(out[1]);
    const overwritten = before !== after;
    return {
      red: overwritten,
      detail: overwritten
        ? 'a hand-edited row with a blank title but live data in every other column was overwritten by the append'
        : 'the hand-edited row was left alone',
    };
  },
};
