import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBot, type Bot } from './bot';
import { loadConfig } from './config';
import { Outbox } from './outbox';
import { PendingStore } from './pending';
import { UpdateLog } from './update-log';
import { decodeFrame } from './manager-client';
import { chunkText, TelegramApi } from './telegram-api';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-state-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('UpdateLog — chống xử lý trùng update_id', () => {
  test('đánh dấu rồi thì không nhận lại, offset tiến đúng', () => {
    const file = path.join(tmp, 'updates.json');
    const log = UpdateLog.load(file);
    expect(log.offset).toBe(0);
    expect(log.has(10)).toBe(false);
    log.mark(10);
    expect(log.has(10)).toBe(true);
    expect(log.offset).toBe(11);
    log.mark(9);
    expect(log.offset).toBe(11);
  });

  test('sống sót qua restart — bot bật lại không xử lý lại update cũ', () => {
    const file = path.join(tmp, 'updates.json');
    const first = UpdateLog.load(file);
    first.mark(100);
    first.mark(101);

    const second = UpdateLog.load(file);
    expect(second.has(100)).toBe(true);
    expect(second.has(101)).toBe(true);
    expect(second.has(102)).toBe(false);
    expect(second.offset).toBe(102);
  });

  test('update-log không đọc được thì không tiếp tục với offset 0', () => {
    const file = path.join(tmp, 'updates.json');
    fs.writeFileSync(file, '{ không phải json');
    expect(() => UpdateLog.load(file)).toThrow('cannot read Telegram update log');
  });
});

describe('Outbox — hàng đợi outbound sống sót qua restart', () => {
  test('tin chưa gửi còn nguyên sau khi bot bật lại', () => {
    const file = path.join(tmp, 'outbox.json');
    const first = Outbox.load(file);
    first.enqueue({ chatId: '1', kind: 'approval', text: 'cần gật' });
    first.enqueue({ chatId: '1', kind: 'report', text: 'xong rồi' });

    const second = Outbox.load(file);
    expect(second.size).toBe(2);
    expect(second.peek()?.text).toBe('cần gật');
  });

  test('tin đã gửi bị xoá khỏi đĩa nên restart không gửi trùng', () => {
    const file = path.join(tmp, 'outbox.json');
    const outbox = Outbox.load(file);
    const item = outbox.enqueue({ chatId: '1', kind: 'report', text: 'xong rồi' });
    outbox.resolve(item.id);

    expect(Outbox.load(file).size).toBe(0);
  });

  test('đếm số lần thử và giữ nguyên thứ tự FIFO', () => {
    const file = path.join(tmp, 'outbox.json');
    const outbox = Outbox.load(file);
    const first = outbox.enqueue({ chatId: '1', kind: 'report', text: 'một' });
    outbox.enqueue({ chatId: '1', kind: 'report', text: 'hai' });
    outbox.fail(first.id);
    outbox.fail(first.id);

    const reloaded = Outbox.load(file);
    expect(reloaded.peek()?.attempts).toBe(2);
    expect(reloaded.peek()?.text).toBe('một');
  });

  test('khi tràn thì bỏ report/notice trước, không bao giờ bỏ approval hay question', () => {
    const file = path.join(tmp, 'outbox.json');
    const outbox = Outbox.load(file, 3);
    const evicted: string[] = [];
    outbox.onEvict = (items) => evicted.push(...items.map((i) => i.text));

    outbox.enqueue({ chatId: '1', kind: 'approval', text: 'gật cái này' });
    outbox.enqueue({ chatId: '1', kind: 'report', text: 'report cũ' });
    outbox.enqueue({ chatId: '1', kind: 'question', text: 'câu hỏi' });
    outbox.enqueue({ chatId: '1', kind: 'report', text: 'report mới' });

    expect(outbox.size).toBe(3);
    expect(evicted).toEqual(['report cũ']);
    expect(outbox.list().map((i) => i.kind)).toEqual(['approval', 'question', 'report']);
  });

  test('outbox không đọc được thì không bị coi là không có tin để gửi', () => {
    const file = path.join(tmp, 'outbox.json');
    fs.writeFileSync(file, '{ không phải json');
    expect(() => Outbox.load(file)).toThrow('cannot read Telegram outbox');
  });
});

