import { AppError, NotFoundError } from '../../shared/errors.js';

export function notFoundHandler(req, _res, next) {
  next(new NotFoundError(`No existe la ruta ${req.method} ${req.path}.`));
}

export function createErrorHandler(logger) {
  // Express reconoce un manejador de errores porque recibe cuatro argumentos.
  return (error, req, res, next) => {
    // Si la respuesta ya empezó, solo Express puede cerrarla correctamente.
    if (res.headersSent) {
      next(error);
      return;
    }

    if (error instanceof AppError) {
      res.status(error.status).json({
        success: false,
        error: { code: error.code, message: error.message, details: error.details },
      });
      return;
    }

    // Errores de body-parser, como JSON mal formado o cuerpo demasiado grande.
    if (error.status >= 400 && error.status < 500) {
      res.status(error.status).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'La petición no se pudo procesar.' },
      });
      return;
    }

    logger.error({ err: error, method: req.method, path: req.path }, 'Error no controlado');
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Ocurrió un error interno.' },
    });
  };
}
