import * as path from 'node:path';

export function defaultVaultDir(scriptPath) {
  return path.resolve(path.dirname(scriptPath), '..', '..', '..', 'brain-vault');
}
