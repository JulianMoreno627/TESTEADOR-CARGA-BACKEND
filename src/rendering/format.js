const number = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 });
const dateTime = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' });

export const formatNumber = (value) => (value === null || value === undefined ? '—' : number.format(value));
export const formatMs = (value) => (value === null || value === undefined ? '—' : `${number.format(value)} ms`);
export const formatPercent = (ratio) => (ratio === null || ratio === undefined ? '—' : `${number.format(ratio * 100)} %`);
export const formatDate = (iso) => (iso ? dateTime.format(new Date(iso)) : '—');

export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${number.format(value)} ${units[unit]}`;
}

export const STATUS_LABELS = {
  running: 'En ejecución',
  completed: 'Completada',
  stopped: 'Detenida',
  failed: 'Fallida',
};

export const PATTERN_LABELS = {
  constant: 'Constante',
  ramp: 'Rampa ascendente',
  spike: 'Picos',
};

/** Máximo redondeado del eje Y (1, 2, 5 × 10ⁿ), para que las marcas sean legibles. */
export function niceAxisMax(value) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = [1, 2, 5, 10].find((candidate) => normalized <= candidate);
  return step * magnitude;
}
