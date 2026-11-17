import { z } from 'zod';

/**
 * Forma de la respuesta que se le pide a la IA. Coincide con
 * AiAnalysisContent del contrato. La salida de un modelo nunca se da por buena:
 * se valida, y si no cumple se pasa al siguiente proveedor.
 */
export const analysisContentSchema = z.strictObject({
  verdict: z.enum(['healthy', 'degraded', 'critical']),
  summary: z.string().min(1).max(1200),
  findings: z
    .array(
      z.strictObject({
        title: z.string().min(1).max(120),
        detail: z.string().min(1).max(600),
        severity: z.enum(['info', 'warning', 'critical']),
      }),
    )
    .max(6),
  recommendations: z.array(z.string().min(1).max(400)).max(6),
});

/** Versión JSON Schema para los proveedores que admiten salida estructurada. */
export const analysisJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'summary', 'findings', 'recommendations'],
  properties: {
    verdict: { type: 'string', enum: ['healthy', 'degraded', 'critical'] },
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'detail', 'severity'],
        properties: {
          title: { type: 'string' },
          detail: { type: 'string' },
          severity: { type: 'string', enum: ['info', 'warning', 'critical'] },
        },
      },
    },
    recommendations: { type: 'array', items: { type: 'string' } },
  },
};
