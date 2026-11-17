import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import {
  formatBytes,
  formatDate,
  formatMs,
  formatNumber,
  formatPercent,
  niceAxisMax,
  PATTERN_LABELS,
  STATUS_LABELS,
} from '../format.js';

const PAGE = { width: 595, height: 842, margin: 48 };
const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;

const hex = (value) => rgb(
  parseInt(value.slice(1, 3), 16) / 255,
  parseInt(value.slice(3, 5), 16) / 255,
  parseInt(value.slice(5, 7), 16) / 255,
);

const COLORS = {
  text: hex('#0b0b0b'),
  muted: hex('#52514e'),
  grid: hex('#e8e7e2'),
  series: [hex('#2a78d6'), hex('#eb6834'), hex('#1baf7a')],
};

/** Las fuentes estándar de PDF solo admiten Latin-1 y pocos signos más; otro carácter lanzaría un error. */
const toPdfText = (value) => String(value)
  .replace(/[  ]/g, ' ')
  .replace(/[^\x20-\x7E\xA0-\xFF—]/g, '?');

function truncate(value, max) {
  const text = toPdfText(value);
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

/** Lleva la posición vertical y crea páginas nuevas cuando se necesita. */
class PdfWriter {
  constructor(document, fonts) {
    this.document = document;
    this.fonts = fonts;
    this.#addPage();
  }

  #addPage() {
    this.page = this.document.addPage([PAGE.width, PAGE.height]);
    this.y = PAGE.height - PAGE.margin;
  }

  ensureSpace(height) {
    if (this.y - height < PAGE.margin) this.#addPage();
  }

  text(value, { size = 10, bold = false, color = COLORS.text, x = PAGE.margin } = {}) {
    this.ensureSpace(size + 6);
    this.page.drawText(toPdfText(value), {
      x,
      y: this.y - size,
      size,
      color,
      font: bold ? this.fonts.bold : this.fonts.regular,
    });
    this.y -= size + 6;
  }

  heading(value) {
    this.y -= 12;
    this.ensureSpace(60);
    this.text(value, { size: 13, bold: true });
    this.y -= 2;
  }

  table(headers, rows) {
    const columnWidth = CONTENT_WIDTH / headers.length;
    const drawRow = (cells, options) => {
      this.ensureSpace(18);
      cells.forEach((cell, index) => {
        this.page.drawText(truncate(cell, 44), {
          x: PAGE.margin + index * columnWidth,
          y: this.y - 10,
          size: 10,
          ...options,
        });
      });
      this.y -= 16;
    };

    drawRow(headers, { font: this.fonts.bold, color: COLORS.muted });
    rows.forEach((row) => drawRow(row, { font: this.fonts.regular, color: COLORS.text }));
  }

  lineChart({ title, points, series }) {
    const height = 120;
    const legendHeight = series.length > 1 ? 14 : 0;
    const axisWidth = 42;
    this.ensureSpace(height + legendHeight + 44);
    this.text(title, { size: 11, bold: true });

    if (series.length > 1) {
      let legendX = PAGE.margin;
      series.forEach(({ label }, index) => {
        this.page.drawLine({
          start: { x: legendX, y: this.y - 5 },
          end: { x: legendX + 14, y: this.y - 5 },
          thickness: 2,
          color: COLORS.series[index],
        });
        this.page.drawText(toPdfText(label), {
          x: legendX + 18, y: this.y - 8, size: 9, font: this.fonts.regular, color: COLORS.muted,
        });
        legendX += 56;
      });
      this.y -= legendHeight;
    }

    const left = PAGE.margin + axisWidth;
    const right = PAGE.margin + CONTENT_WIDTH;
    const top = this.y - 4;
    const bottom = top - height;
    const peak = Math.max(0, ...points.flatMap((point) => series.map(({ read }) => read(point) ?? 0)));
    const yMax = niceAxisMax(peak);
    const tMax = Math.max(1, ...points.map((point) => point.t));
    const scaleX = (t) => left + (t / tMax) * (right - left);
    const scaleY = (value) => bottom + (value / yMax) * height;
    const small = { size: 8, font: this.fonts.regular, color: COLORS.muted };

    for (let tick = 0; tick <= 4; tick += 1) {
      const value = (yMax / 4) * tick;
      this.page.drawLine({
        start: { x: left, y: scaleY(value) },
        end: { x: right, y: scaleY(value) },
        thickness: 0.5,
        color: COLORS.grid,
      });
      this.page.drawText(formatNumber(value), { x: PAGE.margin, y: scaleY(value) - 3, ...small });
    }
    this.page.drawText('0 s', { x: left, y: bottom - 11, ...small });
    this.page.drawText(`${Math.round(tMax)} s`, { x: right - 20, y: bottom - 11, ...small });

    series.forEach(({ read }, index) => {
      let previous = null;
      for (const point of points) {
        const value = read(point);
        if (value === null || value === undefined) {
          previous = null;
        } else {
          const current = { x: scaleX(point.t), y: scaleY(value) };
          if (previous) {
            this.page.drawLine({ start: previous, end: current, thickness: 1.5, color: COLORS.series[index] });
          }
          previous = current;
        }
      }
    });

    this.y = bottom - 22;
  }
}

