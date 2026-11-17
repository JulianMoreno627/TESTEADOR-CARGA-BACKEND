import { isFinished } from '../domain/runStatus.js';
import { renderReportPdf } from '../rendering/pdf/reportPdf.js';
import { renderReportPage } from '../rendering/views/reportPage.js';
import { ConflictError } from '../shared/errors.js';

/** Reportes de corridas terminadas, que ya no cambian y por eso se generan una sola vez. */
export class ReportService {
  #loadTests;
  #store;

  constructor({ loadTests, store }) {
    this.#loadTests = loadTests;
    this.#store = store;
  }

  buildJson(id) {
    return this.#finishedRun(id);
  }

  async pdfPath(id) {
    return this.#store.ensure(`${id}.pdf`, async () => renderReportPdf(await this.#finishedRun(id)));
  }

  async htmlPath(id) {
    return this.#store.ensure(`${id}.html`, async () => renderReportPage(await this.#finishedRun(id)));
  }

  removeGenerated(id) {
    return Promise.all([this.#store.remove(`${id}.pdf`), this.#store.remove(`${id}.html`)]);
  }

  async #finishedRun(id) {
    const run = await this.#loadTests.getById(id);
    if (!isFinished(run.status)) {
      throw new ConflictError('REPORT_NOT_READY', 'El reporte estará disponible cuando termine la prueba.');
    }
    return run;
  }
}
