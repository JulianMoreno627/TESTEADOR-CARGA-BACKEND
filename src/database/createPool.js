import pg from 'pg';

export function createPool(connectionString, logger) {
  const pool = new pg.Pool({ connectionString, max: 10 });
  pool.on('error', (error) => logger.error({ err: error }, 'Error en una conexión inactiva de PostgreSQL'));
  return pool;
}
