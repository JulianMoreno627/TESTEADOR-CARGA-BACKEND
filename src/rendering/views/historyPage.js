import { formatDate, formatMs, formatNumber, formatPercent, PATTERN_LABELS, STATUS_LABELS } from '../format.js';
import { html } from '../html.js';
import { layout } from './layout.js';

const row = (run) => html`
  <tr>
    <td><a href="/views/reports/${run.id}">${run.name}</a></td>
    <td><span class="badge is-${run.status}">${STATUS_LABELS[run.status]}</span></td>
    <td>${PATTERN_LABELS[run.config.pattern.type]}</td>
    <td class="num">${run.config.vus}</td>
    <td class="num">${formatNumber(run.summary?.totalRequests)}</td>
    <td class="num">${formatNumber(run.summary?.avgRps)}</td>
    <td class="num">${formatMs(run.summary?.latency.p95)}</td>
    <td class="num">${formatPercent(run.summary?.errorRate)}</td>
    <td>${formatDate(run.createdAt)}</td>
  </tr>
`;

export function renderHistoryPage({ items, total }) {
  return layout({
    title: 'Historial',
    strategy: 'ISR: versión en caché que se renueva en segundo plano.',
    content: html`
      <h1>Historial de pruebas</h1>
      <p class="muted">${total} ${total === 1 ? 'prueba registrada' : 'pruebas registradas'}</p>
      ${items.length === 0
        ? html`<p class="card">Aún no hay pruebas.</p>`
        : html`
          <div class="card table-wrap">
            <table>
              <thead><tr>
                <th>Nombre</th><th>Estado</th><th>Patrón</th><th class="num">VUs</th>
                <th class="num">Peticiones</th><th class="num">req/s</th><th class="num">p95</th>
                <th class="num">Errores</th><th>Fecha</th>
              </tr></thead>
              <tbody>${items.map(row)}</tbody>
            </table>
          </div>
        `}
    `,
  });
}
