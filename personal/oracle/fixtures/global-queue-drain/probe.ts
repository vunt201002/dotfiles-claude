import { type Probe, loadModule } from '../../lib/probe';

export const probe: Probe = {
  kind: 'natural',
  async run(variantDir) {
    const { QueueStore, drainQueue } = await loadModule(variantDir);
    const store = new QueueStore();
    store.enqueue({ id: 'a1', runId: 'run-a', payload: 'a' });
    store.enqueue({ id: 'b1', runId: 'run-b', payload: 'b' });

    const takenByA = drainQueue(store, 'run-a');
    const takenByB = drainQueue(store, 'run-b');

    const clean = takenByA.length === 1 && takenByA[0].runId === 'run-a'
      && takenByB.length === 1 && takenByB[0].runId === 'run-b';
    return {
      red: !clean,
      detail: clean
        ? 'each run drained only its own rows'
        : `run-a took ${takenByA.length} rows and run-b took ${takenByB.length} — two concurrent runs eat one another's rows`,
    };
  },
};
