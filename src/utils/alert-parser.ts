import type { Signal } from '../signals/types';

export function parsePineAlert(raw: string): Partial<Signal> | null {
  if (!raw || typeof raw !== 'string') return null;

  // Try to parse key=value|key=value format (Deep Trades Whales style)
  if (raw.includes('=') && raw.includes('|')) {
    const parts = raw.split('|');
    const data: Record<string, string> = {};
    for (const p of parts) {
      const [k, v] = p.split('=');
      if (k && v) data[k.trim()] = v.trim();
    }

    if (data.type) {
      const isBuy = data.type.includes('BUY') || data.type.includes('BULL');
      const isSell = data.type.includes('SELL') || data.type.includes('BEAR');
      
      return {
        ts: new Date().toISOString(),
        strategy: 'pine.dtw',
        type: data.type.toLowerCase(),
        pair: data.sym || undefined,
        severity: (data.tier === 'EXTREME' || data.tier === 'STRONG') ? 'critical' : 'info',
        payload: data
      };
    }
  }

  // Handle SMC-CE v5 format
  if (raw.includes('SMC-CE v5')) {
    const isLong = raw.includes('LONG');
    const isShort = raw.includes('SHORT');
    const scoreMatch = raw.match(/Score (\d+)\/8/);
    const score = scoreMatch ? parseInt(scoreMatch[1]) : 0;
    
    // Extract symbol (e.g. "BTCUSDT 15m")
    const symbolMatch = raw.match(/\| ([A-Z0-9]+) /);
    const pair = symbolMatch ? symbolMatch[1] : undefined;

    return {
      ts: new Date().toISOString(),
      strategy: 'pine.smc',
      type: isLong ? 'long' : isShort ? 'short' : 'update',
      pair,
      severity: score >= 6 ? 'critical' : 'info',
      payload: {
        raw,
        score,
        is_high_conviction: raw.includes('HIGH CONVICTION') || score >= 7
      }
    };
  }

  // Handle HTF Volume Spike & Divergence
  if (raw.includes('Conviction') || raw.includes('Div')) {
    const isBull = raw.toLowerCase().includes('bull');
    const isBear = raw.toLowerCase().includes('bear');
    const isConviction = raw.toLowerCase().includes('conviction');

    return {
      ts: new Date().toISOString(),
      strategy: 'pine.htf_spike',
      type: isConviction ? (isBull ? 'bull_conviction' : 'bear_conviction') : (isBull ? 'bull_div' : 'bear_div'),
      severity: isConviction ? 'critical' : 'info',
      payload: { raw }
    };
  }

  // Generic fallback
  return {
    ts: new Date().toISOString(),
    strategy: 'pine.generic',
    type: 'alert',
    payload: { raw }
  };
}
