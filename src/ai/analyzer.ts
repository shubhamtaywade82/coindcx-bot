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
      Input: Structured market state for ${state.symbol || 'asset'}.

      [MARKET STATE DATA]
      ${JSON.stringify(state, null, 2)}

      TASKS:
      1. Identify valid setups ONLY if:
         - Liquidity sweep + displacement present
         - Structure confirms (BOS/CHOCH)
         - Price in OB/FVG mitigation
         - LTF confirmation exists (or is implied by displacement)

      2. Provide your response as a JSON object with:
         {
           "verdict": "Detailed summary of structural confluence",
           "signal": "LONG", "SHORT", or "WAIT",
           "confidence": A number 0-1,
           "setup": {
             "entry": "price",
             "sl": "price",
             "tp": "price",
             "rr": number
           },
           "alternate_scenario": "What happens if this fails?",
           "no_trade_condition": "Explicit reason to stay out"
         }

      STRICT RULES:
      - No trade without displacement.
      - No OB without BOS.
      - Reject weak setups or those with no liquidity context.
      - Give final decision: LONG / SHORT / WAIT.

      Only return the JSON object, no other text.
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
