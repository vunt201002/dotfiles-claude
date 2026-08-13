import { describe, expect, test } from 'bun:test';
import { parseCommand, parseNumberedAnswer } from './commands';

describe('parseCommand', () => {
  test('nhận đúng 6 lệnh của command surface v1', () => {
    expect(parseCommand('/status')).toEqual({ kind: 'status' });
    expect(parseCommand('/run kivora t105')).toEqual({ kind: 'run', project: 'kivora', issue: 't105' });
    expect(parseCommand('/report kivora')).toEqual({ kind: 'report', project: 'kivora' });
    expect(parseCommand('/stop kivora-t105-01')).toEqual({ kind: 'stop', taskId: 'kivora-t105-01' });
    expect(parseCommand('/stopall')).toEqual({ kind: 'stopall' });
    expect(parseCommand('/cost')).toEqual({ kind: 'cost', window: 'today' });
    expect(parseCommand('/cost all')).toEqual({ kind: 'cost', window: 'all' });
  });

  test('bỏ hậu tố @botname mà Telegram thêm trong group', () => {
    expect(parseCommand('/stopall@my_manager_bot')).toEqual({ kind: 'stopall' });
    expect(parseCommand('/run@my_manager_bot joy t88')).toEqual({ kind: 'run', project: 'joy', issue: 't88' });
  });

  test('lệnh ngoài command surface là unknown, không phải text', () => {
    expect(parseCommand('/deploy')).toEqual({ kind: 'unknown', name: '/deploy' });
    expect(parseCommand('/start')).toEqual({ kind: 'unknown', name: '/start' });
  });

  test('text tự do không bị coi là lệnh', () => {
    expect(parseCommand('nghĩ giúp anh cách chia lane cho joy')).toEqual({
      kind: 'text',
      text: 'nghĩ giúp anh cách chia lane cho joy',
    });
    expect(parseCommand('   ')).toEqual({ kind: 'empty' });
  });

  test('thừa hoặc thiếu tham số là invalid — gõ nhầm không được âm thầm chạy nhầm issue', () => {
    expect(parseCommand('/run kivora t 105').kind).toBe('invalid');
    expect(parseCommand('/run kivora t105 thừa').kind).toBe('invalid');
    expect(parseCommand('/run kivora').kind).toBe('invalid');
    expect(parseCommand('/report').kind).toBe('invalid');
    expect(parseCommand('/report joy wishlist').kind).toBe('invalid');
    expect(parseCommand('/stop').kind).toBe('invalid');
    expect(parseCommand('/stop a b').kind).toBe('invalid');
    expect(parseCommand('/status hôm nay').kind).toBe('invalid');
    expect(parseCommand('/cost hôm nay').kind).toBe('invalid');
  });

  test('kill switch vẫn nổ dù gõ kèm chữ thừa', () => {
    expect(parseCommand('/stopall ngay').kind).toBe('stopall');
    expect(parseCommand('  /stopall  ').kind).toBe('stopall');
  });

  test('project và issue phải qua allowlist ký tự — chặn injection vào payload manager', () => {
    expect(parseCommand('/run kivora "; rm -rf /"').kind).toBe('invalid');
    expect(parseCommand('/run ../../etc t1').kind).toBe('invalid');
    expect(parseCommand('/stop ../../../etc/passwd').kind).toBe('invalid');
    expect(parseCommand(`/run kivora ${'x'.repeat(65)}`).kind).toBe('invalid');
    expect(parseCommand(['', '/run', 'kivora', 't105', ''].join(' ')).kind).toBe('run');
  });
});

describe('parseNumberedAnswer', () => {
  test('nhận cả ba kiểu đánh số', () => {
    expect(parseNumberedAnswer('1: áp cho phần regular')).toEqual({ index: 1, body: 'áp cho phần regular' });
    expect(parseNumberedAnswer('2. bỏ migration cũ')).toEqual({ index: 2, body: 'bỏ migration cũ' });
    expect(parseNumberedAnswer('3) viết đường tương thích')).toEqual({ index: 3, body: 'viết đường tương thích' });
  });

  test('bỏ qua text không đánh số', () => {
    expect(parseNumberedAnswer('áp cho phần regular')).toBeUndefined();
    expect(parseNumberedAnswer('1')).toBeUndefined();
    expect(parseNumberedAnswer('0: gì đó')).toBeUndefined();
  });

  test('giữ nguyên phần thân nhiều dòng', () => {
    const parsed = parseNumberedAnswer('1: dòng một\ndòng hai');
    expect(parsed?.body).toBe('dòng một\ndòng hai');
  });
});
