import { type Probe, loadModule } from '../../lib/probe';

export const probe: Probe = {
  kind: 'natural',
  async run(variantDir) {
    const { countTasks } = await loadModule(variantDir);
    const saves = [
      { branch: 'hotfix/bfs-prod-91', nextAction: 'ship the guard' },
      { branch: 'hotfixbfs-prod-91', nextAction: 'stale: still writing the repro' },
    ];
    const tasks = countTasks(saves);
    return {
      red: tasks.length !== 1,
      detail: tasks.length === 1
        ? 'one branch counted once'
        : `one branch showed up as ${tasks.length} tasks in the standup, each with its own next action`,
    };
  },
};
