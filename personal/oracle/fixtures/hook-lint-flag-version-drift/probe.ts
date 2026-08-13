import * as fs from 'node:fs';
import * as path from 'node:path';
import { type Probe, sandbox, cleanup, runBash, stubBin } from '../../lib/probe';

const OLD_ESLINT = `
for arg in "$@"; do
  if [ "$arg" = "--no-warn-ignored" ]; then
    echo "Invalid option '--no-warn-ignored' - perhaps you meant '--no-warn-ignored'?" >&2
    echo "You're using eslint 8.57.0. warn-ignored is not a known option." >&2
    exit 2
  fi
done
exit 0
`;

export const probe: Probe = {
  kind: 'natural',
  async run(variantDir) {
    const box = sandbox('lint-flag-drift');
    try {
      const env = stubBin(box, 'oracle-eslint', OLD_ESLINT);
      const clean = path.join(box, 'clean.ts');
      fs.writeFileSync(clean, 'export const answer = 42;\n');

      const res = runBash(path.join(variantDir, 'script.sh'), [clean], {
        ...env,
        ORACLE_LINT_CMD: 'oracle-eslint --no-warn-ignored',
      });

      const blocked = res.code === 2;
      return {
        red: blocked,
        detail: blocked
          ? 'a file with no lint errors was blocked because the CLI rejected the flag before linting'
          : 'clean file passed the hook',
      };
    } finally {
      cleanup(box);
    }
  },
};
