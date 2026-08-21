export class CdpAttachConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CdpAttachConfigError';
  }
}

/**
 * connectOverCDP is known to hang under Bun while the same Playwright call
 * succeeds under Node. This guard prevents a future launcher regression from
 * turning attach into a misleading timeout.
 */
export function assertCdpAttachRuntime(versions: NodeJS.ProcessVersions = process.versions): void {
  if (versions.bun) {
    throw new Error('CDP attach must run in the Node server because Playwright connectOverCDP hangs under Bun.');
  }
}

/**
 * CDP attach is intentionally limited to an explicit loopback HTTP endpoint.
 * Playwright resolves `/json/version` and opens the returned WebSocket. The
 * debug transport therefore retains the repository's existing same-user,
 * loopback trust boundary without treating the port as a secret.
 */
export function resolveCdpAttachEndpoint(input: string): string {
  let endpoint: URL;
  try {
    endpoint = new URL(input);
  } catch {
    throw new CdpAttachConfigError('--cdp requires an HTTP URL such as http://127.0.0.1:9222');
  }

  if (endpoint.protocol !== 'http:') {
    throw new CdpAttachConfigError('--cdp only accepts an http:// loopback endpoint');
  }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) {
    throw new CdpAttachConfigError('--cdp must target 127.0.0.1, localhost, or [::1]');
  }
  if (endpoint.username || endpoint.password) {
    throw new CdpAttachConfigError('--cdp endpoints must not contain credentials');
  }
  if (!endpoint.port) {
    throw new CdpAttachConfigError('--cdp requires an explicit remote-debugging port');
  }
  if (endpoint.pathname !== '/' || endpoint.search || endpoint.hash) {
    throw new CdpAttachConfigError('--cdp must be an origin URL such as http://127.0.0.1:9222');
  }

  return endpoint.origin;
}

export function chromeDebugLaunchCommand(platform: NodeJS.Platform, port: string): string {
  if (platform === 'darwin') {
    return `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=${port} --user-data-dir="$HOME/.gstack/chrome-cdp-profile"`;
  }
  if (platform === 'win32') {
    return `& "$Env:ProgramFiles\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=${port} --user-data-dir="$Env:USERPROFILE\\.gstack\\chrome-cdp-profile"`;
  }
  return `google-chrome --remote-debugging-port=${port} --user-data-dir="$HOME/.gstack/chrome-cdp-profile"`;
}

/**
 * Direct profile-data and context-configuration commands are unavailable in
 * attached mode. This is a guardrail, not a browser sandbox: ordinary page
 * actions and evaluated page code can still make the site persist state.
 */
export function isCdpAttachRestrictedCommand(command: string, args: string[]): boolean {
  return (
    ['cookie', 'cookie-import', 'cookie-import-browser', 'header', 'useragent', 'state'].includes(command) ||
    (command === 'storage' && args[0] === 'set') ||
    (command === 'viewport' && args.includes('--scale'))
  );
}

/**
 * Produces a fail-closed diagnostic. It explicitly says no browser was
 * launched so an operator cannot mistake a fresh session for the requested
 * authenticated Chrome session.
 */
export function formatCdpAttachFailure(
  endpoint: string,
  cause: unknown,
  platform: NodeJS.Platform = process.platform,
): string {
  const url = new URL(endpoint);
  const detail = cause instanceof Error ? cause.message : String(cause);
  return [
    `Could not attach to Chrome at ${endpoint}.`,
    `Cause: ${detail}`,
    'No fresh browser was launched.',
    'Start Chrome with a loopback debug port, sign in, open the target tab, then retry:',
    chromeDebugLaunchCommand(platform, url.port),
  ].join('\n');
}
