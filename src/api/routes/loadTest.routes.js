import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import {
  compareQuerySchema,
  createStartLoadTestSchema,
  idParamsSchema,
  listQuerySchema,
  reportQuerySchema,
} from '../schemas/loadTestSchemas.js';

export function loadTestRoutes({ controller, limits, writeLimiter }) {
  const router = Router();
  const startSchema = createStartLoadTestSchema(limits);

  router.post('/', writeLimiter, validate({ body: startSchema }), controller.start);
  router.get('/', validate({ query: listQuerySchema }), controller.list);
  // Debe ir antes de /:id para que "compare" no se interprete como un id.
  router.get('/compare', validate({ query: compareQuerySchema }), controller.compare);
  router.get('/:id', validate({ params: idParamsSchema }), controller.getById);
  router.post('/:id/stop', validate({ params: idParamsSchema }), controller.stop);
  router.get('/:id/report', validate({ params: idParamsSchema, query: reportQuerySchema }), controller.downloadReport);
  router.delete('/:id', validate({ params: idParamsSchema }), controller.remove);

  return router;
}
