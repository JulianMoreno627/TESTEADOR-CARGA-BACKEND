import pg from 'pg';

/**
 * Pool de conexiones. Con Neon gratuito el cómputo se suspende tras unos minutos sin
 * uso: las conexiones inactivas se cierran pronto para no mantenerlo despierto, y
 * la primera consulta tras la suspensión puede tardar un poco más.
 * La cadena de Neon debe terminar en `sslmode=verify-full` (conexión cifrada y certificado verificado).
 */
export function createPool(connectionString, logger) {
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  });
  // Neon cierra conexiones al suspenderse; el pool las reemplaza solo.
  pool.on('error', (error) => logger.warn({ err: error }, 'Se cerró una conexión inactiva de PostgreSQL'));
  return pool;
}
