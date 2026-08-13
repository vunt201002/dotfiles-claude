const secrets = new Set<string>();

const TELEGRAM_TOKEN_SHAPE = /\d{6,12}:[A-Za-z0-9_-]{25,}/g;

export function registerSecret(value: string | undefined | null): void {
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  if (trimmed.length < 8) return;
  secrets.add(trimmed);
}

export function resetSecrets(): void {
  secrets.clear();
}

/**
 * Belt and braces: registered secrets are stripped by exact match, and anything
 * shaped like a Telegram bot token is stripped even if it was never registered.
 */
export function redact(text: string): string {
  let out = text;
  for (const secret of secrets) {
    out = out.split(secret).join('[redacted]');
  }
  return out.replace(TELEGRAM_TOKEN_SHAPE, '[redacted]');
}

function stringify(part: unknown): string {
  if (typeof part === 'string') return part;
  if (part instanceof Error) return `${part.name}: ${part.message}`;
  try {
    return JSON.stringify(part) ?? String(part);
  } catch {
    return String(part);
  }
}

function emit(stream: NodeJS.WriteStream, level: string, parts: unknown[]): void {
  const line = redact(parts.map(stringify).join(' '));
  stream.write(`[${new Date().toISOString()}] ${level} ${line}\n`);
}

export function log(...parts: unknown[]): void {
  emit(process.stdout, 'info', parts);
}

export function warn(...parts: unknown[]): void {
  emit(process.stderr, 'warn', parts);
}

export function logError(...parts: unknown[]): void {
  emit(process.stderr, 'error', parts);
}
