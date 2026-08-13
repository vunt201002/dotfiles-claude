import * as fs from 'node:fs';
import * as path from 'node:path';
import { type Probe, sandbox, cleanup, runBash, initGitRepo, git } from '../../lib/probe';

export const probe: Probe = {
  kind: 'natural',
  async run(variantDir) {
    const box = sandbox('stage-index');
    try {
      const repo = path.join(box, 'repo');
      fs.mkdirSync(repo, { recursive: true });
      initGitRepo(repo);

      fs.writeFileSync(path.join(repo, 'ci.yml'), 'staging-9:\n  only: [main]\n');
      git(repo, ['add', 'ci.yml']);
      git(repo, ['commit', '-q', '-m', 'add ci']);

      fs.writeFileSync(path.join(repo, 'ci.yml'), 'staging-9:\n  only: [feature/x]\n');
      fs.writeFileSync(path.join(repo, 'scratch-token.txt'), 'half-finished unrelated work\n');
      git(repo, ['add', 'scratch-token.txt']);

      runBash(path.join(variantDir, 'script.sh'), [repo]);

      const committed = git(repo, ['show', '--name-only', '--format=', 'HEAD'])
        .stdout.split('\n').map(l => l.trim()).filter(Boolean).sort();

      const onlyCi = committed.length === 1 && committed[0] === 'ci.yml';
      return {
        red: !onlyCi,
        detail: onlyCi
          ? 'the deploy commit contains ci.yml alone'
          : `the deploy commit swept in unrelated files: ${committed.join(', ')}`,
      };
    } finally {
      cleanup(box);
    }
  },
};
