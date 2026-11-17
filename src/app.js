import { fileURLToPath } from 'node:url';
import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { createErrorHandler, notFoundHandler } from './api/middlewares/errorHandler.js';
import { createRateLimiter } from './api/middlewares/rateLimiter.js';
import { requestTiming } from './api/middlewares/requestTiming.js';
import { apiRoutes } from './api/routes/index.js';
import { viewRoutes } from './api/routes/view.routes.js';

const CONTRACT_PATH = fileURLToPath(new URL('../contract/openapi.yaml', import.meta.url));

/** Construye la aplicación Express. No abre puertos, así se puede probar aislada. */
export function createApp({ config, controllers, serverMetrics, logger }) {
  const app = express();
  const writeLimiter = createRateLimiter(config.limits.rateLimitPerMinute);
  // Límite propio para la IA: cuida la cuota gratuita de Gemini y Groq.
  const aiLimiter = createRateLimiter(config.ai.rateLimitPerMinute);

  app.disable('x-powered-by');
  // Detrás del proxy de Render: así el límite de solicitudes distingue a cada cliente por su IP real.
  if (config.server.trustProxy) app.set('trust proxy', 1);
  app.use(requestTiming(serverMetrics));
  app.use(helmet({
    contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } },
  }));
  app.use(cors({
    origin: config.server.corsOrigins,
    exposedHeaders: ['Content-Disposition', 'Server-Timing', 'X-Render-Strategy', 'X-Cache'],
  }));
  app.use(compression());
  app.use(express.json({ limit: '256kb' }));

  app.get('/', (_req, res) => res.redirect('/views/history'));
  app.get('/health', controllers.system.health);
  app.get('/health/live', (_req, res) => res.json({ status: 'ok' }));
  // Contract-first: el frontend descarga de aquí el contrato con el que se prueba.
  app.get('/api/v1/openapi.yaml', (_req, res) => res.type('application/yaml').sendFile(CONTRACT_PATH));
  app.use('/api/v1', apiRoutes({ controllers, limits: config.limits, writeLimiter, aiLimiter }));
  app.use('/views', viewRoutes({ controller: controllers.view }));

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}
