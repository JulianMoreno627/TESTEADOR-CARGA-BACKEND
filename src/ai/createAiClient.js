import { FallbackAiClient } from './FallbackAiClient.js';
import { GeminiProvider } from './providers/GeminiProvider.js';
import { GroqProvider } from './providers/GroqProvider.js';

/** Crea el cliente con los proveedores que tengan clave, en orden de preferencia. */
export function createAiClient(aiConfig, logger) {
  const providers = [];
  if (aiConfig.gemini.apiKey) providers.push(new GeminiProvider(aiConfig.gemini));
  if (aiConfig.groq.apiKey) providers.push(new GroqProvider(aiConfig.groq));

  if (providers.length === 0) logger.warn('Sin GEMINI_API_KEY ni GROQ_API_KEY: el análisis con IA está desactivado.');
  return new FallbackAiClient({ providers, timeoutMs: aiConfig.timeoutMs, logger });
}
