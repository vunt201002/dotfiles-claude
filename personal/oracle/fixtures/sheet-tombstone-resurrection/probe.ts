import { type Probe, loadModule } from '../../lib/probe';

export const probe: Probe = {
  kind: 'natural',
  async run(variantDir) {
    const { syncRows } = await loadModule(variantDir);
    const rows = [
      { pid: 'p-100', title: 'Fix checkout total', status: 'Done', points: 3, date: '2026-08-01' },
      { pid: 'p-200', title: '', status: '', points: '', date: '' },
    ];
    const notionTasks = [
      { pid: 'p-100', title: 'Fix checkout total', status: 'Done', points: 3, date: '2026-08-01' },
      { pid: 'p-200', title: 'Task the user deleted by hand', status: 'In progress', points: 5, date: '2026-07-20' },
    ];
    const out = syncRows(rows, notionTasks);
    const deleted = out.find((r: any) => r.pid === 'p-200');
    const resurrected = Boolean(deleted && deleted.title);
    return {
      red: resurrected,
      detail: resurrected
        ? `a row the user cleared by hand came back as "${deleted.title}"`
        : 'the hand-cleared row stayed cleared',
    };
  },
};
