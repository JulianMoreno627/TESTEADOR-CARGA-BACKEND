import { setTimeout as sleep } from 'node:timers/promises';

// Pausa tras un fallo de red: un puerto cerrado responde al instante y, sin ella,
// el usuario virtual entraría en un bucle que consume CPU sin medir nada útil.
const NETWORK_ERROR_BACKOFF_MS = 100;

/**
 * Usuarios virtuales como bucles asíncronos: cada uno espera su respuesta antes
 * de enviar la siguiente petición. Al ser E/S no bloqueante, un solo worker
 * sostiene cientos de ellos.
 */
export class VirtualUserPool {
  #requester;
  #collector;
  #thinkTimeMs;
  #abort = new AbortController();
  #loops = new Set();
  #target = 0;

  constructor({ requester, collector, thinkTimeMs }) {
    this.#requester = requester;
    this.#collector = collector;
    this.#thinkTimeMs = thinkTimeMs;
  }

  get activeCount() {
    return this.#loops.size;
  }

  /** Crea usuarios si faltan; los que sobran salen al terminar su petición actual. */
  setTarget(count) {
    this.#target = count;
    while (this.#loops.size < this.#target) this.#spawn();
  }

  async stop() {
    this.#abort.abort();
    await Promise.allSettled([...this.#loops].map((loop) => loop.done));
    this.#requester.close();
  }

  #spawn() {
    const loop = {};
    this.#loops.add(loop);
    loop.done = this.#run(loop);
  }

  async #run(loop) {
    const { signal } = this.#abort;

    try {
      while (!signal.aborted && this.#loops.size <= this.#target) {
        const result = await this.#requester.execute(signal);
        if (result.aborted) break;

        this.#collector.record(result);

        const pauseMs = result.statusCode === 0 ? NETWORK_ERROR_BACKOFF_MS : this.#thinkTimeMs;
        if (pauseMs > 0) await sleep(pauseMs, undefined, { signal });
      }
    } catch (error) {
      // sleep() rechaza con AbortError al detener la prueba; es la salida normal.
      if (error.name !== 'AbortError') throw error;
    } finally {
      this.#loops.delete(loop);
    }
  }
}
