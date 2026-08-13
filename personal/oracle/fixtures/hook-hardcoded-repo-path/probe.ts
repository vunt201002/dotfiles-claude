import * as fs from 'node:fs';
import * as path from 'node:path';
import { type Probe, sandbox, cleanup, runBash } from '../../lib/probe';

export const probe: Probe = {
  kind: 'natural',
  async run(variantDir) {
    const box = sandbox('hardcoded-repo');
    try {
      const personal = path.join(box, 'personal');
      const hooks = path.join(personal, 'hooks');
      fs.mkdirSync(hooks, { recursive: true });
      const script = path.join(hooks, 'harness-check.sh');
      fs.copyFileSync(path.join(variantDir, 'script.sh'), script);

      const fakeHome = path.join(box, 'home');
      fs.mkdirSync(fakeHome, { recursive: true });

      const res = runBash(script, [], { HOME: fakeHome, USERPROFILE: fakeHome });
      const ran = res.stdout.includes('AUDIT_RAN');
      return {
        red: !ran,
        detail: ran
          ? 'audit ran and reported its repo root'
          : `audit produced no output at all (exit ${res.code}) — the check silently did nothing`,
      };
    } finally {
      cleanup(box);
    }
  },
};
