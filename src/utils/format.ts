/**
 * Institutional-grade number formatting utilities
 */

export function formatPrice(value: string | number | undefined): string {
  if (value === undefined || value === null || value === '') return '—';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '—';
  if (num === 0) return '0.00';

  if (num >= 1000) return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (num >= 1) return num.toFixed(4);
  if (num >= 0.01) return num.toFixed(6);
  return num.toFixed(8);
}

export function formatPnl(value: string | number | undefined, prefix: string = ''): string {
  if (value === undefined || value === null || value === '') return '—';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '—';
  const sign = num > 0 ? '+' : '';
  const val = `${sign}${prefix}${Math.abs(num).toFixed(2)}`;
  return num > 0 ? `{green-fg}${val}{/green-fg}` : num < 0 ? `{red-fg}${val}{/red-fg}` : val;
}

export function formatChange(value: string | number | undefined): string {
  if (value === undefined || value === null || value === '') return '—';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '—';
  const sign = num > 0 ? '+' : '';
  const val = `${sign}${num.toFixed(2)}%`;
  return num > 0 ? `{green-fg}${val}{/green-fg}` : num < 0 ? `{red-fg}${val}{/red-fg}` : val;
}

export function cleanPair(pair: string): string {
  return pair.replace(/^B-/, '').replace('_', '');
}

export function formatQty(value: string | number | undefined, decimals: number = 4): string {
  if (value === undefined || value === null || value === '') return '—';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '—';
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
  return num.toFixed(decimals);
}

export function formatTime(ts?: number): string {
  const d = ts ? new Date(ts) : new Date();
  return d.toLocaleTimeString('en-IN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
