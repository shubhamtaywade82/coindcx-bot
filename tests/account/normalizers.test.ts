import { describe, it, expect } from 'vitest';
import { normalizePosition, normalizeBalance, normalizeOrder, normalizeFill } from '../../src/account/normalizers';

describe('normalizers', () => {
  it('normalizePosition handles WS shape', () => {
    const raw = {
      id: 'p1', pair: 'B-BTC_USDT', active_pos: 0.5, avg_price: 50000, mark_price: 50100,
      leverage: 5, margin_currency_short_name: 'USDT', unrealized_pnl: 50, updated_at: 'now',
    };
    const p = normalizePosition(raw, 'ws', 'now');
    expect(p.id).toBe('p1');
    expect(p.activePos).toBe('0.5');
    expect(p.side).toBe('long');
    expect(p.marginCurrency).toBe('USDT');
    expect(p.source).toBe('ws');
  });

  it('normalizePosition flat side when active_pos == 0', () => {
    const raw = { id: 'p1', pair: 'X', active_pos: 0, avg_price: 0, margin_currency_short_name: 'USDT', unrealized_pnl: 0, updated_at: 'now' };
    expect(normalizePosition(raw, 'rest', 'now').side).toBe('flat');
  });

  it('normalizePosition short side when active_pos negative', () => {
    const raw = { id: 'p1', pair: 'X', active_pos: -1, avg_price: 50, margin_currency_short_name: 'USDT', unrealized_pnl: 0, updated_at: 'now' };
    expect(normalizePosition(raw, 'rest', 'now').side).toBe('short');
  });

  it('normalizePosition falls back mark price to last_price when mark_price missing', () => {
    const raw = {
      id: 'p2',
      pair: 'B-BTC_USDT',
      active_pos: 1,
      avg_price: 50000,
      last_price: 50500,
      margin_currency_short_name: 'USDT',
      unrealized_pnl: 0,
      updated_at: 'now',
    };
    const p = normalizePosition(raw, 'rest', 'now');
    expect(p.markPrice).toBe('50500');
  });

  it('normalizePosition preserves previous liquidation price when current payload omits it', () => {
    const raw = {
      id: 'p3',
      pair: 'B-BTC_USDT',
      active_pos: 1,
      avg_price: 50000,
      margin_currency_short_name: 'USDT',
      previous_liquidation_price: '45000',
      unrealized_pnl: 0,
      updated_at: 'now',
    };
    const p = normalizePosition(raw, 'rest', 'now');
    expect(p.liquidationPrice).toBe('45000');
  });

  it('normalizeBalance maps currency_short_name + locked_balance', () => {
    const raw = { currency_short_name: 'USDT', balance: 100, locked_balance: 50 };
    const b = normalizeBalance(raw, 'ws', 'now');
    expect(b.currency).toBe('USDT');
    expect(b.available).toBe('100');
    expect(b.locked).toBe('50');
  });

  it('normalizeOrder maps total_quantity + remaining_quantity', () => {
    const raw = { id: 'o1', pair: 'X', side: 'buy', order_type: 'limit', status: 'open',
      price: 1, total_quantity: 1, remaining_quantity: 1, created_at: 't', updated_at: 't' };
    const o = normalizeOrder(raw, 'ws');
    expect(o.totalQty).toBe('1');
    expect(o.remainingQty).toBe('1');
    expect(o.type).toBe('limit');
  });

  it('normalizeFill maps trade payload + ingestedAt clock', () => {
    const raw = { id: 'f1', order_id: 'o1', pair: 'X', side: 'buy', price: 1, quantity: 1,
      fee: 0.01, fee_currency: 'USDT', realized_pnl: 5, executed_at: 't' };
    const f = normalizeFill(raw, 'ws', 'now');
    expect(f.orderId).toBe('o1');
    expect(f.qty).toBe('1');
    expect(f.realizedPnl).toBe('5');
    expect(f.ingestedAt).toBe('now');
  });
});
