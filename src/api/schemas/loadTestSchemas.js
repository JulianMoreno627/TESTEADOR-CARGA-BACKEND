import http from 'node:http';
import { z } from 'zod';

const FORBIDDEN_HEADERS = new Set([
  'host', 'content-length', 'connection', 'transfer-encoding', 'upgrade', 'keep-alive', 'te', 'trailer', 'expect',
]);
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const METHODS_WITHOUT_BODY = new Set(['GET', 'HEAD', 'OPTIONS']);
const MAX_BODY_BYTES = 64 * 1024;

function isValidHeader(name, value) {
  try {
    http.validateHeaderName(name);
    http.validateHeaderValue(name, value);
    return true;
  } catch {
    return false;
  }
}

const urlSchema = z.string().max(2048).superRefine((value, context) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    context.addIssue({ code: 'custom', message: 'URL inválida.' });
    return;
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    context.addIssue({ code: 'custom', message: 'Solo se admite http y https.' });
  }
  if (url.username || url.password) {
    context.addIssue({ code: 'custom', message: 'Envía las credenciales en los headers, no en la URL.' });
  }
});

const headersSchema = z.record(z.string(), z.string()).default({}).superRefine((headers, context) => {
  const entries = Object.entries(headers);
  if (entries.length > 50) context.addIssue({ code: 'custom', message: 'Máximo 50 headers.' });

  for (const [name, value] of entries) {
    const lowerName = name.toLowerCase();
    if (FORBIDDEN_HEADERS.has(lowerName) || lowerName.startsWith('proxy-')) {
      // Host, en especial, permitiría apuntar a un dominio distinto del verificado.
      context.addIssue({ code: 'custom', message: `El header ${name} no se puede modificar.`, path: [name] });
    } else if (!isValidHeader(name, value)) {
      context.addIssue({ code: 'custom', message: `El header ${name} no es válido.`, path: [name] });
    }
  }
});

function patternSchema({ maxVus, maxDurationSeconds }) {
  const seconds = z.number().int().positive().max(maxDurationSeconds);
  const vus = z.number().int().positive().max(maxVus);

  return z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('constant') }),
    z.strictObject({ type: z.literal('ramp'), startVus: vus.optional(), rampSeconds: seconds.optional() }),
    z.strictObject({
      type: z.literal('spike'),
      baseVus: vus.optional(),
      spikes: z.number().int().min(1).max(20).optional(),
      spikeSeconds: seconds.optional(),
    }),
  ]);
}

function checkPatternFitsTest({ pattern, vus, durationSeconds }, context) {
  const issue = (field, message) => context.addIssue({ code: 'custom', message, path: ['pattern', field] });

  if (pattern.type === 'ramp') {
    if (pattern.startVus > vus) issue('startVus', 'No puede superar el total de usuarios virtuales.');
    if (pattern.rampSeconds > durationSeconds) issue('rampSeconds', 'No puede superar la duración de la prueba.');
  }
  if (pattern.type === 'spike') {
    if (pattern.baseVus > vus) issue('baseVus', 'No puede superar el total de usuarios virtuales.');
    if ((pattern.spikeSeconds ?? 1) * (pattern.spikes ?? 2) > durationSeconds) {
      issue('spikeSeconds', 'Los picos no caben en la duración de la prueba.');
    }
  }
}

/** Los límites vienen de la configuración, por eso el esquema se crea con una función. */
export function createStartLoadTestSchema({ maxVus, maxDurationSeconds }) {
  return z
    .strictObject({
      name: z.string().trim().min(1).max(120).optional(),
      url: urlSchema,
      method: z.enum(METHODS).default('GET'),
      headers: headersSchema,
      body: z.union([z.string(), z.record(z.string(), z.unknown()), z.array(z.unknown())]).optional(),
      vus: z.number().int().positive().max(maxVus),
      durationSeconds: z.number().int().positive().max(maxDurationSeconds),
      pattern: patternSchema({ maxVus, maxDurationSeconds }).default({ type: 'constant' }),
      thinkTimeMs: z.number().int().min(0).max(60_000).default(0),
      timeoutMs: z.number().int().min(100).max(60_000).default(10_000),
    })
    .superRefine((config, context) => {
      checkPatternFitsTest(config, context);
      if (config.body !== undefined && METHODS_WITHOUT_BODY.has(config.method)) {
        context.addIssue({ code: 'custom', message: `${config.method} no admite cuerpo.`, path: ['body'] });
      }
    })
    .transform((config) => {
      if (config.body === undefined || typeof config.body === 'string') return config;

      const hasContentType = Object.keys(config.headers).some((name) => name.toLowerCase() === 'content-type');
      return {
        ...config,
        body: JSON.stringify(config.body),
        headers: hasContentType ? config.headers : { ...config.headers, 'Content-Type': 'application/json' },
      };
    })
    .refine((config) => !config.body || Buffer.byteLength(config.body) <= MAX_BODY_BYTES, {
      message: 'El cuerpo no puede superar 64 KB.',
      path: ['body'],
    });
}

export const idParamsSchema = z.object({ id: z.uuid() });

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const compareQuerySchema = z.object({ baseline: z.uuid(), candidate: z.uuid() });

export const reportQuerySchema = z.object({ format: z.enum(['json', 'pdf']).default('json') });
