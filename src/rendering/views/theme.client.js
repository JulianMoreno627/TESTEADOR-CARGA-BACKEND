// Tema de las vistas HTML del backend: claro por defecto y oscuro solo si el usuario
// lo elige. Se carga en <head> para aplicar el tema antes de pintar la página.
// Es un archivo aparte (no un <script> en línea) para cumplir la Content-Security-Policy.
(() => {
  const KEY = 'theme';
  const root = document.documentElement;

  const read = () => {
    try {
      return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  };

  const apply = (theme) => {
    if (theme === 'dark') root.dataset.theme = 'dark';
    else delete root.dataset.theme;
  };

  apply(read());

  document.addEventListener('DOMContentLoaded', () => {
    const button = document.querySelector('[data-theme-toggle]');
    if (!button) return;

    const label = () => {
      const dark = root.dataset.theme === 'dark';
      button.textContent = dark ? 'Modo claro' : 'Modo oscuro';
      button.setAttribute('aria-pressed', String(dark));
    };

    button.hidden = false;
    label();
    button.addEventListener('click', () => {
      const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
      apply(next);
      try {
        localStorage.setItem(KEY, next);
      } catch {
        // Sin almacenamiento, el cambio dura solo esta visita.
      }
      label();
    });
  });
})();
