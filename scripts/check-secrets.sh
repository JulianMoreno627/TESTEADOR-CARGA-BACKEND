#!/usr/bin/env sh
# Revisa los commits que aún no están en GitHub antes de subirlos.
# Uso: sh scripts/check-secrets.sh [rango]   (por defecto, lo que falta por subir)
# Falla si encuentra un archivo .env, algo con forma de clave real, o si git falla.

range="$1"
if [ -z "$range" ]; then
  range='@{upstream}..HEAD'
fi

# Si git no puede leer el rango, la revisión no se hizo: eso es un fallo, no un "todo bien".
changes=$(git diff "$range") || { echo "No se pudo leer el rango $range."; exit 2; }
files=$(git diff --name-only "$range") || exit 2
status=0

env_files=$(printf '%s\n' "$files" | grep -E '(^|/)\.env($|\.)' | grep -v '\.env\.example$')
if [ -n "$env_files" ]; then
  echo "Archivos .env a punto de subirse:"
  echo "$env_files"
  status=1
fi

# Claves de Google (AIza…), Groq (gsk_…) y cadenas de conexión con contraseña hacia Neon.
if printf '%s\n' "$changes" | grep -E '^\+' | grep -nE 'AIza[0-9A-Za-z_-]{30,}|gsk_[0-9A-Za-z]{20,}|postgres(ql)?://[^:@/ ]+:[^@ ]+@[^ ]*neon\.tech'; then
  echo "Hay algo con forma de clave real en los cambios."
  status=1
fi

if [ "$status" -eq 0 ]; then
  echo "Sin secretos en $range ($(printf '%s\n' "$files" | grep -c .) archivos revisados)."
fi
exit "$status"
