import { parentPort, workerData } from 'node:worker_threads';
import { BatchCollector } from './BatchCollector.js';
import { HttpRequester } from './HttpRequester.js';
import { VirtualUserPool } from './VirtualUserPool.js';

/**
 * Punto de entrada del Worker Thread. Genera tráfico fuera del hilo principal,
 * de modo que la API y los WebSockets siguen respondiendo durante la prueba.
 *
 * Principal -> worker: { type: 'set-vus', count } | { type: 'stop' }
 * Worker -> principal: { type: 'ready' } | { type: 'batch', batch } | { type: 'stopped' }
 */
const { runId, request, thinkTimeMs, pinnedAddresses, flushIntervalMs } = workerData;

const collector = new BatchCollector();
const pool = new VirtualUserPool({
  requester: new HttpRequester({ ...request, runId, pinnedAddresses }),
  collector,
  thinkTimeMs,
});

const flush = (activeVus = pool.activeCount) => {
  parentPort.postMessage({ type: 'batch', batch: collector.drain(activeVus) });
};

const flushTimer = setInterval(flush, flushIntervalMs);

parentPort.on('message', async (message) => {
  if (message.type === 'set-vus') {
    pool.setTarget(message.count);
  } else if (message.type === 'stop') {
    clearInterval(flushTimer);
    // Se conserva el valor previo: el último punto refleja la carga real, no el apagado.
    const activeVus = pool.activeCount;
    await pool.stop();
    flush(activeVus);
    parentPort.postMessage({ type: 'stopped' });
    parentPort.close();
  }
});

parentPort.postMessage({ type: 'ready' });
