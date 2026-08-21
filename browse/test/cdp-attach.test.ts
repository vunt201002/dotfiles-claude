import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  assertCdpAttachRuntime,
  CdpAttachConfigError,
  formatCdpAttachFailure,
  isCdpAttachRestrictedCommand,
  resolveCdpAttachEndpoint,
} from '../src/cdp-attach';
import { buildRestartEnv, extractGlobalFlags, nodeServerSupportsCdp, resolveServerRuntime } from '../src/cli';

describe('CDP attach endpoint', () => {
  test('attach mode resolves an explicit loopback HTTP endpoint', () => {
    expect(resolveCdpAttachEndpoint('http://127.0.0.1:9222')).toBe('http://127.0.0.1:9222');
    expect(resolveCdpAttachEndpoint('http://localhost:9333/')).toBe('http://localhost:9333');
  });

  test('attach mode rejects non-loopback and credential-bearing endpoints', () => {
    expect(() => resolveCdpAttachEndpoint('http://192.168.1.5:9222')).toThrow(CdpAttachConfigError);
    expect(() => resolveCdpAttachEndpoint('http://user:pass@127.0.0.1:9222')).toThrow(/credentials/);
  });

  test('no-listener failure tells the operator exactly how to start Chrome', () => {
    const message = formatCdpAttachFailure(
      'http://127.0.0.1:9222',
      new Error('connect ECONNREFUSED 127.0.0.1:9222'),
      'darwin',
    );

    expect(message).toContain('Could not attach to Chrome at http://127.0.0.1:9222');
    expect(message).toContain('No fresh browser was launched');
    expect(message).toContain('"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222');
    expect(message).toContain('--user-data-dir="$HOME/.gstack/chrome-cdp-profile"');
  });

  test('global flag plumbing preserves attach mode across daemon startup and restart', () => {
    const flags = extractGlobalFlags(
      ['--cdp', 'http://127.0.0.1:9222', 'frame', 'iframe[name="app-iframe"]'],
      {},
    );

    expect(flags.args).toEqual(['frame', 'iframe[name="app-iframe"]']);
    expect(flags.cdpEndpoint).toBe('http://127.0.0.1:9222');
    expect(buildRestartEnv(flags, null).BROWSE_CDP_ENDPOINT).toBe('http://127.0.0.1:9222');
  });

  test('CDP attach is never routed through the Bun server', () => {
    expect(resolveServerRuntime('darwin', 'http://127.0.0.1:9222', '/dist/server-node.mjs', true)).toBe('node');
    expect(resolveServerRuntime('linux', 'http://127.0.0.1:9222', '/dist/server-node.mjs', true)).toBe('node');
    expect(resolveServerRuntime('darwin', null, '/dist/server-node.mjs')).toBe('bun');
    expect(() => resolveServerRuntime('darwin', 'http://127.0.0.1:9222', null)).toThrow(
      /current Node-compatible server bundle/,
    );
    expect(() => resolveServerRuntime('darwin', 'http://127.0.0.1:9222', '/dist/server-node.mjs', false)).toThrow(
      /current Node-compatible server bundle/,
    );
    expect(() => assertCdpAttachRuntime({ bun: '1.3.11' } as NodeJS.ProcessVersions)).toThrow(
      /must run in the Node server/,
    );
    expect(() => assertCdpAttachRuntime({ node: '24.14.1' } as NodeJS.ProcessVersions)).not.toThrow();
  });

  test('attach rejects a stale Node server bundle before launch', () => {
    const dir = mkdtempSync(join(tmpdir(), 'browse-cdp-bundle-'));
    const bundle = join(dir, 'server-node.mjs');
    try {
      writeFileSync(bundle, 'const endpoint = process.env.BROWSE_CDP_ENDPOINT;');
      expect(nodeServerSupportsCdp(bundle)).toBe(false);
      writeFileSync(bundle, 'const endpoint = process.env.BROWSE_CDP_ENDPOINT; async function attachOverCdp() {}');
      expect(nodeServerSupportsCdp(bundle)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('attach mode rejects launch-only flags', () => {
    expect(() => extractGlobalFlags(
      ['--cdp', 'http://127.0.0.1:9222', '--headed', 'tabs'],
      {},
    )).toThrow(/separate browser modes/);
    expect(() => extractGlobalFlags(
      ['--cdp', 'http://127.0.0.1:9222', '--proxy', 'http://127.0.0.1:8080', 'tabs'],
      {},
    )).toThrow(/cannot be combined with --proxy/);
  });

  test('attached profiles reject direct cookie and storage mutation by default', () => {
    expect(isCdpAttachRestrictedCommand('cookie-import', ['/tmp/cookies.json'])).toBe(true);
    expect(isCdpAttachRestrictedCommand('storage', ['set', 'key', 'value'])).toBe(true);
    expect(isCdpAttachRestrictedCommand('state', ['save', 'shopify'])).toBe(true);
    expect(isCdpAttachRestrictedCommand('click', ['button[type=submit]'])).toBe(false);
    expect(isCdpAttachRestrictedCommand('storage', [])).toBe(false);
  });
});
