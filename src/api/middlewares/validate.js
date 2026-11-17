import { ValidationError } from '../../shared/errors.js';

/**
 * Valida partes de la petición y deja el resultado en `req.valid`.
 * @param {{ body?: import('zod').ZodType, params?: import('zod').ZodType, query?: import('zod').ZodType }} schemas
 */
export function validate(schemas) {
  return (req, _res, next) => {
    req.valid = {};
    for (const [source, schema] of Object.entries(schemas)) {
      const result = schema.safeParse(req[source] ?? {});
      if (!result.success) {
        throw new ValidationError(
          result.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
        );
      }
      req.valid[source] = result.data;
    }
    next();
  };
}
