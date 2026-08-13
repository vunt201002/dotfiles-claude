import * as fs from 'node:fs';
import * as path from 'node:path';

export function defaultVaultDir(scriptPath) {
  const real = fs.realpathSync(scriptPath);
  return path.resolve(path.dirname(real), '..', '..', '..', 'brain-vault');
}
