import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import nock from 'nock';
import { TelegramSink } from '../../src/sinks/telegram-sink';

const baseUrl = 'https://api.telegram.org';
const token = 'TKN';
const chat = '42';

beforeEach(() => nock.disableNetConnect());
afterEach(() => { nock.cleanAll(); nock.enableNetConnect(); });

describe('TelegramSink', () => {
  it('posts a sendMessage request', async () => {
    const scope = nock(baseUrl)
      .post(`/bot${token}/sendMessage`)
      .reply(200, { ok: true });
    const sink = new TelegramSink({
      token, chatId: chat, ratePerMin: 60, retryDelaysMs: [1, 1, 1],
    });
    await sink.emit({ id: '1', ts: 't', strategy: 's', type: 'strategy.long', severity: 'info', payload: {} });
    expect(scope.isDone()).toBe(true);
  });

  it('retries on 5xx then succeeds', async () => {
    nock(baseUrl).post(`/bot${token}/sendMessage`).reply(500);
    nock(baseUrl).post(`/bot${token}/sendMessage`).reply(500);
    const ok = nock(baseUrl).post(`/bot${token}/sendMessage`).reply(200, { ok: true });
    const sink = new TelegramSink({
      token, chatId: chat, ratePerMin: 60, retryDelaysMs: [1, 1, 1],
    });
    await sink.emit({ id: '1', ts: 't', strategy: 's', type: 'strategy.long', severity: 'info', payload: {} });
    expect(ok.isDone()).toBe(true);
  });

  it('reports persistent failure without throwing', async () => {
    nock(baseUrl).post(`/bot${token}/sendMessage`).times(4).reply(500);
    const onDrop = vi.fn();
    const sink = new TelegramSink({
      token, chatId: chat, ratePerMin: 60, retryDelaysMs: [1, 1, 1], onDrop,
    });
    await sink.emit({ id: '1', ts: 't', strategy: 's', type: 'strategy.long', severity: 'info', payload: {} });
    expect(onDrop).toHaveBeenCalledOnce();
  });

  it('does not POST for strategy.wait', async () => {
    const sink = new TelegramSink({
      token, chatId: chat, ratePerMin: 60, retryDelaysMs: [1, 1, 1],
    });
    await sink.emit({
      id: '1',
      ts: 't',
      strategy: 'llm.pulse.v1',
      type: 'strategy.wait',
      severity: 'info',
      payload: { reason: 'flat' },
    });
  });

  it('POSTs Pine-style signals whose type has no dot (e.g. long)', async () => {
    const scope = nock(baseUrl)
      .post(`/bot${token}/sendMessage`)
      .reply(200, { ok: true });
    const sink = new TelegramSink({
      token, chatId: chat, ratePerMin: 60, retryDelaysMs: [1, 1, 1],
    });
    await sink.emit({
      id: '1',
      ts: 't',
      strategy: 'pine.smc',
      type: 'long',
      severity: 'info',
      pair: 'BTCUSDT',
      payload: { raw: 'SMC alert' },
    });
    expect(scope.isDone()).toBe(true);
  });

  it('includes liquidity raid meta in strategy Telegram body', async () => {
    const scope = nock(baseUrl)
      .post(`/bot${token}/sendMessage`, (body: { text?: string }) => {
        const t = body.text ?? '';
        return t.includes('Liquidity') && t.includes('raid score') && t.includes('8.0') && t.includes('flow') && t.includes('+0.35');
      })
      .reply(200, { ok: true });
    const sink = new TelegramSink({
      token, chatId: chat, ratePerMin: 60, retryDelaysMs: [1, 1, 1],
    });
    await sink.emit({
      id: '1',
      ts: 't',
      strategy: 'bearish.smc.v1',
      type: 'strategy.short',
      severity: 'info',
      pair: 'B-SOL_USDT',
      payload: {
        reason: 'test',
        confidence: 0.7,
        meta: {
          postSweep: true,
          liquidityRaidScore: 8,
          liquidityRaidContribution: 0.35,
        },
      },
    });
    expect(scope.isDone()).toBe(true);
  });
});
