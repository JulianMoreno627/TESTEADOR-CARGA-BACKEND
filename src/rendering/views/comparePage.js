import { formatDate, formatNumber } from '../format.js';
import { html } from '../html.js';
import { layout } from './layout.js';

const VERDICT_LABELS = {
  improved: 'Mejoró',
  regressed: 'Empeoró',
  unchanged: 'Sin cambio relevante',
  mixed: 'Resultado mixto',
  unknown: 'Sin datos',
};

const runSelect = (name, label, runs, selected) => html`
  <label>${label}
    <select name="${name}" required>
      <option value="">Elige una prueba</option>
      ${runs.map((run) => html`
        <option value="${run.id}" ${run.id === selected ? html`selected` : null}>${run.name} (${formatDate(run.createdAt)})</option>
      `)}
    </select>
  </label>
`;

function comparisonResult(comparison) {
  return html`
    <h2>Veredicto: <span class="badge is-${comparison.verdict}">${VERDICT_LABELS[comparison.verdict]}</span></h2>
    <div class="card table-wrap">
      <table>
        <thead><tr>
          <th>Métrica</th><th class="num">Base</th><th class="num">Nueva</th>
          <th class="num">Cambio</th><th>Resultado</th>
        </tr></thead>
        <tbody>${comparison.metrics.map((metric) => html`
          <tr>
            <td>${metric.label}</td>
            <td class="num">${formatNumber(metric.baseline)}</td>
            <td class="num">${formatNumber(metric.candidate)}</td>
            <td class="num">${metric.changePercent === null ? '—' : `${formatNumber(metric.changePercent)} %`}</td>
            <td><span class="badge is-${metric.verdict}">${VERDICT_LABELS[metric.verdict]}</span></td>
          </tr>
        `)}</tbody>
      </table>
    </div>
    <p class="muted">Un cambio menor al ${comparison.noiseThresholdPercent} % se considera variación normal entre corridas.</p>
  `;
}

export function renderComparePage({ runs, baselineId, candidateId, comparison, errorMessage }) {
  return layout({
    title: 'Comparar pruebas',
    strategy: 'SSR: se genera en el servidor en cada petición.',
    content: html`
      <h1>Comparar pruebas</h1>
      <p class="muted">Comprueba si una optimización realmente mejoró el rendimiento.</p>
      <form class="compare card" method="get" action="/views/compare">
        ${runSelect('baseline', 'Prueba base', runs, baselineId)}
        ${runSelect('candidate', 'Prueba nueva', runs, candidateId)}
        <button type="submit">Comparar</button>
      </form>
      ${errorMessage ? html`<p class="card">${errorMessage}</p>` : null}
      ${comparison ? comparisonResult(comparison) : null}
    `,
  });
}
