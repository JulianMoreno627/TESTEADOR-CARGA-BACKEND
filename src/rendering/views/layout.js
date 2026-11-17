import { html, trusted } from '../html.js';

const DARK_TOKENS = `
  color-scheme: dark;
  --surface-0: #111110;
  --surface-1: #1a1a19;
  --text-primary: #f0efec;
  --text-secondary: #c3c2b7;
  --border: #3a3a37;
  --grid: #2c2c2a;
  --series-1: #3987e5;
  --series-2: #d95926;
  --series-3: #199e70;
  --good: #4cc38a;
  --bad: #f07575;
`;

const styles = `
  :root {
    color-scheme: light;
    --surface-0: #f4f4f1;
    --surface-1: #fcfcfb;
    --text-primary: #0b0b0b;
    --text-secondary: #52514e;
    --border: #dcdbd5;
    --grid: #e8e7e2;
    --series-1: #2a78d6;
    --series-2: #eb6834;
    --series-3: #1baf7a;
    --good: #0b7a4b;
    --bad: #c62f2f;
  }
  @media (prefers-color-scheme: dark) { :root { ${DARK_TOKENS} } }

  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--surface-0);
    color: var(--text-primary);
    font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  a { color: var(--series-1); }
  header.top { border-bottom: 1px solid var(--border); background: var(--surface-1); }
  header.top nav { max-width: 1100px; margin: auto; padding: 14px 16px; display: flex; flex-wrap: wrap; gap: 8px 20px; align-items: baseline; }
  header.top strong { margin-right: auto; }
  main { max-width: 1100px; margin: auto; padding: 24px 16px 48px; }
  h1 { font-size: 26px; line-height: 1.2; margin: 0 0 6px; overflow-wrap: anywhere; }
  h2 { font-size: 17px; margin: 32px 0 12px; }
  .muted { color: var(--text-secondary); overflow-wrap: anywhere; }
  .card { background: var(--surface-1); border: 1px solid var(--border); border-radius: 10px; padding: 16px; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-top: 20px; }
  .tile-label { color: var(--text-secondary); font-size: 13px; }
  .tile-value { font-size: 24px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 440px), 1fr)); gap: 12px; }
  .chart-title { font-weight: 600; margin: 0 0 8px; }
  .chart svg { display: block; width: 100%; height: auto; }
  .chart text { fill: var(--text-secondary); font-size: 11px; }
  .chart .grid { stroke: var(--grid); stroke-width: 1; }
  .chart .series { fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .chart .crosshair { stroke: var(--text-secondary); stroke-width: 1; opacity: 0; }
  .chart .hit { fill: transparent; }
  .chart .column:hover .crosshair { opacity: 1; }
  .legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 0 0 8px; padding: 0; list-style: none; font-size: 13px; color: var(--text-secondary); }
  .legend i { display: inline-block; width: 14px; height: 3px; border-radius: 2px; margin-right: 6px; vertical-align: middle; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); white-space: nowrap; }
  th { font-size: 13px; font-weight: 600; color: var(--text-secondary); }
  td.num, th.num { text-align: right; }
  tr:last-child td { border-bottom: 0; }
  .badge { font-size: 13px; }
  .badge::before { margin-right: 5px; }
  .is-completed::before, .is-improved::before { content: "✓"; color: var(--good); }
  .is-failed::before, .is-regressed::before { content: "✕"; color: var(--bad); }
  .is-stopped::before, .is-unchanged::before, .is-mixed::before, .is-unknown::before { content: "–"; }
  .is-running::before { content: "●"; color: var(--series-1); }
  details { margin-top: 12px; }
  summary { cursor: pointer; }
  form.compare { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; }
  form.compare label { display: grid; gap: 4px; font-size: 13px; color: var(--text-secondary); flex: 1 1 260px; min-width: 0; }
  select { width: 100%; padding: 8px; font: inherit; color: inherit; background: var(--surface-1); border: 1px solid var(--border); border-radius: 6px; }
  button { padding: 9px 16px; font: inherit; color: #fff; background: #1f65b8; border: 0; border-radius: 6px; cursor: pointer; }
  footer { max-width: 1100px; margin: auto; padding: 0 16px 32px; font-size: 13px; color: var(--text-secondary); }
`;

export function layout({ title, content, strategy }) {
  return html`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} · Testeador de Carga</title>
  <style>${trusted(styles)}</style>
</head>
<body>
  <header class="top">
    <nav>
      <strong>Testeador de Carga Visual</strong>
      <a href="/views/history">Historial</a>
      <a href="/views/compare">Comparar</a>
    </nav>
  </header>
  <main>${content}</main>
  <footer>Patrón de renderizado de esta página: ${strategy}</footer>
</body>
</html>`.toString();
}
