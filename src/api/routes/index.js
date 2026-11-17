import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import { idParamsSchema } from '../schemas/loadTestSchemas.js';
import { loadTestRoutes } from './loadTest.routes.js';
import { targetRoutes } from './target.routes.js';

/** API REST versionada: los datos que consume el frontend (CSR). */
export function apiRoutes({ controllers, limits, writeLimiter, aiLimiter }) {
  const router = Router();
  const byId = validate({ params: idParamsSchema });

  router.get('/load-tests/:id/analysis', byId, controllers.analysis.get);
  router.post('/load-tests/:id/analysis', aiLimiter, byId, controllers.analysis.create);
  router.use('/load-tests', loadTestRoutes({ controller: controllers.loadTest, limits, writeLimiter }));
  router.use('/targets', targetRoutes({ controller: controllers.target, writeLimiter }));
  router.get('/metrics', controllers.system.metrics);

  return router;
}
