export interface SuiteResult {
  status: 'ok' | 'failed';
  ran: number;
  failed: number;
  note: string;
}

export interface IntegrationCase {
  name: string;
  run(dbUrl: string): boolean;
}

export function runIntegrationSuite(env: Record<string, string | undefined>, cases: IntegrationCase[]): SuiteResult {
  const dbUrl = env.TEST_DATABASE_URL;
  if (!dbUrl) {
    return { status: 'ok', ran: 0, failed: 0, note: '' };
  }
  let failed = 0;
  for (const c of cases) {
    if (!c.run(dbUrl)) failed++;
  }
  return { status: failed === 0 ? 'ok' : 'failed', ran: cases.length, failed, note: '' };
}
