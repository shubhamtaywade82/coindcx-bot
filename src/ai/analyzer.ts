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

  async analyze(pulse: MarketPulse) {
    const prompt = `
      You are an expert crypto day trader and quantitative analyst.
      Analyze the current market pulse for ${pulse.symbol}:
      - Current Price: ${pulse.price}
      - 24h Change: ${pulse.change24h}
      - Best Ask: ${pulse.orderBook.bestAsk}
      - Best Bid: ${pulse.orderBook.bestBid}
      - Spread: ${pulse.orderBook.spread}
      - Active Positions: ${pulse.positions.length}

      Based on this data, provide a professional trading verdict.
      Format your response as a JSON object with:
      {
        "verdict": "A brief 1-sentence market summary",
        "signal": "BUY", "SELL", or "NEUTRAL",
        "confidence": A number between 0 and 1
      }
      Only return the JSON object, no other text.
    `;

    try {
      this.logger.info({ mod: 'ai', symbol: pulse.symbol }, 'AI analysis start');
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
        signal: 'NEUTRAL',
        confidence: 0
      };
    }
  }
}
