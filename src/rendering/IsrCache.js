/**
 * Regeneración estática incremental (ISR): responde de inmediato con la última
 * versión generada y, si está vencida, la renueva en segundo plano. El usuario
 * nunca espera un render salvo la primera vez.
 */
export class IsrCache {
  #render;
  #ttlMs;
  #logger;
  #value = null;
  #generatedAt = 0;
  #revalidating = null;

  constructor({ render, ttlMs, logger }) {
    this.#render = render;
    this.#ttlMs = ttlMs;
    this.#logger = logger;
  }

  /** @returns {Promise<{ value: *, state: 'MISS'|'HIT'|'STALE' }>} */
  async get() {
    if (this.#value === null) {
      await this.#revalidate();
      return { value: this.#value, state: 'MISS' };
    }

    if (Date.now() - this.#generatedAt < this.#ttlMs) {
      return { value: this.#value, state: 'HIT' };
    }

    this.#revalidate().catch((error) => {
      this.#logger.error({ err: error }, 'Falló la regeneración de una vista ISR');
    });
    return { value: this.#value, state: 'STALE' };
  }

  /** Marca la vista como vencida; la próxima visita dispara la regeneración. */
  invalidate() {
    this.#generatedAt = 0;
  }

  /** Comparte el mismo render entre visitas simultáneas. */
  #revalidate() {
    this.#revalidating ??= this.#render()
      .then((value) => {
        this.#value = value;
        this.#generatedAt = Date.now();
      })
      .finally(() => {
        this.#revalidating = null;
      });
    return this.#revalidating;
  }
}
