import * as fs from 'node:fs';
import * as path from 'node:path';
import { type Probe, sandbox, cleanup, runBash, initGitRepo, git } from '../../lib/probe';

export const probe: Probe = {
  kind: 'natural',
  async run(variantDir) {
    const box = sandbox('denylist-variant');
    try {
      const repo = path.join(box, 'repo');
      fs.mkdirSync(repo, { recursive: true });
      initGitRepo(repo);

      const draft = path.join(repo, 'draft-notes.md');
      fs.writeFileSync(draft, 'three hours of uncommitted notes\n');

      runBash(path.join(variantDir, 'script.sh'), [repo]);

      const stillThere = fs.existsSync(draft);
      const stashed = git(repo, ['stash', 'list']).stdout.includes('oracle-sandbox');
      const recoverable = stillThere || stashed;

      return {
        red: !recoverable,
        detail: recoverable
          ? `untracked work survived (on disk: ${stillThere}, in stash: ${stashed})`
          : 'untracked work was destroyed with no way back',
      };
    } finally {
      cleanup(box);
    }
  },
};
