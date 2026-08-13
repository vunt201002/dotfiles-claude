import fs from 'node:fs';
import path from 'node:path';

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Writes through a temp file + rename so a crash mid-write cannot leave a
 * truncated state file. Falls back to a direct write when rename is refused
 * (Windows file locks from indexers or antivirus).
 */
export function writeJsonAtomic(file: string, value: unknown): void {
  ensureDir(path.dirname(file));
  const payload = JSON.stringify(value);
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  fs.writeFileSync(tmp, payload, 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch {
    fs.writeFileSync(file, payload, 'utf8');
    try {
      fs.unlinkSync(tmp);
    } catch {
      void 0;
    }
  }
}

export function appendLine(file: string, line: string): void {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, `${line}\n`, 'utf8');
}
