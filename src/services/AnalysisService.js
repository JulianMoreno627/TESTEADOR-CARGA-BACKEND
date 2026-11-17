import { EventEmitter } from 'node:events';
import { buildAnalysisPrompt } from '../ai/analysisPrompt.js';
import { isFinished } from '../domain/runStatus.js';
import { AppError, ConflictError } from '../shared/errors.js';

/**
 * Análisis con IA de una corrida terminada. Como la corrida ya no cambia, el
 * análisis se genera una vez y se guarda.
 *
 * Eventos: 'created' (runId).
 */
export class AnalysisService extends EventEmitter {
  #loadTests;
  #runs;
  #aiClient;
  #inFlight = new Map();

  constructor({ loadTests, runs, aiClient }) {
    super();
    this.#loadTests = loadTests;
    this.#runs = runs;
    this.#aiClient = aiClient;
  }

  async get(id) {
    await this.#loadTests.getById(id);
    const analysis = await this.#runs.findAnalysis(id);
    if (!analysis) throw new AppError(404, 'ANALYSIS_NOT_FOUND', 'Esta prueba aún no tiene análisis con IA.');
    return analysis;
  }

  /** Idempotente: devuelve el guardado si existe y comparte la generación entre peticiones simultáneas. */
  async create(id) {
    const run = await this.#loadTests.getById(id);
    if (!isFinished(run.status)) {
      throw new ConflictError('REPORT_NOT_READY', 'El análisis estará disponible cuando termine la prueba.');
    }
    if (!run.summary) {
      throw new ConflictError('TEST_NOT_COMPARABLE', 'Esta prueba se interrumpió y no tiene resultados para analizar.');
    }

    const existing = await this.#runs.findAnalysis(id);
    if (existing) return existing;

    if (!this.#inFlight.has(id)) {
      const generating = this.#generate(run).finally(() => this.#inFlight.delete(id));
      this.#inFlight.set(id, generating);
    }
    return this.#inFlight.get(id);
  }

  async #generate(run) {
    const { content, provider, model, fallbackUsed, durationMs } = await this.#aiClient.generate(buildAnalysisPrompt(run));
    const analysis = {
      runId: run.id,
      provider,
      model,
      fallbackUsed,
      generatedAt: new Date().toISOString(),
      durationMs,
      content,
    };
    await this.#runs.saveAnalysis(run.id, analysis);
    this.emit('created', run.id);
    return analysis;
  }
}
