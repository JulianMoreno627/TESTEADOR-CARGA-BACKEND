import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middlewares/validate.js';
import { idParamsSchema } from '../schemas/loadTestSchemas.js';

// El formulario envía valores vacíos al cargar la página; se tratan como "sin elegir".
const compareViewQuerySchema = z.object({
  baseline: z.uuid().optional().catch(undefined),
  candidate: z.uuid().optional().catch(undefined),
});

export function viewRoutes({ controller }) {
  const router = Router();

  router.get('/history', controller.history);
  router.get('/reports/:id', validate({ params: idParamsSchema }), controller.report);
  router.get('/compare', validate({ query: compareViewQuerySchema }), controller.compare);

  return router;
}
