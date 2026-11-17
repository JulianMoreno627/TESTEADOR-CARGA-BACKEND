import { Router } from 'express';
import { loadTestRoutes } from './loadTest.routes.js';
import { targetRoutes } from './target.routes.js';

/** API REST versionada: los datos que consume el frontend (CSR). */
export function apiRoutes({ controllers, limits, writeLimiter }) {
  const router = Router();

  router.use('/load-tests', loadTestRoutes({ controller: controllers.loadTest, limits, writeLimiter }));
  router.use('/targets', targetRoutes({ controller: controllers.target, writeLimiter }));
  router.get('/metrics', controllers.system.metrics);

  return router;
}
