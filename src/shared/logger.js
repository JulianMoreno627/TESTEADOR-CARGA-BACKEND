import pino from 'pino';

export function createLogger(level = 'info') {
  return pino({
    level,
    // Por si un objeto de configuración llega a los logs: nunca se escriben credenciales.
    redact: ['*.headers.authorization', '*.headers.cookie', '*.body'],
  });
}
