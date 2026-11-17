import { formatNumber, niceAxisMax } from '../format.js';
import { html } from '../html.js';

const WIDTH = 520;
const HEIGHT = 200;
const MARGIN = { top: 10, right: 12, bottom: 24, left: 46 };
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;
const Y_TICKS = 4;

/** Las ventanas sin datos dejan un hueco en la línea en lugar de inventar un valor. */
function buildPath(points, read, scaleX, scaleY) {
  let path = '';
  let drawing = false;
  for (const point of points) {
    const value = read(point);
    if (value === null || value === undefined) {
      drawing = false;
    } else {
      path += `${drawing ? 'L' : 'M'}${scaleX(point.t).toFixed(1)} ${scaleY(value).toFixed(1)}`;
      drawing = true;
    }
  }
  return path;
}

/**
 * Gráfica de líneas en SVG, sin JavaScript. La guía vertical se activa con CSS y
 * el detalle de cada instante aparece como tooltip nativo mediante <title>.
 *
 * @param {{ title: string, points: object[], unit: string, series: Array<{label, slot, read}> }} chart
 */
export function lineChart({ title, points, unit, series }) {
  const peak = Math.max(0, ...points.flatMap((point) => series.map(({ read }) => read(point) ?? 0)));
  const yMax = niceAxisMax(peak);
  const tMax = Math.max(1, ...points.map((point) => point.t));

  const scaleX = (t) => MARGIN.left + (t / tMax) * PLOT_WIDTH;
  const scaleY = (value) => MARGIN.top + PLOT_HEIGHT - (value / yMax) * PLOT_HEIGHT;
  const columnWidth = PLOT_WIDTH / Math.max(1, points.length);

  const ticks = Array.from({ length: Y_TICKS + 1 }, (_, index) => (yMax / Y_TICKS) * index);

  return html`
    <figure class="card chart" style="margin:0">
      <figcaption class="chart-title">${title}</figcaption>
      ${series.length > 1
        ? html`<ul class="legend">${series.map(
            ({ label, slot }) => html`<li><i style="background:var(--series-${slot})"></i>${label}</li>`,
          )}</ul>`
        : null}
      <svg viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${title}">
        ${ticks.map(
          (tick) => html`
            <line class="grid" x1="${MARGIN.left}" x2="${WIDTH - MARGIN.right}" y1="${scaleY(tick)}" y2="${scaleY(tick)}"></line>
            <text x="${MARGIN.left - 6}" y="${scaleY(tick) + 4}" text-anchor="end">${formatNumber(tick)}</text>
          `,
        )}
        <text x="${MARGIN.left}" y="${HEIGHT - 6}">0 s</text>
        <text x="${WIDTH - MARGIN.right}" y="${HEIGHT - 6}" text-anchor="end">${Math.round(tMax)} s</text>
        ${series.map(
          ({ read, slot }) => html`
            <path class="series" style="stroke:var(--series-${slot})" d="${buildPath(points, read, scaleX, scaleY)}"></path>
          `,
        )}
        ${points.map(
          (point) => html`
            <g class="column">
              <line class="crosshair" x1="${scaleX(point.t)}" x2="${scaleX(point.t)}" y1="${MARGIN.top}" y2="${MARGIN.top + PLOT_HEIGHT}"></line>
              <rect class="hit" x="${scaleX(point.t) - columnWidth / 2}" y="${MARGIN.top}" width="${columnWidth}" height="${PLOT_HEIGHT}">
                <title>${[`${point.t} s`, ...series.map(({ label, read }) => `${label}: ${read(point) ?? '—'} ${unit}`)].join('\n')}</title>
              </rect>
            </g>
          `,
        )}
      </svg>
    </figure>
  `;
}
