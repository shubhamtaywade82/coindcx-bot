import { loadConfig } from './index';

// Unified configuration bridge
// This ensures all parts of the app use the same validated settings
const fullConfig = loadConfig();

export const config = {
  // Legacy mappings for backward compatibility
  apiKey: fullConfig.COINDCX_API_KEY,
  apiSecret: fullConfig.COINDCX_API_SECRET,
  apiBaseUrl: fullConfig.API_BASE_URL,
  publicBaseUrl: fullConfig.PUBLIC_BASE_URL,
  socketBaseUrl: fullConfig.SOCKET_BASE_URL,
  isReadOnly: fullConfig.READ_ONLY,
  pairs: fullConfig.COINDCX_PAIRS,
  
  // New AI settings
  ollamaUrl: fullConfig.OLLAMA_URL,
  ollamaModel: fullConfig.OLLAMA_MODEL,
  
  // Full config access
  ...fullConfig
};
