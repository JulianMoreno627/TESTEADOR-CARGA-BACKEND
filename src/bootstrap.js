import { createServer } from 'node:http';
import { createAiClient } from './ai/createAiClient.js';
import { AnalysisController } from './api/controllers/AnalysisController.js';
import { LoadTestController } from './api/controllers/LoadTestController.js';
import { SystemController } from './api/controllers/SystemController.js';
import { TargetController } from './api/controllers/TargetController.js';
import { ViewController } from './api/controllers/ViewController.js';
import { createApp } from './app.js';
import { createPool } from './database/createPool.js';
import { runMigrations } from './database/migrate.js';
import { SocketGateway } from './realtime/SocketGateway.js';
import { IsrCache } from './rendering/IsrCache.js';
import { StaticReportStore } from './rendering/StaticReportStore.js';
import { renderHistoryPage } from './rendering/views/historyPage.js';
import { InMemoryTargetRepository } from './repositories/memory/InMemoryTargetRepository.js';
import { InMemoryTestRunRepository } from './repositories/memory/InMemoryTestRunRepository.js';
import { PostgresTargetRepository } from './repositories/postgres/PostgresTargetRepository.js';
import { PostgresTestRunRepository } from './repositories/postgres/PostgresTestRunRepository.js';
import { AnalysisService } from './services/AnalysisService.js';
import { LoadTestService } from './services/LoadTestService.js';
import { ReportService } from './services/ReportService.js';
import { ServerMetricsService } from './services/ServerMetricsService.js';
import { TargetPolicy } from './services/TargetPolicy.js';
import { TargetService } from './services/TargetService.js';

const HISTORY_PAGE_SIZE = 50;
const HISTORY_ISR_TTL_MS = 30_000;

async function createRepositories(config, logger) {
  if (!config.database.url) {
    logger.warn('DATABASE_URL no está definida: el historial se guardará solo en memoria.');
    return {
      runs: new InMemoryTestRunRepository(),
      targets: new InMemoryTargetRepository(),
      close: async () => {},
    };
  }

  const pool = createPool(config.database.url, logger);
  await runMigrations(pool, logger);
  return {
    runs: new PostgresTestRunRepository(pool),
    targets: new PostgresTargetRepository(pool),
    close: () => pool.end(),
  };
}

/**
 * Raíz de composición: el único lugar donde se crean las dependencias y se
 * conectan entre sí. El resto del código las recibe por su constructor.
 *
 * @param {object} config resultado de loadConfig()
 * @param {object} overrides dependencias alternativas para las pruebas
 */
export async function buildServer(config, logger, overrides = {}) {
  const repositories = await createRepositories(config, logger);
  const { runs, targets } = repositories;

  const policy = new TargetPolicy({
    targets,
    allowLocalhost: config.security.allowLocalhost,
    ...overrides.policy,
  });
  const targetService = new TargetService({ targets, policy, ...overrides.targetService });

  const loadTests = new LoadTestService({
    runs,
    policy,
    engineConfig: config.engine,
    maxConcurrentTests: config.limits.maxConcurrentTests,
    logger,
  });
  const reports = new ReportService({
    loadTests,
    runs,
    store: new StaticReportStore(config.storage.reportsDir),
  });
  const analyses = new AnalysisService({
    loadTests,
    runs,
    aiClient: overrides.aiClient ?? createAiClient(config.ai, logger),
  });
  const serverMetrics = new ServerMetricsService();

  const historyCache = new IsrCache({
    ttlMs: HISTORY_ISR_TTL_MS,
    logger,
    render: async () => renderHistoryPage(await loadTests.list({ limit: HISTORY_PAGE_SIZE, offset: 0 })),
  });

  for (const event of ['started', 'finished', 'deleted']) {
    loadTests.on(event, () => historyCache.invalidate());
  }
  // Revalidación bajo demanda del SSG: al borrar la prueba o al añadirle el análisis
  // con IA, el reporte estático queda viejo y se regenera en la próxima visita.
  const discardReport = (id) => {
    reports.removeGenerated(id).catch((error) => {
      logger.error({ err: error, runId: id }, 'No se pudo borrar el reporte generado');
    });
  };
  loadTests.on('deleted', discardReport);
  analyses.on('created', discardReport);

  const app = createApp({
    config,
    logger,
    serverMetrics,
    controllers: {
      loadTest: new LoadTestController({ loadTests, reports }),
      analysis: new AnalysisController({ analyses }),
      target: new TargetController({ targets: targetService }),
      view: new ViewController({ loadTests, reports, historyCache }),
      system: new SystemController({ serverMetrics, runs }),
    },
  });

  const httpServer = createServer(app);
  const gateway = new SocketGateway({
    httpServer,
    corsOrigins: config.server.corsOrigins,
    loadTests,
    serverMetrics,
    logger,
  });

  serverMetrics.registerGauge('activeLoadTests', () => loadTests.activeCount);
  serverMetrics.registerGauge('activeWorkers', () => loadTests.activeWorkerCount);
  serverMetrics.registerGauge('socketClients', () => gateway.clientCount);

  const interrupted = await loadTests.recoverInterruptedRuns();
  if (interrupted > 0) logger.warn({ interrupted }, 'Corridas interrumpidas marcadas como fallidas');

  return {
    httpServer,
    loadTests,

    listen() {
      serverMetrics.start();
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(config.server.port, config.server.host, () => {
          httpServer.off('error', reject);
          resolve(httpServer.address());
        });
      });
    },

    /** Apagado ordenado: guarda las pruebas activas antes de cerrar las conexiones. */
    async shutdown() {
      await loadTests.shutdown();
      serverMetrics.stop();
      // gateway.close() también cierra el servidor HTTP asociado.
      await gateway.close();
      await repositories.close();
    },
  };
}
