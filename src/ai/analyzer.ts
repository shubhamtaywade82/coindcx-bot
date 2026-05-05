import type { Config } from '../config/schema';
import type { AppLogger } from '../logging/logger';
import { ollamaHostRequiresApiKey } from './ollama-host';

// Use require to bypass ESM/CJS interop issues with ollama-js in ts-node
const { Ollama } = require('ollama');

export interface MarketPulse {
  symbol: string;
  price: string;
  change24h: string;
  orderBook: {
    bestAsk: string;
    bestBid: string;
    spread: string;
  };
  positions: any[];
}

export class AiAnalyzer {
  private ollama: any;
  private model: string;
  private readonly cloudWithoutKey: boolean;
  private readonly maxConcurrency: number;
  private readonly minIntervalMs: number;
  private readonly retryMax: number;
  private readonly retryBaseMs: number;
  private inflight = 0;
  private waiters: Array<() => void> = [];
  private lastDispatchAt = 0;

  constructor(config: Config, private logger: AppLogger) {
    const key = config.OLLAMA_API_KEY?.trim();
    const headers =
      key !== ''
        ? { Authorization: `Bearer ${key}` }
        : undefined;
    this.cloudWithoutKey = ollamaHostRequiresApiKey(config.OLLAMA_URL) && key === '';
    this.ollama = new Ollama({
      host: config.OLLAMA_URL,
      ...(headers ? { headers } : {}),
    });
    this.model = config.OLLAMA_MODEL;
    this.maxConcurrency = Math.max(1, config.OLLAMA_MAX_CONCURRENCY ?? 1);
    this.minIntervalMs = Math.max(0, config.OLLAMA_MIN_INTERVAL_MS ?? 0);
    this.retryMax = Math.max(0, config.OLLAMA_RETRY_MAX ?? 0);
    this.retryBaseMs = Math.max(100, config.OLLAMA_RETRY_BASE_MS ?? 1000);
  }

  private async acquire(): Promise<void> {
    if (this.inflight < this.maxConcurrency) {
      this.inflight += 1;
      return;
    }
    await new Promise<void>(resolve => this.waiters.push(resolve));
    this.inflight += 1;
  }

  private release(): void {
    this.inflight = Math.max(0, this.inflight - 1);
    const next = this.waiters.shift();
    if (next) next();
  }

  private async paceDispatch(): Promise<void> {
    if (this.minIntervalMs <= 0) return;
    const wait = this.lastDispatchAt + this.minIntervalMs - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    this.lastDispatchAt = Date.now();
  }

  private isConcurrencyError(err: any): boolean {
    const msg = String(err?.message ?? err ?? '').toLowerCase();
    const status = err?.status_code ?? err?.status;
    if (status === 429) return true;
    return /too many concurrent|rate limit|429|temporarily unavailable|busy/.test(msg);
  }

