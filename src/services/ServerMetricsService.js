import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { LatencyHistogram } from '../domain/metrics/LatencyHistogram.js';

const SAMPLE_INTERVAL_MS = 5_000;
const toMs = (nanoseconds) => Number((nanoseconds / 1e6).toFixed(2));
const toMb = (bytes) => Number((bytes / 1024 / 1024).toFixed(1));

/**
 * Rendimiento del propio backend. El retardo del event loop demuestra si los
 * workers cumplen su función: si sube durante una prueba, el hilo principal se
 * está bloqueando.
 */
export class ServerMetricsService {
  #loopDelay = monitorEventLoopDelay({ resolution: 20 });
  #routes = new Map();
  #gauges = new Map();
  #timer = null;
  #lastElu = performance.eventLoopUtilization();
  #lastCpu = process.cpuUsage();
  #lastSampleAt = performance.now();
  #latest = { eventLoop: null, cpuPercent: 0 };

  start() {
    this.#loopDelay.enable();
    this.#timer = setInterval(() => this.#sample(), SAMPLE_INTERVAL_MS);
    this.#timer.unref();
  }

  stop() {
    clearInterval(this.#timer);
    this.#loopDelay.disable();
  }

  registerGauge(name, read) {
    this.#gauges.set(name, read);
  }

  recordHttpRequest(route, statusCode, durationMs) {
    let stats = this.#routes.get(route);
    if (!stats) {
      stats = { count: 0, serverErrors: 0, histogram: new LatencyHistogram() };
      this.#routes.set(route, stats);
    }
    stats.count += 1;
    if (statusCode >= 500) stats.serverErrors += 1;
    stats.histogram.record(durationMs);
  }

  snapshot() {
    const memory = process.memoryUsage();
    const routes = Object.fromEntries(
      [...this.#routes].map(([route, { count, serverErrors, histogram }]) => {
        const { mean, p50, p95, p99 } = histogram.summary();
        return [route, { count, serverErrors, latencyMs: { mean, p50, p95, p99 } }];
      }),
    );
    const gauges = Object.fromEntries([...this.#gauges].map(([name, read]) => [name, read()]));

    return {
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      ...this.#latest,
      memoryMb: {
        rss: toMb(memory.rss),
        heapUsed: toMb(memory.heapUsed),
        heapTotal: toMb(memory.heapTotal),
      },
      gauges,
      routes,
    };
  }

  #sample() {
    const now = performance.now();
    const elapsedMicros = (now - this.#lastSampleAt) * 1000;
    const cpu = process.cpuUsage(this.#lastCpu);
    const elu = performance.eventLoopUtilization(this.#lastElu);

    this.#latest = {
      eventLoop: {
        delayMeanMs: toMs(this.#loopDelay.mean),
        delayP99Ms: toMs(this.#loopDelay.percentile(99)),
        delayMaxMs: toMs(this.#loopDelay.max),
        utilization: Number(elu.utilization.toFixed(3)),
      },
      // Incluye a los workers: process.cpuUsage mide todo el proceso.
      cpuPercent: Number((((cpu.user + cpu.system) / elapsedMicros) * 100).toFixed(1)),
    };

    this.#loopDelay.reset();
    this.#lastElu = performance.eventLoopUtilization();
    this.#lastCpu = process.cpuUsage();
    this.#lastSampleAt = now;
  }
}
