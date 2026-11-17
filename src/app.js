import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { createErrorHandler, notFoundHandler } from './api/middlewares/errorHandler.js';
import { createRateLimiter } from './api/middlewares/rateLimiter.js';
import { requestTiming } from './api/middlewares/requestTiming.js';
import { apiRoutes } from './api/routes/index.js';
import { viewRoutes } from './api/routes/view.routes.js';

/** Construye la aplicación Express. No abre puertos, así se puede probar aislada. */
export function createApp({ config, controllers, serverMetrics, logger }) {
  const app = express();
  const writeLimiter = createRateLimiter(config.limits.rateLimitPerMinute);

  app.disable('x-powered-by');
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
  app.use('/api/v1', apiRoutes({ controllers, limits: config.limits, writeLimiter }));
  app.use('/views', viewRoutes({ controller: controllers.view }));

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}
