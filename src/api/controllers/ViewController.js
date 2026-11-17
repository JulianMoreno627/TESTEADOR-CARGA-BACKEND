import { AppError } from '../../shared/errors.js';
import { renderComparePage } from '../../rendering/views/comparePage.js';

const COMPARE_RUN_OPTIONS = 100;

/**
 * Vistas renderizadas en el servidor, cada una con el patrón que mejor le sirve.
 * La cabecera X-Render-Strategy permite comprobarlo desde DevTools.
 */
export class ViewController {
  #loadTests;
  #reports;
  #historyCache;

  constructor({ loadTests, reports, historyCache }) {
    this.#loadTests = loadTests;
    this.#reports = reports;
    this.#historyCache = historyCache;
  }

  /** ISR: el historial cambia poco y se visita mucho. */
  history = async (_req, res) => {
    const startedAt = performance.now();
    const { value, state } = await this.#historyCache.get();
    res.locals.timings.push(`render;dur=${(performance.now() - startedAt).toFixed(1)}`);
    res.set({ 'X-Render-Strategy': 'ISR', 'X-Cache': state, 'Cache-Control': 'no-cache' }).type('html').send(value);
  };

  /** SSG: una corrida terminada nunca cambia, así que su reporte se genera una vez. */
  report = async (req, res) => {
    const filePath = await this.#reports.htmlPath(req.valid.params.id);
    res.set('X-Render-Strategy', 'SSG');
    res.sendFile(filePath, { maxAge: '1h', dotfiles: 'allow' });
  };

  /** SSR: el resultado depende de los parámetros de cada petición. */
  compare = async (req, res) => {
    const startedAt = performance.now();
    const { baseline: baselineId, candidate: candidateId } = req.valid.query;

    const { items } = await this.#loadTests.list({ limit: COMPARE_RUN_OPTIONS, offset: 0 });
    const page = { runs: items, baselineId, candidateId };

    if (baselineId && candidateId) {
      try {
        page.comparison = await this.#loadTests.compare(baselineId, candidateId);
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        page.errorMessage = error.message;
      }
    }

    const body = renderComparePage(page);
    res.locals.timings.push(`render;dur=${(performance.now() - startedAt).toFixed(1)}`);
    res.set({ 'X-Render-Strategy': 'SSR', 'Cache-Control': 'no-store' }).type('html').send(body);
  };
}
