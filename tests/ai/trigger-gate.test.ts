import { describe, expect, it } from 'vitest';
import { AiTriggerGate } from '../../src/ai/trigger-gate';

describe('AiTriggerGate', () => {
  it('allows one LLM pulse per pair inside the configured interval', () => {
    let now = Date.parse('2026-05-08T06:30:00.000Z');
    const gate = new AiTriggerGate({
      clock: () => now,
      llmPulseMinIntervalMs: 15 * 60_000,
      aiConductorMinIntervalMs: 5 * 60_000,
      startupPulseEnabled: false,
    });

    expect(gate.allowLlmPulse('B-SOL_USDT', { kind: 'bar_close', tf: '15m' })).toBe(true);
    expect(gate.allowLlmPulse('B-SOL_USDT', { kind: 'bar_close', tf: '15m' })).toBe(false);

    now += 15 * 60_000;
    expect(gate.allowLlmPulse('B-SOL_USDT', { kind: 'bar_close', tf: '15m' })).toBe(true);
  });

  it('keeps LLM pulse budgets independent per pair', () => {
    const gate = new AiTriggerGate({
      clock: () => Date.parse('2026-05-08T06:30:00.000Z'),
      llmPulseMinIntervalMs: 15 * 60_000,
      aiConductorMinIntervalMs: 5 * 60_000,
      startupPulseEnabled: false,
    });

    expect(gate.allowLlmPulse('B-SOL_USDT', { kind: 'bar_close', tf: '15m' })).toBe(true);
    expect(gate.allowLlmPulse('B-ETH_USDT', { kind: 'bar_close', tf: '15m' })).toBe(true);
  });

  it('throttles conductor runs per pair', () => {
    let now = Date.parse('2026-05-08T06:30:00.000Z');
    const gate = new AiTriggerGate({
      clock: () => now,
      llmPulseMinIntervalMs: 15 * 60_000,
      aiConductorMinIntervalMs: 5 * 60_000,
      startupPulseEnabled: false,
    });

    expect(gate.allowAiConductor('B-SOL_USDT')).toBe(true);
    expect(gate.allowAiConductor('B-SOL_USDT')).toBe(false);

    now += 5 * 60_000;
    expect(gate.allowAiConductor('B-SOL_USDT')).toBe(true);
  });

  it('can disable startup pulse fan-out', () => {
    const gate = new AiTriggerGate({
      clock: () => Date.parse('2026-05-08T06:30:00.000Z'),
      llmPulseMinIntervalMs: 15 * 60_000,
      aiConductorMinIntervalMs: 5 * 60_000,
      startupPulseEnabled: false,
    });

    expect(gate.allowStartupPulse()).toBe(false);
  });
});
