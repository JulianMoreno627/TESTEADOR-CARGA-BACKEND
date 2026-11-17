class SafeHtml {
  constructor(value) {
    this.value = value;
  }

  toString() {
    return this.value;
  }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Marca como seguro un texto escrito por el desarrollador, nunca datos del usuario. */
export const trusted = (value) => new SafeHtml(value);

export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]);

function renderValue(value) {
  if (value === null || value === undefined || value === false) return '';
  if (Array.isArray(value)) return value.map(renderValue).join('');
  if (value instanceof SafeHtml) return value.value;
  return escapeHtml(value);
}

/**
 * Plantilla con escape automático: todo valor interpolado se escapa salvo que ya
 * sea HTML seguro. Así un nombre de prueba malicioso no puede inyectar scripts (XSS).
 */
export function html(strings, ...values) {
  let output = strings[0];
  values.forEach((value, index) => {
    output += renderValue(value) + strings[index + 1];
  });
  return new SafeHtml(output);
}
