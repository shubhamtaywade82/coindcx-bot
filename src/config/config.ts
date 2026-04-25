import dotenv from 'dotenv';
dotenv.config();

export const config = {
  apiKey: process.env.COINDCX_API_KEY || '',
  apiSecret: process.env.COINDCX_API_SECRET || '',
  apiBaseUrl: 'https://api.coindcx.com',
  publicBaseUrl: 'https://public.coindcx.com',
  socketBaseUrl: 'wss://stream.coindcx.com',
  isReadOnly: process.env.READ_ONLY !== 'false', // Default to true
  pairs: (process.env.COINDCX_PAIRS || 'B-BTC_USDT,B-ETH_USDT').split(','),
};
