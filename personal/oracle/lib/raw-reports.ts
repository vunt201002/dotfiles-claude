import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { BackendName } from './llm-backends';

export type LlmGateName = 'spec-check' | 'reviewer';
export type CodeVariant = 'buggy' | 'fixed';

export interface RawReportManifest {
  format_version: 1;
  generated_at: string;
  source_run: string;
  gate_backends: Record<LlmGateName, BackendName>;
}

export interface RawReportRecord {
  gate: LlmGateName;
  fixture: string;
  variant: CodeVariant;
  gate_backend: BackendName;
  report: string;
}

export interface RawReportRun {
  dir: string;
  manifest: RawReportManifest;
}

export function rawReportsRoot(): string {
  return process.env.ORACLE_REPORTS_ROOT
    ? path.resolve(process.env.ORACLE_REPORTS_ROOT)
    : path.join(os.homedir(), '.gstack-dev', 'oracle-reports');
}

export function createRawReportRun(gateBackends: Record<LlmGateName, BackendName>): RawReportRun {
  const generatedAt = new Date().toISOString();
  const sourceRun = `${generatedAt.replace(/[:.]/g, '-')}-${process.pid}`;
  const dir = path.join(rawReportsRoot(), sourceRun);
  const manifest: RawReportManifest = {
    format_version: 1,
    generated_at: generatedAt,
    source_run: sourceRun,
    gate_backends: gateBackends,
  };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return { dir, manifest };
}

function recordPath(dir: string, gate: LlmGateName, fixture: string, variant: CodeVariant): string {
  return path.join(dir, gate, variant, `${fixture}.json`);
}

export function writeRawReport(run: RawReportRun, record: RawReportRecord): void {
  const file = recordPath(run.dir, record.gate, record.fixture, record.variant);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
}

export function readRawReport(run: RawReportRun, gate: LlmGateName, fixture: string, variant: CodeVariant): RawReportRecord {
  const file = recordPath(run.dir, gate, fixture, variant);
  if (!fs.existsSync(file)) throw new Error(`raw report missing for (${gate}, ${fixture}, ${variant}) in ${run.dir}`);
  const record = JSON.parse(fs.readFileSync(file, 'utf-8')) as RawReportRecord;
  if (record.gate !== gate || record.fixture !== fixture || record.variant !== variant) {
    throw new Error(`raw report key mismatch in ${file}`);
  }
  if (record.gate_backend !== run.manifest.gate_backends[gate]) {
    throw new Error(`raw report backend mismatch in ${file}: record=${record.gate_backend}, run=${run.manifest.gate_backends[gate]}`);
  }
  return record;
}

export function loadRawReportRun(dir: string): RawReportRun {
  const resolved = path.resolve(dir);
  const manifestFile = path.join(resolved, 'manifest.json');
  if (!fs.existsSync(manifestFile)) throw new Error(`raw report manifest not found: ${manifestFile}`);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf-8')) as RawReportManifest;
  if (manifest.format_version !== 1) throw new Error(`unsupported raw report format in ${manifestFile}`);
  return { dir: resolved, manifest };
}

export function latestRawReportRun(root: string = rawReportsRoot()): RawReportRun {
  if (!fs.existsSync(root)) throw new Error(`no raw report runs found in ${root}`);
  const candidates = fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(root, entry.name, 'manifest.json')))
    .map(entry => entry.name)
    .sort()
    .reverse();
  if (candidates.length === 0) throw new Error(`no raw report runs found in ${root}`);
  return loadRawReportRun(path.join(root, candidates[0]));
}
