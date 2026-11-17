#!/usr/bin/env sh
# Revisa los commits que aún no están en GitHub antes de subirlos.
# Uso: sh scripts/check-secrets.sh
# Falla si encuentra un archivo .env o algo con forma de clave real.

range="${1:-@{upstream}..HEAD}"
status=0

env_files=$(git diff --name-only "$range" | grep -E '(^|/)\.env($|\.)' | grep -v '\.env\.example$')
if [ -n "$env_files" ]; then
  echo "Archivos .env a punto de subirse:"
  echo "$env_files"
  status=1
fi

# Claves de Google (AIza…), Groq (gsk_…) y cadenas de conexión con contraseña hacia Neon.
if git diff "$range" | grep -E '^\+' | grep -nE 'AIza[0-9A-Za-z_-]{30,}|gsk_[0-9A-Za-z]{20,}|postgres(ql)?://[^:@/ ]+:[^@ ]+@[^ ]*neon\.tech'; then
  echo "Hay algo con forma de clave real en los cambios."
  status=1
fi

[ "$status" -eq 0 ] && echo "Sin secretos en $range."
exit "$status"
