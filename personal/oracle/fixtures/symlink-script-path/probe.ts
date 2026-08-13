import * as fs from 'node:fs';
import * as path from 'node:path';
import { type Probe, sandbox, cleanup, loadModule } from '../../lib/probe';

export const probe: Probe = {
  kind: 'natural',
  async run(variantDir) {
    const { defaultVaultDir } = await loadModule(variantDir);
    const box = sandbox('symlink-path');
    try {
      const repo = path.join(box, 'dotfiles-claude', 'personal');
      const skillDir = path.join(repo, 'skills', 'note');
      fs.mkdirSync(path.join(skillDir, 'scripts'), { recursive: true });
      fs.mkdirSync(path.join(repo, 'brain-vault'), { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'scripts', 'note.js'), 'export const noop = 0;\n');

      const linkParent = path.join(box, 'home', '.claude', 'skills');
      fs.mkdirSync(linkParent, { recursive: true });
      const link = path.join(linkParent, 'note');
      try {
        fs.symlinkSync(skillDir, link, 'junction');
      } catch (err: any) {
        return { red: false, detail: `SKIPPED-LOUD: cannot create a link on this machine (${err.code ?? err.message})` };
      }

      const viaLink = path.join(link, 'scripts', 'note.js');
      const resolved: string = defaultVaultDir(viaLink);
      const expected = path.join(repo, 'brain-vault');
      const insideRepo = path.resolve(resolved) === path.resolve(expected);

      return {
        red: !insideRepo,
        detail: insideRepo
          ? 'vault resolved inside the checkout'
          : `notes would be written to ${resolved}, outside the checkout, so they never get committed`,
      };
    } finally {
      cleanup(box);
    }
  },
};
