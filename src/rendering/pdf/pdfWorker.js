import { parentPort } from 'node:worker_threads';
import { renderReportPdf } from './reportPdf.js';

/**
 * Hilo que genera PDF para el WorkerPool. Dibujar el documento es trabajo de CPU:
 * hacerlo aquí deja libre el event loop que atiende la API y los WebSockets.
 */
parentPort.on('message', async ({ id, payload }) => {
  try {
    const bytes = await renderReportPdf(payload.run, payload.analysis);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    // Se transfiere el ArrayBuffer en lugar de copiarlo: pasa al hilo principal sin duplicarse.
    parentPort.postMessage({ id, result: buffer }, [buffer]);
  } catch (error) {
    parentPort.postMessage({ id, error: error.message });
  }
});
