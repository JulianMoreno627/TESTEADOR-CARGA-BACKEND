import onHeaders from 'on-headers';

/**
 * Mide cada petición de dos formas: la cabecera Server-Timing, visible en la
 * pestaña Network de DevTools, y las estadísticas por ruta de /api/v1/metrics.
 * Las vistas pueden añadir mediciones propias a `res.locals.timings`.
 */
export function requestTiming(serverMetrics) {
  return (req, res, next) => {
    const startedAt = performance.now();
    res.locals.timings = [];

    onHeaders(res, () => {
      const total = (performance.now() - startedAt).toFixed(1);
      const entries = [...res.locals.timings, `total;dur=${total}`];
      res.setHeader('Server-Timing', entries.join(', '));
    });

    res.once('finish', () => {
      // Se usa el patrón de la ruta, no la URL real, para no crear una entrada por cada id.
      const route = req.route ? `${req.method} ${req.baseUrl}${req.route.path}` : 'unmatched';
      serverMetrics.recordHttpRequest(route, res.statusCode, performance.now() - startedAt);
    });

    next();
  };
}