function writeResults(writer, summary, timeline) {
  const { latency } = summary;

  writer.heading('Resumen');
  writer.table(['Métrica', 'Valor'], [
    ['Duración', `${formatNumber(summary.durationSeconds)} s`],
    ['Peticiones totales', formatNumber(summary.totalRequests)],
    ['Peticiones fallidas', formatNumber(summary.failedRequests)],
    ['Tasa de errores', formatPercent(summary.errorRate)],
    ['Throughput medio', `${formatNumber(summary.avgRps)} req/s`],
    ['Throughput máximo', `${formatNumber(summary.peakRps)} req/s`],
    ['Máximo de usuarios virtuales', formatNumber(summary.peakVus)],
    ['Datos recibidos', formatBytes(summary.totalBytes)],
  ]);

  writer.heading('Latencia');
  writer.table(
    ['Mín', 'Media', 'p50', 'p90', 'p95', 'p99', 'Máx'],
    [[latency.min, latency.mean, latency.p50, latency.p90, latency.p95, latency.p99, latency.max].map(formatMs)],
  );

  if (timeline.length > 0) {
    writer.heading('Evolución durante la prueba');
    writer.lineChart({
      title: 'Latencia (ms)',
      points: timeline,
      series: [
        { label: 'p50', read: (point) => point.latency.p50 },
        { label: 'p95', read: (point) => point.latency.p95 },
        { label: 'p99', read: (point) => point.latency.p99 },
      ],
    });
    writer.lineChart({
      title: 'Throughput (req/s)',
      points: timeline,
      series: [{ label: 'Throughput', read: (point) => point.rps }],
    });
    writer.lineChart({
      title: 'Tasa de errores (%)',
      points: timeline,
      series: [{ label: 'Errores', read: (point) => point.errorRate * 100 }],
    });
  }

  writer.heading('Códigos de estado');
  const statusRows = Object.entries(summary.statusCodes).map(([code, count]) => [code, formatNumber(count)]);
  writer.table(['Código', 'Peticiones'], statusRows.length > 0 ? statusRows : [['—', '0']]);

  const errorRows = Object.entries(summary.errorTypes).map(([type, count]) => [type, formatNumber(count)]);
  if (errorRows.length > 0) {
    writer.heading('Errores');
    writer.table(['Tipo', 'Peticiones'], errorRows);
  }
}

/** @returns {Promise<Uint8Array>} el PDF del reporte. */
export async function renderReportPdf(run) {
  const document = await PDFDocument.create();
  document.setTitle(toPdfText(`Reporte de carga: ${run.name}`));
  document.setCreator('Testeador de Carga Visual');

  const writer = new PdfWriter(document, {
    regular: await document.embedFont(StandardFonts.Helvetica),
    bold: await document.embedFont(StandardFonts.HelveticaBold),
  });
  const { config } = run;

  writer.text(truncate(run.name, 60), { size: 20, bold: true });
  writer.text(truncate(`${config.method} ${config.url}`, 90), { color: COLORS.muted });
  writer.text(
    `${STATUS_LABELS[run.status]} | ${config.vus} VUs | ${config.durationSeconds} s | ${PATTERN_LABELS[config.pattern.type]} | ${formatDate(run.startedAt)}`,
    { color: COLORS.muted },
  );
  if (run.error) writer.text(truncate(`Error: ${run.error}`, 90));

  if (run.summary) writeResults(writer, run.summary, run.timeline);
  else writer.text('Esta prueba se interrumpió y no tiene resultados.');

  return document.save();
}
