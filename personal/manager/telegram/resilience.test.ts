import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBot, type Bot } from './bot';
import { loadConfig, type BotConfig } from './config';
import type { TelegramUpdate } from './telegram-api';

type ServeHandle = ReturnType<typeof Bun.serve>;

const BOT_TOKEN = '8123456789:AAH1yQxK9zL0mNoPqRsTuVwXyZabcdefghi';
const MANAGER_TOKEN = 'manager-secret-token-abcdef123456';
const OWNER = '424242';

let tmp: string;
let telegramServer: ServeHandle;
let managerServer: ServeHandle | undefined;
let bot: Bot | undefined;
let sent: Array<{ chat_id: string; text: string }>;
let inbox: TelegramUpdate[];
let sseConnected = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(20);
  }
  throw new Error(`hết giờ chờ: ${label}`);
}

function makeConfig(overrides: Record<string, string> = {}): BotConfig {
  return loadConfig({
    TELEGRAM_BOT_TOKEN: BOT_TOKEN,
    TELEGRAM_ALLOWED_CHAT_IDS: OWNER,
    TELEGRAM_API_BASE: `http://127.0.0.1:${telegramServer.port}`,
    GSTACK_HOME: tmp,
    TELEGRAM_POLL_TIMEOUT_SEC: '0',
    TELEGRAM_SEND_GAP_MS: '0',
    ...overrides,
  });
}

function startManager(): ServeHandle {
  return Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (req.headers.get('X-Manager-Token') !== MANAGER_TOKEN) return new Response('forbidden', { status: 403 });
      if (url.pathname === '/events') {
        sseConnected = true;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(': ready\n\n'));
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        );
      }
      if (url.pathname === '/tasks') return Response.json([]);
      return Response.json({ ok: true });
    },
  });
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-res-'));
  sent = [];
  inbox = [];
  sseConnected = false;
  telegramServer = Bun.serve({
    port: 0,
    async fetch(req) {
      const method = new URL(req.url).pathname.split('/').pop();
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      if (method === 'getUpdates') {
        if (inbox.length === 0) await sleep(80);
        return Response.json({ ok: true, result: inbox.splice(0, inbox.length) });
      }
      if (method === 'sendMessage') {
        sent.push(body as { chat_id: string; text: string });
        return Response.json({ ok: true, result: { message_id: sent.length, chat: { id: body.chat_id } } });
      }
      return Response.json({ ok: true, result: true });
    },
  });
});

afterEach(async () => {
  await bot?.stop();
  bot = undefined;
  telegramServer.stop(true);
  managerServer?.stop(true);
  managerServer = undefined;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('manager sập', () => {
  test('lệnh vẫn trả lời được, báo rõ manager chưa chạy thay vì im lặng', async () => {
    bot = createBot(makeConfig());
    bot.start();

    inbox.push({ update_id: 1, message: { message_id: 1, chat: { id: OWNER }, from: { id: OWNER }, text: '/status' } });
    await waitFor(() => sent.some((message) => message.text.includes('manager chưa chạy')), 'bot báo manager chưa chạy');

    inbox.push({ update_id: 2, message: { message_id: 2, chat: { id: OWNER }, from: { id: OWNER }, text: '/stopall' } });
    await waitFor(
      () => sent.some((message) => message.text.includes('KHÔNG dừng được')),
      'kill switch báo thất bại rõ ràng',
    );
    expect(sent.every((message) => message.chat_id === OWNER)).toBe(true);
    expect(sent.some((message) => message.text.includes(MANAGER_TOKEN))).toBe(false);
  }, 15000);

  test('backoff có trần: dừng thử lại và chỉ đường quay lại bằng /status', async () => {
    bot = createBot(makeConfig({ MANAGER_MAX_RECONNECT_ATTEMPTS: '1' }));
    bot.start();

    await waitFor(
      () => sent.some((message) => message.text.includes('Đã ngừng thử kết nối lại manager')),
      'bot ngừng retry và báo cho vunt',
    );
    const retryNotices = sent.filter((message) => message.text.includes('Đã ngừng thử kết nối lại'));
    expect(retryNotices).toHaveLength(1);

    managerServer = startManager();
    fs.mkdirSync(path.join(tmp, 'manager'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'manager', 'port'), String(managerServer.port));
    fs.writeFileSync(path.join(tmp, 'manager', 'token'), MANAGER_TOKEN);

    inbox.push({ update_id: 3, message: { message_id: 3, chat: { id: OWNER }, from: { id: OWNER }, text: '/status' } });
    await waitFor(() => sseConnected, '/status nối lại luồng sự kiện');
    await waitFor(() => sent.some((message) => message.text.includes('📋 0 task')), 'bot trả /status từ manager mới');
  }, 20000);

  test('mất kết nối kéo dài thì báo một lần, không spam', async () => {
    bot = createBot(makeConfig());
    bot.start();

    await waitFor(
      () => sent.some((message) => message.text.includes('Manager không phản hồi')),
      'bot báo mất kết nối',
      10000,
    );
    await sleep(1500);
    expect(sent.filter((message) => message.text.includes('Manager không phản hồi'))).toHaveLength(1);
  }, 20000);
});
