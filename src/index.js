import { buildServer } from './bootstrap.js';
import { loadConfig } from './config/env.js';
import { createLogger } from './shared/logger.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

const config = loadConfig();
const logger = createLogger(config.logLevel);

try {
  const server = await buildServer(config, logger);
  const { address, port } = await server.listen();
  logger.info(`Servidor listo en http://${address}:${port}`);

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Apagando el servidor');
    setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();

    try {
      await server.shutdown();
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'Error durante el apagado');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
} catch (error) {
  logger.fatal({ err: error }, 'No se pudo iniciar el servidor');
  process.exit(1);
}
