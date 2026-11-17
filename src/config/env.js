import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');
const positiveInt = z.coerce.number().int().positive();

const defaultMaxWorkers = Math.min(4, Math.max(1, os.availableParallelism() - 1));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().optional(),
  TRUST_PROXY: booleanString.optional(),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'silent']).default('info'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().optional(),
  MAX_VUS: positiveInt.default(500),
  MAX_DURATION_SECONDS: positiveInt.default(300),
  MAX_CONCURRENT_TESTS: positiveInt.default(2),
  RATE_LIMIT_PER_MINUTE: positiveInt.default(30),
  ALLOW_LOCALHOST: booleanString.optional(),
  MAX_WORKERS: positiveInt.default(defaultMaxWorkers),
  VUS_PER_WORKER: positiveInt.default(100),
  METRICS_INTERVAL_MS: positiveInt.default(1000),
  REPORTS_DIR: z.string().default('storage/reports'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3.1-flash-lite'),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default('openai/gpt-oss-20b'),
  AI_TIMEOUT_MS: positiveInt.default(20_000),
  AI_RATE_LIMIT_PER_MINUTE: positiveInt.default(10),
});

/** Valida las variables de entorno y las agrupa por responsabilidad. */
export function loadConfig(source = process.env) {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Configuración inválida: ${problems}`);
  }

  const env = parsed.data;
  const isProduction = env.NODE_ENV === 'production';

  return Object.freeze({
    env: env.NODE_ENV,
    isProduction,
    logLevel: env.LOG_LEVEL,
    server: {
      // Render exige escuchar en 0.0.0.0; en desarrollo basta con la máquina local.
      host: env.HOST ?? (isProduction ? '0.0.0.0' : '127.0.0.1'),
      trustProxy: env.TRUST_PROXY ?? isProduction,
      port: env.PORT,
      corsOrigins: env.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean),
    },
    database: { url: env.DATABASE_URL || null },
    limits: {
      maxVus: env.MAX_VUS,
      maxDurationSeconds: env.MAX_DURATION_SECONDS,
      maxConcurrentTests: env.MAX_CONCURRENT_TESTS,
      rateLimitPerMinute: env.RATE_LIMIT_PER_MINUTE,
    },
    security: { allowLocalhost: env.ALLOW_LOCALHOST ?? !isProduction },
    engine: {
      maxWorkers: env.MAX_WORKERS,
      vusPerWorker: env.VUS_PER_WORKER,
      metricsIntervalMs: env.METRICS_INTERVAL_MS,
    },
    storage: { reportsDir: path.resolve(env.REPORTS_DIR) },
    ai: {
      // Una clave vacía en .env cuenta como no configurada.
      gemini: { apiKey: env.GEMINI_API_KEY || null, model: env.GEMINI_MODEL },
      groq: { apiKey: env.GROQ_API_KEY || null, model: env.GROQ_MODEL },
      timeoutMs: env.AI_TIMEOUT_MS,
      rateLimitPerMinute: env.AI_RATE_LIMIT_PER_MINUTE,
    },
  });
}
