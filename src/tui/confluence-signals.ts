import type { FusionSnapshot } from '../marketdata/coindcx-fusion';
import { formatPrice } from '../utils/format';

export type CompositeBias = 'strong_bull' | 'bull' | 'neutral' | 'bear' | 'strong_bear';

export interface ConfluenceReadout {
  score: number;
  composite: CompositeBias;
  headlinePlain: string;
  headlineColor: 'green-fg' | 'red-fg' | 'yellow-fg';
  detailLines: string[];
}

function tfArrow(t: 'up' | 'down' | 'sideways'): string {
  if (t === 'up') return '{green-fg}▲{/green-fg}';
  if (t === 'down') return '{red-fg}▼{/red-fg}';
  return '{yellow-fg}·{/yellow-fg}';
}

/** Deterministic composite score from fusion fields (TUI / observability only). */
export function scoreConfluence(fusion: FusionSnapshot): number {
  let s = 0;
  const cm = fusion.candleMetrics;
  if (cm.trend15m === 'up') s += 2;
  else if (cm.trend15m === 'down') s -= 2;
  if (cm.trend1m === 'up') s += 1;
  else if (cm.trend1m === 'down') s -= 1;

  const mss = fusion.swing.marketStructureShift;
  if (mss.mss === 'bullish') s += 2;
  else if (mss.mss === 'bearish') s -= 2;
  if (mss.trend === 'uptrend') s += 1;
  else if (mss.trend === 'downtrend') s -= 1;

  const emaF = fusion.swing.emaBiasFilter.bias;
  if (emaF === 'bullish') s += 1;
  else if (emaF === 'bearish') s -= 1;

  const stack = fusion.intraday.emaStack.alignment;
  if (stack === 'bullish') s += 1;
  else if (stack === 'bearish') s -= 1;

  const rsiDiv = fusion.intraday.rsiDivergence.divergence;
  if (rsiDiv === 'bullish') s += 1;
  else if (rsiDiv === 'bearish') s -= 1;

  const sq = fusion.intraday.ttmSqueeze;
  if (sq.squeezeOn && sq.breakout === 'up') s += 1;
  else if (sq.squeezeOn && sq.breakout === 'down') s -= 1;

  const imb = fusion.bookMetrics.imbalance;
  if (imb === 'bid-heavy') s += 1;
  else if (imb === 'ask-heavy') s -= 1;

  const sw = fusion.microstructure.sweep;
  if (sw.detected) {
    if (sw.side === 'buy') s += 1;
    else if (sw.side === 'sell') s -= 1;
  }

  const ar = fusion.microstructure.aggressorRatio.ratio;
  if (Number.isFinite(ar)) {
    if (ar > 1.25) s += 1;
    else if (ar < 0.8) s -= 1;
  }

  const w60 = fusion.tradeMetrics?.windows['60s'];
  if (w60 && w60.totalVol > 0) {
    const r = w60.delta / w60.totalVol;
    if (r > 0.12) s += 1;
    else if (r < -0.12) s -= 1;
  }

  const ch = fusion.ltp.change24h;
  if (ch > 0.5) s += 1;
  else if (ch < -0.5) s -= 1;

  const oi = fusion.swing.oiPriceTruthTable.classification;
  if (oi === 'long-buildup') s += 1;
  else if (oi === 'short-buildup') s -= 1;
  else if (oi === 'long-unwinding') s -= 1;
  else if (oi === 'short-covering') s += 1;

  const raid = fusion.liquidityRaid;
  if (raid?.enabled) {
    const lc = raid.lastConfirmed;
    if (lc?.outcome === 'reversalCandidate') {
      if (lc.side === 'buySide') s += 2;
      else if (lc.side === 'sellSide') s -= 2;
    } else if (lc?.outcome === 'breakoutContinuation') {
      if (lc.side === 'buySide') s -= 1;
      else if (lc.side === 'sellSide') s += 1;
    }
  }

  return Math.max(-18, Math.min(18, Math.round(s)));
}

function compositeFromScore(score: number): Pick<ConfluenceReadout, 'composite' | 'headlinePlain' | 'headlineColor'> {
  if (score >= 5) {
    return { composite: 'strong_bull', headlinePlain: 'STRONG BULL', headlineColor: 'green-fg' };
  }
  if (score >= 2) {
    return { composite: 'bull', headlinePlain: 'BULL LEAN', headlineColor: 'green-fg' };
  }
  if (score <= -5) {
    return { composite: 'strong_bear', headlinePlain: 'STRONG BEAR', headlineColor: 'red-fg' };
  }
  if (score <= -2) {
    return { composite: 'bear', headlinePlain: 'BEAR LEAN', headlineColor: 'red-fg' };
  }
  return { composite: 'neutral', headlinePlain: 'NEUTRAL', headlineColor: 'yellow-fg' };
}

