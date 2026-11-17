import {
  formatBytes,
  formatDate,
  formatMs,
  formatNumber,
  formatPercent,
  PATTERN_LABELS,
  STATUS_LABELS,
} from '../format.js';
import { html } from '../html.js';
import { lineChart } from './charts.js';
import { layout } from './layout.js';

const tile = (label, value) => html`
  <div class="card"><div class="tile-label">${label}</div><div class="tile-value">${value}</div></div>
`;

function tallyTable(title, keyHeader, tally) {
  const entries = Object.entries(tally);
  if (entries.length === 0) return null;
  return html`
    <div class="card table-wrap">
      <p class="chart-title">${title}</p>
      <table>
        <thead><tr><th>${keyHeader}</th><th class="num">Peticiones</th></tr></thead>
        <tbody>${entries.map(([key, count]) => html`
          <tr><td>${key}</td><td class="num">${formatNumber(count)}</td></tr>
        `)}</tbody>
      </table>
    </div>
  `;
}

function charts(timeline) {
  return html`
    <h2>Evolución durante la prueba</h2>
    <div class="charts">
      ${lineChart({
        title: 'Latencia',
        unit: 'ms',
        points: timeline,
        series: [
          { label: 'p50', slot: 1, read: (point) => point.latency.p50 },
          { label: 'p95', slot: 2, read: (point) => point.latency.p95 },
          { label: 'p99', slot: 3, read: (point) => point.latency.p99 },
        ],
      })}
      ${lineChart({
        title: 'Throughput (req/s)',
        unit: 'req/s',
        points: timeline,
        series: [{ label: 'Throughput', slot: 1, read: (point) => point.rps }],
      })}
      ${lineChart({
        title: 'Tasa de errores (%)',
        unit: '%',
        points: timeline,
        series: [{ label: 'Errores', slot: 1, read: (point) => Number((point.errorRate * 100).toFixed(2)) }],
      })}
      ${lineChart({
        title: 'Usuarios virtuales activos',
        unit: 'VUs',
        points: timeline,
        series: [{ label: 'VUs', slot: 1, read: (point) => point.activeVus }],
      })}
    </div>
    <details class="card">
      <summary>Ver los datos en tabla</summary>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th class="num">Segundo</th><th class="num">VUs</th><th class="num">req/s</th>
            <th class="num">Errores</th><th class="num">p50</th><th class="num">p95</th><th class="num">p99</th>
          </tr></thead>
          <tbody>${timeline.map((point) => html`
            <tr>
              <td class="num">${formatNumber(point.t)}</td>
              <td class="num">${point.activeVus}</td>
              <td class="num">${formatNumber(point.rps)}</td>
              <td class="num">${formatPercent(point.errorRate)}</td>
              <td class="num">${formatMs(point.latency.p50)}</td>
              <td class="num">${formatMs(point.latency.p95)}</td>
              <td class="num">${formatMs(point.latency.p99)}</td>
            </tr>
          `)}</tbody>
        </table>
      </div>
    </details>
  `;
}

function results({ summary, timeline }) {
  if (!summary) return html`<p class="card">Esta prueba se interrumpió y no tiene resultados.</p>`;
  const { latency } = summary;
  return html`
    <div class="tiles">
      ${tile('Peticiones', formatNumber(summary.totalRequests))}
      ${tile('Throughput medio', `${formatNumber(summary.avgRps)} req/s`)}
      ${tile('Tasa de errores', formatPercent(summary.errorRate))}
      ${tile('Latencia p50', formatMs(latency.p50))}
      ${tile('Latencia p95', formatMs(latency.p95))}
      ${tile('Latencia p99', formatMs(latency.p99))}
      ${tile('Datos recibidos', formatBytes(summary.totalBytes))}
    </div>
    ${timeline.length > 0 ? charts(timeline) : null}
    <h2>Respuestas</h2>
    <div class="charts">
      ${tallyTable('Códigos de estado', 'Código', summary.statusCodes)}
      ${tallyTable('Errores', 'Tipo', summary.errorTypes)}
    </div>
  `;
}

export function renderReportPage(run) {
  const { config } = run;
  return layout({
    title: run.name,
    strategy: 'SSG: se generó una vez y se sirve como archivo estático.',
    content: html`
      <h1>${run.name}</h1>
      <p class="muted">${config.method} ${config.url}</p>
      <p class="muted">
        <span class="badge is-${run.status}">${STATUS_LABELS[run.status]}</span> ·
        ${config.vus} VUs · ${config.durationSeconds} s · ${PATTERN_LABELS[config.pattern.type]} ·
        ${formatDate(run.startedAt)}
      </p>
      ${run.error ? html`<p class="card">Error: ${run.error}</p>` : null}
      ${results(run)}
    `,
  });
}
