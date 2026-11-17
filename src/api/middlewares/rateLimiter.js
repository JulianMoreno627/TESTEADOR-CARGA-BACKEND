import { rateLimit } from 'express-rate-limit';
import { AppError } from '../../shared/errors.js';

export function createRateLimiter(limitPerMinute) {
  return rateLimit({
    windowMs: 60_000,
    limit: limitPerMinute,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(new AppError(429, 'RATE_LIMITED', 'Demasiadas solicitudes. Intenta de nuevo en un minuto.'));
    },
  });
}
