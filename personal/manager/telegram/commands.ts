export type ParsedCommand =
  | { kind: 'empty' }
  | { kind: 'status' }
  | { kind: 'run'; project: string; issue: string }
  | { kind: 'report'; project: string }
  | { kind: 'stop'; taskId: string }
  | { kind: 'stopall' }
  | { kind: 'cost'; window: 'today' | 'all' }
  | { kind: 'text'; text: string }
  | { kind: 'unknown'; name: string }
  | { kind: 'invalid'; name: string; reason: string };

const IDENT_SHAPE = /^[A-Za-z0-9._/-]{1,64}$/;

/** Identifiers ride into manager paths and payloads, so `..` never gets through. */
export function isIdent(value: string): boolean {
  return IDENT_SHAPE.test(value) && !value.includes('..');
}

export const COMMAND_SURFACE = ['/status', '/run <project> <issue>', '/report <project>', '/stop <task-id>', '/stopall', '/cost'] as const;

/** Matches `1: câu trả lời`, `2. ...`, `3) ...` against the numbered question batch. */
export function parseNumberedAnswer(text: string): { index: number; body: string } | undefined {
  const match = /^\s*(\d{1,3})\s*[:.)]\s*(.+)$/s.exec(text);
  if (!match) return undefined;
  const index = Number(match[1]);
  if (!Number.isInteger(index) || index < 1) return undefined;
  return { index, body: match[2]!.trim() };
}

/**
 * Arity is exact for every acting command: `/run kivora t 105` must fail, not
 * silently spawn issue `t`. `/stopall` is the one exception — the kill switch
 * never refuses to fire over a stray argument.
 */
export function parseCommand(raw: string): ParsedCommand {
  const text = raw.trim();
  if (!text) return { kind: 'empty' };
  if (!text.startsWith('/')) return { kind: 'text', text };

  const [head, ...rest] = text.split(/\s+/);
  const name = head!.split('@')[0]!.toLowerCase();
  const args = rest.filter((part) => part.length > 0);

  switch (name) {
    case '/status':
      return args.length === 0 ? { kind: 'status' } : { kind: 'invalid', name, reason: 'Cú pháp: /status' };
    case '/stopall':
      return { kind: 'stopall' };
    case '/cost': {
      if (args.length > 1) return { kind: 'invalid', name, reason: 'Cú pháp: /cost hoặc /cost all' };
      if (args.length === 1 && args[0]!.toLowerCase() !== 'all') {
        return { kind: 'invalid', name, reason: 'Cú pháp: /cost hoặc /cost all' };
      }
      return { kind: 'cost', window: args.length === 1 ? 'all' : 'today' };
    }
    case '/run': {
      if (args.length !== 2) return { kind: 'invalid', name, reason: 'Cú pháp: /run <project> <issue>' };
      const [project, issue] = args;
      if (!isIdent(project!)) return { kind: 'invalid', name, reason: 'Tên project không hợp lệ' };
      if (!isIdent(issue!)) return { kind: 'invalid', name, reason: 'Mã issue không hợp lệ' };
      return { kind: 'run', project: project!, issue: issue! };
    }
    case '/report': {
      if (args.length !== 1) return { kind: 'invalid', name, reason: 'Cú pháp: /report <project>' };
      if (!isIdent(args[0]!)) return { kind: 'invalid', name, reason: 'Tên project không hợp lệ' };
      return { kind: 'report', project: args[0]! };
    }
    case '/stop': {
      if (args.length !== 1) return { kind: 'invalid', name, reason: 'Cú pháp: /stop <task-id>' };
      if (!isIdent(args[0]!)) return { kind: 'invalid', name, reason: 'Task id không hợp lệ' };
      return { kind: 'stop', taskId: args[0]! };
    }
    default:
      return { kind: 'unknown', name };
  }
}
