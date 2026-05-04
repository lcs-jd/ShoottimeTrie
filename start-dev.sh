#!/bin/bash
set -e

# Lancer Redis via Docker si pas déjà actif
if ! docker exec shoottime-redis redis-cli ping &>/dev/null 2>&1; then
  echo "Démarrage Redis (Docker)..."
  docker run -d --name shoottime-redis --rm -p 6379:6379 redis:7-alpine \
    || docker start shoottime-redis 2>/dev/null || true
  sleep 1
fi

# Installer les dépendances si besoin
[ ! -d backend/node_modules ] && (cd backend && npm install)
[ ! -d frontend/node_modules ] && (cd frontend && npm install)

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Créer les répertoires data
mkdir -p "$ROOT_DIR/backend/data"/{originals,proxies,watermarked}

# Charger les variables d'environnement depuis .env si présent
if [ -f "$ROOT_DIR/.env" ]; then
  set -a; source "$ROOT_DIR/.env"; set +a
fi

# Lancer backend et frontend en parallèle
echo "Démarrage backend (port 3000)..."
(cd "$ROOT_DIR/backend" && \
  DATA_DIR="$ROOT_DIR/backend/data" \
  REDIS_URL=${REDIS_URL:-redis://localhost:6379} \
  ADMIN_PASSWORD=${ADMIN_PASSWORD:-changeme} \
  JWT_SECRET=${JWT_SECRET:-changeme-jwt-secret-32chars-min!!} \
  node src/server.js) &

echo "Démarrage frontend (port 5173)..."
(cd frontend && npm run dev) &

wait
