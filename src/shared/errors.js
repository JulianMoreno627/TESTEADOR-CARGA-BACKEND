/** Error esperado de la aplicación: el manejador HTTP lo traduce a una respuesta. */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(details) {
    super(422, 'VALIDATION_ERROR', 'Los datos enviados no son válidos.', details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Recurso no encontrado.') {
    super(404, 'NOT_FOUND', message);
  }
}

export class ConflictError extends AppError {
  constructor(code, message) {
    super(409, code, message);
  }
}

export class ForbiddenTargetError extends AppError {
  constructor(code, message, details) {
    super(403, code, message, details);
  }
}

export class CapacityError extends AppError {
  constructor(message) {
    super(429, 'CAPACITY_EXCEEDED', message);
  }
}