export function buildConfluenceReadout(fusion: FusionSnapshot): ConfluenceReadout {
  const score = scoreConfluence(fusion);
  const head = compositeFromScore(score);
  const cm = fusion.candleMetrics;
  const mss = fusion.swing.marketStructureShift;
  const emaF = fusion.swing.emaBiasFilter.bias;
  const sw = fusion.microstructure.sweep;
  const imb = fusion.bookMetrics.imbalance;
  const raid = fusion.liquidityRaid;

  const sweepTxt =
    sw.detected && sw.side !== 'none' ? `{magenta-fg}${sw.side}{/magenta-fg}` : '{gray-fg}—{/gray-fg}';

  const detailLines: string[] = [];
  detailLines.push(
    ` {gray-fg}TF{/gray-fg} 1m${tfArrow(cm.trend1m)} 15m${tfArrow(cm.trend15m)}  ` +
      `{gray-fg}vol{/gray-fg} {cyan-fg}${cm.volumeProfile}{/cyan-fg}`,
  );
  detailLines.push(
    ` {gray-fg}Struct{/gray-fg} ${mss.trend}  {gray-fg}MSS{/gray-fg} {yellow-fg}${mss.mss}{/yellow-fg}`,
  );
  detailLines.push(
    ` {gray-fg}EMA{/gray-fg} ${emaF}  {gray-fg}stack{/gray-fg} ${fusion.intraday.emaStack.alignment}  ` +
      `{gray-fg}RSI div{/gray-fg} ${fusion.intraday.rsiDivergence.divergence}`,
  );
  detailLines.push(
    ` {gray-fg}Book{/gray-fg} ${imb}  {gray-fg}sweep{/gray-fg} ${sweepTxt}  ` +
      `{gray-fg}Δ60s{/gray-fg} ${delta60sSummary(fusion)}`,
  );

  if (raid?.enabled) {
    const bits: string[] = [];
    if (raid.activeEvent) {
      const ae = raid.activeEvent;
      bits.push(
        `[${ae.timeframe}] ${ae.state} ${ae.side} @${formatPrice(String(ae.poolPrice))} sc:${(ae.score ?? 0).toFixed(0)}`,
      );
    }
    if (raid.lastConfirmed) {
      const lc = raid.lastConfirmed;
      const tag = lc.actionable ? '*' : lc.watchlistQuality ? '·' : '';
      bits.push(`✓[${lc.timeframe}] ${lc.outcome} ${lc.side} ${lc.score}${tag}`);
    }
    detailLines.push(
      bits.length > 0
        ? ` {gray-fg}Liq{/gray-fg} ${bits.join('  ·  ')}`
        : ` {gray-fg}Liq{/gray-fg} idle · ${raid.pools?.length ?? 0} pool(s)`,
    );
  }

  return { score, ...head, detailLines };
}

function delta60sSummary(fusion: FusionSnapshot): string {
  const w = fusion.tradeMetrics?.windows['60s'];
  if (!w || w.totalVol <= 0) return '{gray-fg}—{/gray-fg}';
  const r = w.delta / w.totalVol;
  const pct = (r * 100).toFixed(0);
  const color: 'green-fg' | 'red-fg' | 'gray-fg' =
    r > 0.08 ? 'green-fg' : r < -0.08 ? 'red-fg' : 'gray-fg';
  return `{${color}}${pct}%{/${color}}`;
}

/** Blessed-marked block for the Signals panel (fusion-derived interpretation). */
export function formatConfluencePanelBlock(symbol: string, fusion: FusionSnapshot | undefined): string {
  if (!fusion) {
    return [
      ` {bold}Interpreted{/bold} {gray-fg}${symbol}{/gray-fg}`,
      ` {gray-fg}Fusion snapshot not yet available.{/gray-fg}`,
      ` {gray-fg}Waiting on book + candles…{/gray-fg}`,
    ].join('\n');
  }
  const r = buildConfluenceReadout(fusion);
  const scoreStr = `${r.score >= 0 ? '+' : ''}${r.score}`;
  const headLine =
    ` {bold}Interpreted{/bold} {cyan-fg}${symbol}{/cyan-fg}  ` +
    `{${r.headlineColor}}{bold}${r.headlinePlain}{/bold}{/${r.headlineColor}} ` +
    `{gray-fg}(${scoreStr}){/gray-fg}`;
  return [headLine, ...r.detailLines].join('\n');
}
