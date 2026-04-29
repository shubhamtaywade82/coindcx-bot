import type { Config } from '../config/schema';
import type { AppLogger } from '../logging/logger';

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

  constructor(config: Config, private logger: AppLogger) {
    this.ollama = new Ollama({ host: config.OLLAMA_URL });
    this.model = config.OLLAMA_MODEL;
  }

  async analyze(state: any) {
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

      4. Provide your response as a JSON object with:
         {
           "verdict": "Detailed summary of structural confluence. Be consistent with the signal.",
           "signal": "LONG", "SHORT", or "WAIT",
           "confidence": A number 0-1,
           "setup": {
             "entry": "price (MUST BE NEAR CURRENT PRICE: ${state.current_price})",
             "sl": "price (Logical stop below/above structure)",
             "tp": "price (TARGETING NEXT LIQUIDITY POOL/STRUCTURAL LEVEL. OR target ~10% profit on utilized capital if structure is unclear)",
             "rr": number (REWARD/RISK RATIO - DOUBLE CHECK YOUR MATH: (TP-Entry)/(Entry-SL))
           },
           "management_advice": "IF AN ACTIVE POSITION EXISTS: Provide specific action (HOLD, TRAIL SL TO X, EXIT NOW) based on the current context.",
           "levels": ["Key level 1", "Key level 2"],
           "alternate_scenario": "What happens if this fails?",
           "no_trade_condition": "Explicit reason to stay out"
         }

      STRICT RULES:
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
      const response = await this.ollama.chat({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        format: 'json',
        stream: false
      });

      const content = response.message.content;
      this.logger.debug({ mod: 'ai', content }, 'AI response received');
      return JSON.parse(content);
    } catch (err: any) {
      this.logger.error({ mod: 'ai', err: err.message }, 'AI analysis failed');
      return {
        verdict: 'AI analysis temporarily unavailable',
        signal: 'WAIT',
        confidence: 0,
        no_trade_condition: 'Connectivity issue'
      };
    }
  }
}
