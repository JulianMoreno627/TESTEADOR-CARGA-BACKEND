import { EventEmitter } from 'node:events';
import { MetricsAggregator } from '../domain/metrics/MetricsAggregator.js';
import { RunStatus } from '../domain/runStatus.js';
import { LoadEngine } from './LoadEngine.js';

/**
 * Una ejecución de prueba: une el motor con las métricas y mantiene su registro.
 *
 * Eventos: 'metrics' ({ point, totals }) y 'finished' (record).
 */
export class LoadTestRun extends EventEmitter {
  #engine;
  #aggregator = new MetricsAggregator();
  #metricsIntervalMs;
  #sampleTimer = null;
  #lastSampleElapsed = 0;

  constructor({ record, config, pinnedAddresses, engineOptions, metricsIntervalMs }) {
    super();
    this.record = record;
    this.#metricsIntervalMs = metricsIntervalMs;
    this.#engine = new LoadEngine({ runId: record.id, config, pinnedAddresses, ...engineOptions });
    this.#engine.on('batch', (workerIndex, batch) => this.#aggregator.ingest(workerIndex, batch));
    this.#engine.once('finished', (outcome) => this.#complete(outcome));
  }

  get workerCount() {
    return this.#engine.workerCount;
  }

  liveCounters() {
    return this.#engine.liveCounters();
  }

  /** No rechaza: un error al arrancar se refleja como una corrida fallida. */
  async start() {
    try {
      await this.#engine.start();
      if (this.record.finishedAt) return;

      this.record.startedAt = new Date().toISOString();
      this.#sampleTimer = setInterval(() => this.#sample(), this.#metricsIntervalMs);
    } catch (error) {
      this.#complete({ reason: RunStatus.FAILED, error });
    }
  }

  stop() {
    return this.#engine.stop();
  }

  #sample() {
    const elapsedSeconds = this.#engine.elapsedSeconds;
    const windowSeconds = elapsedSeconds - this.#lastSampleElapsed;
    if (windowSeconds <= 0) return;

    this.#lastSampleElapsed = elapsedSeconds;
    const point = this.#aggregator.closeWindow({
      elapsedSeconds,
      windowSeconds,
      targetVus: this.#engine.targetVus,
    });
    this.record.timeline.push(point);
    this.emit('metrics', { point, totals: this.#aggregator.totals() });
  }

  #complete({ reason, error }) {
    clearInterval(this.#sampleTimer);
    // Una ventana final muy corta daría un req/s engañoso. Sus peticiones no se
    // pierden: ya están en el acumulado del resumen.
    const lastWindowSeconds = this.#engine.elapsedSeconds - this.#lastSampleElapsed;
    if (lastWindowSeconds * 1000 >= this.#metricsIntervalMs / 2) this.#sample();

    Object.assign(this.record, {
      status: reason,
      summary: this.#aggregator.summarize(this.#engine.elapsedSeconds),
      error: error ? error.message : null,
      finishedAt: new Date().toISOString(),
    });
    this.emit('finished', this.record);
  }
}
