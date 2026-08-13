import * as fs from 'node:fs';
import * as path from 'node:path';
import { type Probe, sandbox, cleanup, runBash, stubBin } from '../../lib/probe';

const NPX_NO_CONFIG = `
echo "Version 5.9.2" >&2
echo "tsc: The 'files' list in config file 'tsconfig.json' is empty." >&2
echo "COMMON COMMANDS" >&2
exit 1
`;

export const probe: Probe = {
  kind: 'natural',
  async run(variantDir) {
    const box = sandbox('gate-no-config');
    try {
      const repo = path.join(box, 'joy-extensions');
      fs.mkdirSync(repo, { recursive: true });
      fs.writeFileSync(path.join(repo, 'README.md'), 'no root tsconfig here\n');

      const env = stubBin(box, 'npx', NPX_NO_CONFIG);
      const res = runBash(path.join(variantDir, 'script.sh'), [repo], env);

      const blocked = res.code === 2;
      return {
        red: blocked,
        detail: blocked
          ? 'the stop gate reported FAIL on a repo that has no root tsconfig, so every turn is blocked by a check that never ran'
          : 'gate exited quietly when there was nothing real to check',
      };
    } finally {
      cleanup(box);
    }
  },
};
