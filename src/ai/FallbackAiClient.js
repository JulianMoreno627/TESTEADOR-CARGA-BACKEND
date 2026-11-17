import { AppError } from '../shared/errors.js';
import { CircuitBreaker } from './CircuitBreaker.js';

/**
 * Prueba los proveedores en orden (Gemini y luego Groq) hasta que uno responda
 * un análisis válido. Cada proveedor tiene su propio circuit breaker y su propio
 * tiempo límite.
 */
export class FallbackAiClient {
  #entries;
  #timeoutMs;
  #logger;

  constructor({ providers, timeoutMs, logger, breakerOptions }) {
    this.#entries = providers.map((provider) => ({ provider, breaker: new CircuitBreaker(breakerOptions) }));
    this.#timeoutMs = timeoutMs;
    this.#logger = logger;
  }

  get isConfigured() {
    return this.#entries.length > 0;
  }

  /** Estado de cada proveedor, para /api/v1/metrics. */
  status() {
    return Object.fromEntries(this.#entries.map(({ provider, breaker }) => [provider.name, breaker.state]));
  }

  async generate({ system, prompt }) {
    if (!this.isConfigured) {
      throw new AppError(503, 'AI_UNAVAILABLE', 'El análisis con IA no está configurado en el servidor.');
    }

    const startedAt = performance.now();
    const failures = [];

    for (const [index, { provider, breaker }] of this.#entries.entries()) {
      if (!breaker.canAttempt()) {
        failures.push(`${provider.name}: circuito abierto`);
        continue;
      }

      try {
        const content = await provider.generate({ system, prompt, signal: AbortSignal.timeout(this.#timeoutMs) });
        breaker.recordSuccess();
        return {
          content,
          provider: provider.name,
          model: provider.model,
          fallbackUsed: index > 0,
          durationMs: Math.round(performance.now() - startedAt),
        };
      } catch (error) {
        breaker.recordFailure();
        failures.push(error.message);
        this.#logger.warn({ provider: provider.name, reason: error.message, breaker: breaker.state }, 'Falló un proveedor de IA');
      }
    }

    throw new AppError(503, 'AI_UNAVAILABLE', 'Ningún proveedor de IA pudo generar el análisis. Intenta más tarde.', {
      attempts: failures,
    });
  }
}