  async analyze(state: any) {
    if (this.cloudWithoutKey) {
      this.logger.warn({ mod: 'ai', symbol: state?.symbol }, 'Ollama Cloud URL set but OLLAMA_API_KEY is empty');
      return {
        verdict: 'Ollama Cloud needs an API key',
        signal: 'WAIT',
        confidence: 0,
        no_trade_condition:
          'Set OLLAMA_API_KEY in .env (create one at https://ollama.com/settings/keys). Empty key cannot call https://ollama.com.',
      };
    }
    const prompt = `
      You are a professional SMC-based crypto futures trading system.
      Input: Multi-Timeframe (MTF) market state for ${state.symbol || 'asset'}.

      [MARKET STATE DATA]
      - Symbol: ${state.symbol}
      - Current Price: ${state.current_price}
      ${JSON.stringify(state, null, 2)}

      TASKS:
      1. Establish HTF Narrative: Analyze the 1H trend and swing levels.
      2. Identify LTF Setups: Look for 15m entries (BOS/CHOCH/FVG) ONLY if aligned with HTF Narrative.
      3. CONFLUENCE CHECK: 
         - A setup is valid ONLY if LTF aligns with HTF or if a major liquidity sweep occurred.
         - Use [pine_signals] (Whale activity, SMC alerts, HTF Spikes) as primary confluence gates.
         - No trade without displacement.
         - No OB without BOS.
         - Reject weak setups or those fighting HTF momentum without clear CHOCH.

      4. CONDUCTOR MODE: If the input contains "strategy_signals" (array) and "conductor_directive",
         you are arbitrating between deterministic strategies. Pick the single most convincing strategy
         from the list and align your verdict, signal, and setup with it. Set "chosen_strategy" to its
         strategyId. If no strategy is convincing per the directive, return "signal": "WAIT".

      5. Provide your response as a JSON object with:
         {
           "verdict": "Detailed summary of structural confluence. Be consistent with the signal.",
           "signal": "LONG", "SHORT", or "WAIT",
           "confidence": A number 0-1,
           "setup": {
             "entry": "price (MUST BE NEAR CURRENT PRICE: ${state.current_price})",
             "sl": "price (stop: for LONG must be BELOW entry; for SHORT must be ABOVE entry)",
             "tp": "price (take profit: for LONG must be ABOVE entry; for SHORT must be BELOW entry)",
             "rr": number (REWARD/RISK: LONG = (tp-entry)/(entry-sl); SHORT = (entry-tp)/(sl-entry); must be positive)
           },
           "management_advice": "IF AN ACTIVE POSITION EXISTS: Provide specific action (HOLD, TRAIL SL TO X, EXIT NOW) based on the current context.",
           "levels": ["Key level 1", "Key level 2"],
           "alternate_scenario": "What happens if this fails?",
           "no_trade_condition": "Explicit reason to stay out",
           "chosen_strategy": "(conductor mode only) the strategyId you trusted, or null",
           "current_bias": "BULLISH | BEARISH | NEUTRAL — your read of HTF/LTF structure right now",
           "expected_next_bias": "BULLISH | BEARISH | NEUTRAL — where bias is most likely to shift next",
           "bias_trigger": "Concrete event that would flip current_bias → expected_next_bias (e.g. 1h close above 2400 with displacement)"
         }

      STRICT RULES:
      - GEOMETRY: If signal is LONG then sl < entry < tp. If signal is SHORT then tp < entry < sl. Never invert.
      - USE THE CURRENT PRICE (${state.current_price}) AS THE REFERENCE FOR YOUR ENTRY.
      - TAKE PROFIT (TP) MUST BE BASED ON ASSET CONTEXT (Liquidity Pools, FVG, Swing Highs/Lows).
      - If structural targets are not obvious, aim for a price that would yield roughly 10% return on the utilized balance for this trade.
      - IF A POSITION IS OPEN (${state.position ? `${state.position.side} @ ${state.position.entry}` : 'None'}): Your primary focus is whether the current market state validates keeping it open or suggests an immediate exit/trailing.
      - DO NOT hallucinate prices from outside the provided data.
      - IF the signal is LONG/SHORT, the verdict MUST support it. 
      - IF the setup is weak, return "WAIT".
      - Only return the JSON object, no other text.
    `;

    try {
      this.logger.info({ mod: 'ai', symbol: state.symbol }, 'Institutional AI analysis start');
      await this.acquire();
      let response: any;
      try {
        let attempt = 0;
        while (true) {
          await this.paceDispatch();
          try {
            response = await this.ollama.chat({
              model: this.model,
              messages: [{ role: 'user', content: prompt }],
              format: 'json',
              stream: false,
            });
            break;
          } catch (chatErr: any) {
            if (attempt >= this.retryMax || !this.isConcurrencyError(chatErr)) throw chatErr;
            const backoff = this.retryBaseMs * Math.pow(2, attempt) + Math.floor(Math.random() * 250);
            this.logger.warn(
              { mod: 'ai', symbol: state.symbol, attempt: attempt + 1, backoffMs: backoff, err: String(chatErr?.message ?? chatErr) },
              'Ollama concurrency/rate error — backing off',
            );
            await new Promise(r => setTimeout(r, backoff));
            attempt += 1;
          }
        }
      } finally {
        this.release();
      }

      const content = response.message.content;
      this.logger.debug({ mod: 'ai', content }, 'AI response received');
      return JSON.parse(content);
    } catch (err: any) {
      const msg = typeof err?.message === 'string' ? err.message : String(err);
      const status = err?.status_code ?? err?.status;
      this.logger.error({ mod: 'ai', err: msg, status }, 'AI analysis failed');

      let hint =
        'Check logs. Typical fixes: set OLLAMA_API_KEY for Cloud; use a valid OLLAMA_MODEL for that host.';
      if (status === 401 || /401|unauthorized/i.test(msg)) {
        hint =
          'HTTP 401: invalid or missing OLLAMA_API_KEY for Ollama Cloud (https://ollama.com/settings/keys).';
      } else if (
        status === 404 ||
        /model not found|unknown model|invalid model|file does not exist/i.test(msg)
      ) {
        hint =
          'Model or path not found: confirm OLLAMA_MODEL exists on this host (Cloud names differ from local ollama list).';
      } else if (/fetch failed|ECONNREFUSED|ENOTFOUND|network/i.test(msg)) {
        hint = 'Network error: confirm OLLAMA_URL is reachable from this machine.';
      } else if (err instanceof SyntaxError || /JSON|Unexpected token/i.test(msg)) {
        hint = 'Model did not return valid JSON (try another model or reduce prompt constraints).';
      }

      const shortDetail = msg.length > 140 ? `${msg.slice(0, 140)}…` : msg;
      return {
        verdict: `AI request failed: ${shortDetail}`,
        signal: 'WAIT',
        confidence: 0,
        no_trade_condition: hint,
      };
    }
  }
}