describe('PendingStore', () => {
  test('câu hỏi đánh số theo vị trí và sống sót qua restart', () => {
    const file = path.join(tmp, 'pending.json');
    const store = PendingStore.load(file);
    store.addQuestion({ taskId: 'kivora-t105-01', project: 'kivora', issue: 't105', text: 'mixed cart?' });
    store.addQuestion({ taskId: 'joy-t88-01', project: 'joy', issue: 't88', text: 'bỏ migration?' });

    const reloaded = PendingStore.load(file);
    expect(reloaded.questionCount).toBe(2);
    expect(reloaded.questionAt(1)?.taskId).toBe('kivora-t105-01');
    expect(reloaded.questionAt(2)?.taskId).toBe('joy-t88-01');
    expect(reloaded.questionAt(3)).toBeUndefined();

    reloaded.removeQuestion(reloaded.questionAt(1)!.id);
    expect(PendingStore.load(file).questionAt(1)?.taskId).toBe('joy-t88-01');
  });

  test('cùng một câu hỏi gửi lại không nhân đôi', () => {
    const store = PendingStore.load(path.join(tmp, 'pending.json'));
    store.addQuestion({ taskId: 't1', text: 'a?' });
    store.addQuestion({ taskId: 't1', text: 'a?' });
    expect(store.questionCount).toBe(1);
  });

  test('approval chỉ chốt được một lần, short id vừa 64 byte callback_data', () => {
    const file = path.join(tmp, 'pending.json');
    const store = PendingStore.load(file);
    const approval = store.addApproval({ taskId: 'kivora-t105-01', action: 'git push' });
    expect(`ap:${approval.shortId}:y`.length).toBeLessThanOrEqual(64);
    expect(store.resolveApproval(approval.shortId)).toBe(true);
    expect(store.resolveApproval(approval.shortId)).toBe(false);
    expect(PendingStore.load(file).getApproval(approval.shortId)?.resolved).toBe(true);
  });

  test('pending không đọc được thì bot không bắt đầu xử lý update hay phê duyệt', async () => {
    const botToken = '8123456789:AAH1yQxK9zL0mNoPqRsTuVwXyZabcdefghi';
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: botToken,
      TELEGRAM_ALLOWED_CHAT_IDS: '424242',
      TELEGRAM_API_BASE: 'https://telegram.test',
      GSTACK_HOME: tmp,
      TELEGRAM_POLL_TIMEOUT_SEC: '0',
    });
    fs.mkdirSync(path.dirname(config.paths.pendingFile), { recursive: true });
    fs.writeFileSync(config.paths.pendingFile, '{ không phải json');
    let getUpdatesCalls = 0;
    const api = new TelegramApi({
      botToken,
      apiBase: config.apiBase,
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        if ('offset' in body) getUpdatesCalls += 1;
        return Response.json({ ok: true, result: [] });
      },
    });
    let bot: Bot | undefined;

    try {
      expect(() => {
        bot = createBot(config, { api });
        bot.start();
      }).toThrow('cannot read pending Telegram actions');
      expect(getUpdatesCalls).toBe(0);
    } finally {
      await bot?.stop();
    }
  });
});

test('ENOENT và file rỗng vẫn là chưa có state cho cả ba store', () => {
  const missing = path.join(tmp, 'missing');
  expect(PendingStore.load(path.join(missing, 'pending.json')).questionCount).toBe(0);
  expect(Outbox.load(path.join(missing, 'outbox.json')).size).toBe(0);
  expect(UpdateLog.load(path.join(missing, 'updates.json')).offset).toBe(0);

  const pendingFile = path.join(tmp, 'pending-empty.json');
  const outboxFile = path.join(tmp, 'outbox-empty.json');
  const updateFile = path.join(tmp, 'updates-empty.json');
  fs.writeFileSync(pendingFile, ' \n');
  fs.writeFileSync(outboxFile, ' \n');
  fs.writeFileSync(updateFile, ' \n');
  expect(PendingStore.load(pendingFile).questionCount).toBe(0);
  expect(Outbox.load(outboxFile).size).toBe(0);
  expect(UpdateLog.load(updateFile).offset).toBe(0);
});

describe('chunkText', () => {
  test('cắt theo dòng để tin còn đọc được trên điện thoại', () => {
    const text = Array.from({ length: 500 }, (_, i) => `dòng ${i}`).join('\n');
    const chunks = chunkText(text, 200);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(200);
    expect(chunks.join('\n')).toBe(text);
  });

  test('tin ngắn không bị cắt', () => {
    expect(chunkText('ngắn')).toEqual(['ngắn']);
  });
});

describe('decodeFrame — SSE của manager', () => {
  test('đọc được frame data một dòng và nhiều dòng', () => {
    expect(decodeFrame('data: {"type":"report","taskId":"t1"}')).toEqual({ type: 'report', taskId: 't1' } as never);
    expect(decodeFrame('event: message\ndata: {"type":"question",\ndata: "taskId":"t1","text":"a?"}')).toEqual({
      type: 'question',
      taskId: 't1',
      text: 'a?',
    } as never);
  });

  test('bỏ qua heartbeat và frame hỏng', () => {
    expect(decodeFrame(': heartbeat')).toBeUndefined();
    expect(decodeFrame('data: không-phải-json')).toBeUndefined();
    expect(decodeFrame('data: {"noType":true}')).toBeUndefined();
  });
});
