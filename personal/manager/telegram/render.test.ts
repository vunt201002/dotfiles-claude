import { describe, expect, test } from 'bun:test';
import {
  approvalKeyboard,
  renderApproval,
  renderCost,
  renderDiff,
  renderProjectReport,
  renderQuestionBatch,
  renderReport,
  renderStatus,
} from './render';

describe('renderReport', () => {
  test('thiếu field nào thì bỏ dòng đó, không in undefined', () => {
    const text = renderReport({ type: 'report', project: 'joy', issue: 't88' });
    expect(text).toBe('✅ joy/t88\nGiả định: 0');
  });

  test('task hỏng dùng dấu cảnh báo và liệt kê giả định', () => {
    const text = renderReport({
      type: 'report',
      project: 'joy',
      issue: 't88',
      ok: false,
      assumptions: ['coi như store chỉ có 1 currency'],
    });
    expect(text.startsWith('⚠️ joy/t88')).toBe(true);
    expect(text).toContain('Giả định: 1');
    expect(text).toContain('  - coi như store chỉ có 1 currency');
  });

  test('chỉ hiện cổng có caught, bỏ cổng pass', () => {
    const text = renderReport({
      type: 'report',
      taskId: 'k1',
      gates: [
        { gate: 'tsc', gate_family: 'deterministic', verdict: 'pass' },
        { gate: 'reviewer', gate_family: 'llm', caught: 'thiếu test cho nhánh sale' },
      ],
    });
    expect(text).toContain('Cổng bắt: reviewer [llm] (thiếu test cho nhánh sale)');
    expect(text).not.toContain('tsc');
  });
});

describe('renderQuestionBatch', () => {
  test('đánh số theo vị trí và chỉ cách trả lời', () => {
    const text = renderQuestionBatch([
      { id: 'q1', taskId: 'kivora-t105-01', project: 'kivora', issue: 't105', text: 'mixed cart?', createdAt: 0 },
      { id: 'q2', taskId: 'joy-t88-01', project: 'joy', issue: 't88', text: 'bỏ migration?', createdAt: 0 },
    ]);
    expect(text.split('\n')).toEqual([
      '❓ 2 câu đang treo',
      '1. kivora/t105 — mixed cart?',
      '2. joy/t88 — bỏ migration?',
      'Trả lời: "1: nội dung trả lời"',
    ]);
  });

  test('không còn câu nào thì nói rõ', () => {
    expect(renderQuestionBatch([])).toContain('Không còn câu nào');
  });
});

describe('approval', () => {
  test('ba nút đúng thứ tự spec và callback_data ngắn', () => {
    const keyboard = approvalKeyboard('k12');
    expect(keyboard.inline_keyboard[0]!.map((button) => button.text)).toEqual(['Gật', 'Lắc', 'Xem diff']);
    for (const button of keyboard.inline_keyboard[0]!) {
      expect(Buffer.byteLength(button.callback_data, 'utf8')).toBeLessThanOrEqual(64);
    }
  });

  test('tin approval nói rõ việc và tính không đảo ngược', () => {
    const text = renderApproval({ type: 'approval', taskId: 'k1', project: 'joy', issue: 't88', action: 'git push' });
    expect(text).toContain('🔒 Cần gật — joy/t88');
    expect(text).toContain('Việc: git push');
    expect(text).toContain('không đảo ngược được');
  });

  test('không có diff thì nói không có, không gửi tin rỗng', () => {
    expect(renderDiff('k1', undefined)).toBe('Không có diff kèm theo cho k1.');
    expect(renderDiff('k1', '   ')).toBe('Không có diff kèm theo cho k1.');
    expect(renderDiff('k1', 'diff --git')).toContain('diff --git');
  });
});

describe('renderStatus / renderProjectReport / renderCost', () => {
  test('không có task thì trả lời gọn', () => {
    expect(renderStatus([])).toBe('📋 0 task\nKhông có task nào.');
  });

  test('lọc đúng project', () => {
    const tasks = [
      { id: 'a', envelope: { project: 'kivora', issue: 't1' } },
      { id: 'b', envelope: { project: 'joy', issue: 't2' } },
    ];
    const text = renderProjectReport('joy', tasks);
    expect(text).toContain('📋 joy — 1 task');
    expect(text).toContain('b · — · joy/t2');
    expect(text).not.toContain('kivora');
  });

  test('cắt danh sách dài để tin còn đọc được', () => {
    const tasks = Array.from({ length: 25 }, (_, i) => ({ id: `t${i}`, state: 'running' }));
    const text = renderStatus(tasks);
    expect(text).toContain('… còn 5 task nữa');
    expect(text.split('\n')).toHaveLength(22);
  });

  test('chi phí hiện cả hai chiều bóc tách khi manager có trả', () => {
    expect(renderCost('today', { usd: 4.21, byLane: { 'bug-lon': 3.1 }, byProject: { kivora: 2.9 } })).toBe(
      '💰 Chi phí hôm nay: $4.21\nLane: bug-lon $3.10\nProject: kivora $2.90',
    );
    expect(renderCost('all', {})).toBe('💰 Chi phí tổng: —');
  });
});
