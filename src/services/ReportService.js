import { isFinished } from '../domain/runStatus.js';
import { renderReportPage } from '../rendering/views/reportPage.js';
import { ConflictError } from '../shared/errors.js';

/** Reportes de corridas terminadas, que ya no cambian y por eso se generan una sola vez. */
export class ReportService {
  #loadTests;
  #runs;
  #store;
  #pdfPool;

  /** @param {{ pdfPool: import('../workers/WorkerPool.js').WorkerPool }} deps */
  constructor({ loadTests, runs, store, pdfPool }) {
    this.#loadTests = loadTests;
    this.#runs = runs;
    this.#store = store;
    this.#pdfPool = pdfPool;
  }

  buildJson(id) {
    return this.#finishedRun(id);
  }

  async pdfPath(id) {
    return this.#store.ensure(`${id}.pdf`, async () => {
      const [run, analysis] = await this.#reportData(id);
      // El PDF se dibuja en un Worker Thread del pool, no en el hilo principal.
      return Buffer.from(await this.#pdfPool.run({ run, analysis }));
    });
  }

  async htmlPath(id) {
    return this.#store.ensure(`${id}.html`, async () => renderReportPage(...(await this.#reportData(id))));
  }

  removeGenerated(id) {
    return Promise.all([this.#store.remove(`${id}.pdf`), this.#store.remove(`${id}.html`)]);
  }

  /** La corrida y, si ya existe, su análisis con IA. */
  async #reportData(id) {
    const run = await this.#finishedRun(id);
    return [run, await this.#runs.findAnalysis(id)];
  }

  async #finishedRun(id) {
    const run = await this.#loadTests.getById(id);
    if (!isFinished(run.status)) {
      throw new ConflictError('REPORT_NOT_READY', 'El reporte estará disponible cuando termine la prueba.');
    }
    return run;
  }
}
