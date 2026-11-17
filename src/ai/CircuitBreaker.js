/**
 * Circuit breaker: tras varios fallos seguidos deja de llamar al proveedor durante
 * un tiempo. Así, si Gemini está caído, cada análisis va directo a Groq en lugar de
 * esperar primero el tiempo límite de Gemini.
 *
 *   closed ──(N fallos)──▶ open ──(pasa el tiempo)──▶ half-open
 *     ▲                                                  │
 *     └────────────────(un intento con éxito)────────────┘
 */
export class CircuitBreaker {
  #failureThreshold;
  #cooldownMs;
  #now;
  #failures = 0;
  #openedAt = null;

  constructor({ failureThreshold = 3, cooldownMs = 60_000, now = Date.now } = {}) {
    this.#failureThreshold = failureThreshold;
    this.#cooldownMs = cooldownMs;
    this.#now = now;
  }

  get state() {
    if (this.#openedAt === null) return 'closed';
    return this.#now() - this.#openedAt >= this.#cooldownMs ? 'half-open' : 'open';
  }

  /** En half-open se permite un intento de prueba. */
  canAttempt() {
    return this.state !== 'open';
  }

  recordSuccess() {
    this.#failures = 0;
    this.#openedAt = null;
  }

  recordFailure() {
    this.#failures += 1;
    // Un fallo en half-open vuelve a abrir el circuito de inmediato.
    if (this.#failures >= this.#failureThreshold || this.#openedAt !== null) {
      this.#openedAt = this.#now();
    }
  }
}
