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
  #control;
  #workerIndex;

  /** @param {{ control: import('../SharedControl.js').SharedControl, workerIndex: number }} options */
  constructor({ requester, collector, thinkTimeMs, control, workerIndex }) {
    this.#requester = requester;
    this.#collector = collector;
    this.#thinkTimeMs = thinkTimeMs;
    this.#control = control;
    this.#workerIndex = workerIndex;
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
    this.#control.setActiveVus(this.#workerIndex, this.#loops.size);
    loop.done = this.#run(loop);
  }

  async #run(loop) {
    const { signal } = this.#abort;

    try {
      // La bandera compartida se lee entre peticiones: basta con que el hilo principal
      // la active para que ningún usuario envíe una petición más.
      while (!signal.aborted && !this.#control.stopRequested && this.#loops.size <= this.#target) {
        this.#control.requestStarted(this.#workerIndex);
        let result;
        try {
          result = await this.#requester.execute(signal);
        } finally {
          this.#control.requestFinished(this.#workerIndex);
        }
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
      this.#control.setActiveVus(this.#workerIndex, this.#loops.size);
    }
  }
}
