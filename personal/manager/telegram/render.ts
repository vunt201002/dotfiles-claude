import type { ApprovalEvent, CostReport, ReportEvent, TaskRecord } from './manager-client';
import type { PendingQuestion } from './pending';
import type { InlineKeyboardMarkup } from './telegram-api';

const MAX_LIST = 20;

function usd(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `$${value.toFixed(2)}`;
}

function slug(project: string | undefined, issue: string | undefined, fallback = '—'): string {
  if (project && issue) return `${project}/${issue}`;
  return project || issue || fallback;
}

export function renderReport(event: ReportEvent): string {
  const head = [
    `${event.ok === false ? '⚠️' : '✅'} ${slug(event.project, event.issue, event.taskId ?? 'task')}`,
    event.lane,
    typeof event.attempt === 'number' ? `${event.attempt} attempt` : undefined,
    typeof event.cost_usd === 'number' ? usd(event.cost_usd) : undefined,
  ]
    .filter(Boolean)
    .join(' — ');

  const lines = [head];
  if (event.cause) lines.push(`Nguồn: ${event.cause}`);

  const caught = (event.gates ?? []).filter((gate) => gate.caught);
  if (caught.length > 0) {
    const rendered = caught
      .map((gate) => `${gate.gate ?? 'gate'}${gate.gate_family ? ` [${gate.gate_family}]` : ''} (${gate.caught})`)
      .join('\n  ');
    lines.push(`Cổng bắt: ${rendered}`);
  }

  if (event.verify && event.verify.length > 0) lines.push(`Verify: ${event.verify.join(' · ')}`);

  const assumptions = event.assumptions ?? [];
  lines.push(`Giả định: ${assumptions.length}`);
  for (const assumption of assumptions) lines.push(`  - ${assumption}`);

  if (event.status) lines.push(`Trạng thái: ${event.status}`);
  return lines.join('\n');
}

export function renderQuestionBatch(questions: readonly PendingQuestion[]): string {
  if (questions.length === 0) return '❓ Không còn câu nào đang treo.';
  const lines = [`❓ ${questions.length} câu đang treo`];
  questions.forEach((question, index) => {
    lines.push(`${index + 1}. ${slug(question.project, question.issue, question.taskId)} — ${question.text}`);
  });
  lines.push('Trả lời: "1: nội dung trả lời"');
  return lines.join('\n');
}

export function renderApproval(event: ApprovalEvent): string {
  const lines = [`🔒 Cần gật — ${slug(event.project, event.issue, event.taskId)}`, `Việc: ${event.action}`];
  if (event.detail) lines.push(event.detail);
  lines.push('Việc này không đảo ngược được. Bấm nút bên dưới.');
  return lines.join('\n');
}

export function approvalKeyboard(shortId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: 'Gật', callback_data: `ap:${shortId}:y` },
        { text: 'Lắc', callback_data: `ap:${shortId}:n` },
        { text: 'Xem diff', callback_data: `ap:${shortId}:d` },
      ],
    ],
  };
}

export function taskLine(task: TaskRecord): string {
  const envelope = task.envelope ?? {};
  const parts = [
    task.id ?? '(không có id)',
    task.state ?? '—',
    slug(envelope.project, envelope.issue),
    typeof task.attempt === 'number' ? `attempt ${task.attempt}/${task.max_attempts ?? 3}` : undefined,
    typeof task.cost_usd_actual === 'number' ? usd(task.cost_usd_actual) : undefined,
    task.holds && task.holds.length > 0 ? `giữ ${task.holds.join(',')}` : undefined,
  ].filter(Boolean);
  return parts.join(' · ');
}

export function renderTaskList(title: string, tasks: readonly TaskRecord[]): string {
  if (tasks.length === 0) return `${title}\nKhông có task nào.`;
  const shown = tasks.slice(0, MAX_LIST).map(taskLine);
  const tail = tasks.length > MAX_LIST ? [`… còn ${tasks.length - MAX_LIST} task nữa`] : [];
  return [title, ...shown, ...tail].join('\n');
}

export function renderStatus(tasks: readonly TaskRecord[]): string {
  return renderTaskList(`📋 ${tasks.length} task`, tasks);
}

export function renderProjectReport(project: string, tasks: readonly TaskRecord[]): string {
  const filtered = tasks.filter((task) => task.envelope?.project === project);
  return renderTaskList(`📋 ${project} — ${filtered.length} task`, filtered);
}

function breakdown(label: string, map: Record<string, number> | undefined): string | undefined {
  if (!map) return undefined;
  const entries = Object.entries(map);
  if (entries.length === 0) return undefined;
  return `${label}: ${entries.map(([key, value]) => `${key} ${usd(value)}`).join(' · ')}`;
}

export function renderCost(window: 'today' | 'all', report: CostReport): string {
  const lines = [`💰 Chi phí ${window === 'today' ? 'hôm nay' : 'tổng'}: ${usd(report.usd)}`];
  const lane = breakdown('Lane', report.byLane);
  if (lane) lines.push(lane);
  const project = breakdown('Project', report.byProject);
  if (project) lines.push(project);
  return lines.join('\n');
}

export function renderDiff(taskId: string, diff: string | undefined): string {
  if (!diff || !diff.trim()) return `Không có diff kèm theo cho ${taskId}.`;
  return `Diff — ${taskId}\n${diff}`;
}

export function renderHelp(): string {
  return [
    'Lệnh dùng được:',
    '/status — task đang chạy',
    '/run <project> <issue> — giao việc',
    '/report <project> — báo cáo theo project',
    '/stop <task-id> — dừng một task',
    '/stopall — dừng tất cả',
    '/cost — chi phí hôm nay (/cost all cho tổng)',
    'Text tự do — hỏi manager, hoặc trả lời câu treo dạng "1: ..."',
  ].join('\n');
}
