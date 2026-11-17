import { EventEmitter } from 'node:events';
import { Worker } from 'node:worker_threads';
import { createLoadPattern } from '../domain/loadPatterns.js';

const WORKER_ENTRY = new URL('./worker/loadWorker.js', import.meta.url);
const CONTROL_INTERVAL_MS = 250;
const WORKER_FLUSH_INTERVAL_MS = 100;
const WORKER_READY_TIMEOUT_MS = 10_000;
const WORKER_STOP_TIMEOUT_MS = 3_000;

function splitEvenly(total, parts) {
  const base = Math.floor(total / parts);
  const extra = total % parts;
  return Array.from({ length: parts }, (_, index) => base + (index < extra ? 1 : 0));
}

/**
 * Coordina los workers de una prueba desde el hilo principal: aplica el patrón
 * de carga, reparte los usuarios virtuales y controla el tiempo.
 *
 * Eventos: 'batch' (workerIndex, batch) y 'finished' ({ reason, error }).
 */
export class LoadEngine extends EventEmitter {
  #runId;
  #config;
  #pinnedAddresses;
  #workerCount;
  #pattern;
  #workers = [];
  #controlTimer = null;
  #startedAt = null;
  #elapsedAtEnd = null;
  #finishing = null;
  targetVus = 0;

  constructor({ runId, config, pinnedAddresses, maxWorkers, vusPerWorker }) {
    super();
    this.#runId = runId;
    this.#config = config;
    this.#pinnedAddresses = pinnedAddresses;
    this.#workerCount = Math.min(maxWorkers, Math.max(1, Math.ceil(config.vus / vusPerWorker)));
    this.#pattern = createLoadPattern(config);
  }

  get workerCount() {
    return this.#workers.length;
  }

  get elapsedSeconds() {
    if (this.#elapsedAtEnd !== null) return this.#elapsedAtEnd;
    return this.#startedAt === null ? 0 : (performance.now() - this.#startedAt) / 1000;
  }

  async start() {
    // La prueba se pudo detener antes de arrancar o mientras los workers cargaban.
    if (this.#finishing) return;

    try {
      await Promise.all(
        Array.from({ length: this.#workerCount }, (_, index) => this.#spawnWorker(index)),
      );
    } catch (error) {
      if (this.#finishing) return;
      await Promise.all(this.#workers.map(({ thread }) => thread.terminate()));
      this.#workers = [];
      throw error;
    }
    if (this.#finishing) return;

    this.#startedAt = performance.now();
    this.#applyTarget();
    this.#controlTimer = setInterval(() => this.#tick(), CONTROL_INTERVAL_MS);
  }

  stop() {
    return this.#finish('stopped');
  }

  #tick() {
    if (this.elapsedSeconds >= this.#config.durationSeconds) this.#finish('completed');
    else this.#applyTarget();
  }

  #applyTarget() {
    const target = this.#pattern.targetVusAt(this.elapsedSeconds);
    if (target === this.targetVus) return;

    this.targetVus = target;
    const shares = splitEvenly(target, this.#workers.length);
    this.#workers.forEach(({ thread }, index) => {
      thread.postMessage({ type: 'set-vus', count: shares[index] });
    });
  }

  #spawnWorker(index) {
    const { url, method, headers, body, timeoutMs, thinkTimeMs } = this.#config;

    return new Promise((resolve, reject) => {
      const thread = new Worker(WORKER_ENTRY, {
        workerData: {
          runId: this.#runId,
          request: { url, method, headers, body, timeoutMs },
          thinkTimeMs,
          pinnedAddresses: this.#pinnedAddresses,
          flushIntervalMs: WORKER_FLUSH_INTERVAL_MS,
        },
      });
      const worker = { thread, stopped: null };
      this.#workers.push(worker);

      const readyTimer = setTimeout(
        () => reject(new Error('El worker no respondió a tiempo.')),
        WORKER_READY_TIMEOUT_MS,
      );

      worker.stopped = new Promise((markStopped) => {
        thread.on('message', (message) => {
          if (message.type === 'ready') {
            clearTimeout(readyTimer);
            resolve();
          } else if (message.type === 'batch') {
            this.emit('batch', index, message.batch);
          } else if (message.type === 'stopped') {
            markStopped();
          }
        });
        thread.once('exit', () => {
          clearTimeout(readyTimer);
          reject(new Error('El worker terminó antes de estar listo.'));
          markStopped();
        });
      });

      thread.once('error', (error) => {
        clearTimeout(readyTimer);
        reject(error);
        // Si ya estaba corriendo, el rechazo anterior no tiene efecto y la prueba falla aquí.
        if (this.#startedAt !== null) this.#finish('failed', error);
      });
    });
  }

  #finish(reason, error = null) {
    this.#finishing ??= (async () => {
      this.#elapsedAtEnd = this.elapsedSeconds;
      clearInterval(this.#controlTimer);
      await this.#shutdownWorkers();
      this.emit('finished', { reason, error });
    })();
    return this.#finishing;
  }

  async #shutdownWorkers() {
    await Promise.all(
      this.#workers.map(async ({ thread, stopped }) => {
        thread.postMessage({ type: 'stop' });
        // Un worker que no responde no debe impedir que la prueba termine.
        let timer;
        const deadline = new Promise((resolve) => {
          timer = setTimeout(resolve, WORKER_STOP_TIMEOUT_MS);
        });
        await Promise.race([stopped, deadline]);
        clearTimeout(timer);
        await thread.terminate();
      }),
    );
  }
}
