import type { ApprovalEvent, CostReport, FleetReport, ReportEvent, TaskRecord } from './manager-client';
import type { PendingQuestion } from './pending';
import type { InlineKeyboardMarkup } from './telegram-api';

const MAX_LIST = 20;

function usd(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `$${value.toFixed(2)}`;
}

/**
 * The phone's copy of lib/cost.ts formatSpend. A card that shows `$0.00` for a
 * task whose whole review ran on unpriced CLI quota reads as "this was free",
 * which is the one thing the number cannot say.
 */
function spend(value: number | undefined, unmeasured: number | undefined): string {
  const runs = typeof unmeasured === 'number' && unmeasured > 0 ? unmeasured : 0;
  if (runs === 0) return usd(value);
  const tail = `${runs} lượt chưa đo`;
  return typeof value === 'number' && value > 0 ? `${usd(value)} + ${tail}` : `chưa đo được (${tail})`;
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
    typeof event.cost_usd === 'number' ? spend(event.cost_usd, event.cost_unmeasured_runs) : undefined,
  ]
    .filter(Boolean)
    .join(' — ');

  const lines = [head];
  if (event.cause) lines.push(`Nguồn: ${event.cause}`);

  // Truthy `caught` alone does not mean a catch: verifyDeterministicGates
  // stamps `unverified-self-report` into that field on gates that PASSED, which
  // filed them under this heading. The verdict is the field that answers the
  // question. A gate arriving with no verdict at all is an older daemon on the
  // other end of the SSE, and dropping it would lose a real finding.
  const caught = (event.gates ?? []).filter((gate) => (gate.verdict ? gate.verdict === 'caught' : Boolean(gate.caught)));
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
    typeof task.cost_usd_actual === 'number' ? spend(task.cost_usd_actual, task.cost_unmeasured_runs) : undefined,
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

function age(sec: number | undefined): string {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec <= 0) return '';
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${(sec / 3600).toFixed(1)}h`;
}

/**
 * Phone-shaped, so the two things needing a human sit above the fold.
 *
 * `/status` answers "what did I give the manager"; this answers "what is
 * running on that machine right now", which is a bigger set — every pane the
 * operator opened by hand is in it. The two are not merged because a task with
 * no pane and a pane with no task are both real, and both are worth seeing.
 */
export function renderFleetReport(report: FleetReport): string {
  const members = report.members ?? [];
  const waiting = report.waiting ?? [];
  const crashed = report.crashed ?? [];
  const unpriced = report.unpricedModels ?? [];
  // "$0.00" next to a fleet of unpriced agents reads as "không tốn gì", which
  // is the one thing the number cannot support.
  const spend = unpriced.length > 0 ? (report.totalCostUsd ? `${usd(report.totalCostUsd)} + chưa rõ` : 'chưa tính được') : usd(report.totalCostUsd);
  const lines = [`🖥 Fleet: ${report.busy ?? 0}/${report.cap ?? 0} bận · ${spend}`];

  if (waiting.length > 0) {
    lines.push('', '❓ ĐANG CHỜ ANH TRẢ LỜI');
    for (const m of waiting.slice(0, MAX_LIST)) {
      // Tuổi phiên, KHÔNG phải idleSec. cmux vẫn cập nhật `updatedAt` đều đặn
      // trong lúc pane đang kẹt — quan sát được: một pane hiện "Permission"
      // suốt 5 tiếng mà updatedAt luôn mới. In idleSec ra sẽ thành "im 18s"
      // cho một thứ đã đứng im từ sáng.
      const why = m.health === 'blocked' ? 'kẹt ở permission prompt' : m.subtitle || 'hỏi một câu';
      lines.push(`  ${m.where ?? '?'} — mở ${age(m.ageSec) || '?'} · ${why}`);
    }
  }
  if (crashed.length > 0) {
    lines.push('', '💥 CHẾT GIỮA CHỪNG');
    for (const m of crashed.slice(0, MAX_LIST)) lines.push(`  ${m.where ?? '?'} — ${m.subtitle ?? ''}`.trimEnd());
  }

  // A phone screen holds about a dozen lines. This machine carries fifteen
  // sessions, eleven of them long dead, so listing everything buries the three
  // that are actually running under a fortnight of archaeology. Only what is
  // still alive gets a line; the rest get a count.
  const working = members.filter((m) => m.health === 'working');
  if (working.length > 0) {
    lines.push('');
    for (const m of working.slice(0, MAX_LIST)) {
      const who = m.managerOwned ? m.taskId || 'manager' : 'anh mở';
      const cost = m.costKnown ? ` ${usd(m.costUsd)}` : '';
      lines.push(`  ▶️ ${m.where ?? '?'} · ${who}${cost}${age(m.ageSec) ? ` · ${age(m.ageSec)}` : ''}`);
    }
  }
  const done = members.length - working.length - waiting.length - crashed.length;
  if (done > 0) lines.push('', `${done} phiên đã đóng (không tính vào cap).`);

  for (const t of report.orphanTasks ?? []) {
    lines.push(`⚠️ ${t.id ?? '?'} (${t.state ?? '?'}) không thấy pane nào`);
  }
  if (members.length === 0) lines.push('Không có agent nào đang chạy.');
  if (unpriced.length > 0) {
    lines.push('', `⚠️ Chưa có giá cho ${unpriced.join(', ')} — phần đó THIẾU khỏi tổng, không phải bằng 0.`);
  }
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
    '/fleet — mọi agent trên máy, kể cả pane anh tự mở',
    '/run <project> <issue> — giao việc',
    '/report <project> — báo cáo theo project',
    '/stop <task-id> — dừng một task',
    '/stopall — dừng tất cả',
    '/cost — chi phí hôm nay (/cost all cho tổng)',
    'Text tự do — hỏi manager, hoặc trả lời câu treo dạng "1: ..."',
  ].join('\n');
}
