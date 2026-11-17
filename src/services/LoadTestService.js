import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { compareRuns } from '../domain/comparison.js';
import { toPublicConfig } from '../domain/loadTestConfig.js';
import { isFinished, RunStatus } from '../domain/runStatus.js';
import { LoadTestRun } from '../engine/LoadTestRun.js';
import { CapacityError, ConflictError, NotFoundError } from '../shared/errors.js';

/**
 * Casos de uso de las pruebas de carga. Publica eventos (patrón Observer) para
 * que WebSockets y caché de vistas reaccionen sin que este servicio los conozca.
 *
 * Eventos: 'started' (record), 'metrics' (runId, payload), 'finished' (record), 'deleted' (runId).
 */
export class LoadTestService extends EventEmitter {
  #runs;
  #policy;
  #engineConfig;
  #maxConcurrentTests;
  #logger;
  #active = new Map();
  #persisting = new Set();

  constructor({ runs, policy, engineConfig, maxConcurrentTests, logger }) {
    super();
    this.#runs = runs;
    this.#policy = policy;
    this.#engineConfig = engineConfig;
    this.#maxConcurrentTests = maxConcurrentTests;
    this.#logger = logger;
  }

  get activeCount() {
    return this.#active.size;
  }

  get activeWorkerCount() {
    let total = 0;
    for (const run of this.#active.values()) total += run.workerCount;
    return total;
  }

  /** Peticiones en vuelo ahora mismo, leídas de la memoria compartida con los workers. */
  get inFlightRequests() {
    let total = 0;
    for (const run of this.#active.values()) total += run.liveCounters().inFlight;
    return total;
  }

  /** Corridas que quedaron "running" porque el proceso anterior se cayó. */
  recoverInterruptedRuns() {
    return this.#runs.failInterrupted('El servidor se reinició durante la prueba.');
  }

  async start(config) {
    this.#assertCapacity();
    const pinnedAddresses = await this.#policy.authorize(config.url);
    // Se comprueba otra vez: otra prueba pudo ocupar el cupo durante la espera anterior.
    this.#assertCapacity();

    const record = {
      id: randomUUID(),
      name: config.name ?? `Prueba ${new URL(config.url).hostname}`,
      status: RunStatus.RUNNING,
      config: toPublicConfig(config),
      summary: null,
      timeline: [],
      error: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
    };

    const { maxWorkers, vusPerWorker, metricsIntervalMs } = this.#engineConfig;
    const run = new LoadTestRun({
      record,
      config,
      pinnedAddresses,
      engineOptions: { maxWorkers, vusPerWorker },
      metricsIntervalMs,
    });

    run.on('metrics', (payload) => this.emit('metrics', record.id, payload));
    run.once('finished', (finished) => {
      const persisting = this.#onFinished(finished).finally(() => this.#persisting.delete(persisting));
      this.#persisting.add(persisting);
    });

    this.#active.set(record.id, run);
    try {
      await this.#runs.save(record);
    } catch (error) {
      this.#active.delete(record.id);
      throw error;
    }

    await run.start();
    if (record.status === RunStatus.RUNNING) this.emit('started', record);

    return record;
  }

  async stop(id) {
    const run = this.#active.get(id);
    if (!run) {
      await this.getById(id);
      throw new ConflictError('TEST_NOT_RUNNING', 'La prueba ya no está en ejecución.');
    }
    await run.stop();
    return this.getById(id);
  }

  async getById(id) {
    const active = this.#active.get(id);
    if (active) return active.record;

    const run = await this.#runs.findById(id);
    if (!run) throw new NotFoundError('Prueba no encontrada.');
    return run;
  }

  list(pagination) {
    return this.#runs.findAll(pagination);
  }

  async compare(baselineId, candidateId) {
    const [baseline, candidate] = await Promise.all([this.getById(baselineId), this.getById(candidateId)]);

    for (const run of [baseline, candidate]) {
      if (!isFinished(run.status) || !run.summary) {
        throw new ConflictError('TEST_NOT_COMPARABLE', `La prueba "${run.name}" no tiene resultados finales.`);
      }
    }
    return compareRuns(baseline, candidate);
  }

  async remove(id) {
    if (this.#active.has(id)) {
      throw new ConflictError('TEST_RUNNING', 'Detén la prueba antes de eliminarla.');
    }
    if (!(await this.#runs.delete(id))) throw new NotFoundError('Prueba no encontrada.');
    this.emit('deleted', id);
  }

  /** Detiene las pruebas activas para que sus resultados se guarden al apagar. */
  async shutdown() {
    await Promise.all([...this.#active.values()].map((run) => run.stop()));
    await Promise.allSettled([...this.#persisting]);
  }

  #assertCapacity() {
    if (this.#active.size >= this.#maxConcurrentTests) {
      throw new CapacityError(`Ya hay ${this.#maxConcurrentTests} prueba(s) en ejecución. Espera a que terminen.`);
    }
  }

  async #onFinished(record) {
    try {
      await this.#runs.save(record);
    } catch (error) {
      this.#logger.error({ err: error, runId: record.id }, 'No se pudo guardar el resultado de la prueba');
    }
    this.#active.delete(record.id);
    this.emit('finished', record);
  }
}
