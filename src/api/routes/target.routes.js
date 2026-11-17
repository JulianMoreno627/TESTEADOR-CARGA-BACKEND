import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import { idParamsSchema } from '../schemas/loadTestSchemas.js';
import { registerTargetSchema, verifyTargetSchema } from '../schemas/targetSchemas.js';

export function targetRoutes({ controller, writeLimiter }) {
  const router = Router();

  router.post('/', writeLimiter, validate({ body: registerTargetSchema }), controller.register);
  router.get('/', controller.list);
  router.post('/:id/verify', writeLimiter, validate({ params: idParamsSchema, body: verifyTargetSchema }), controller.verify);
  router.delete('/:id', validate({ params: idParamsSchema }), controller.remove);

  return router;
}
