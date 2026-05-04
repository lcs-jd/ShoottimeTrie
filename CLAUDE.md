# Spécifications Architecturales : Application de Tri et Publication de Photos (Batch Processing)

## 1. Objectif du Système
Développer une application web permettant à un administrateur d'uploader des lots massifs de photos haute définition (ex: 500 photos Canon, ~25 Go), à des utilisateurs de les trier collaborativement en temps réel, puis d'appliquer un filigrane de manière asynchrone avant publication automatisée sur un album Facebook.

## 2. Infrastructure Cible (Proxmox)
*   **Environnement :** Machine Virtuelle (Debian/Ubuntu) sur Proxmox. (PAS de conteneur LXC natif pour éviter les conflits réseau/stockage Docker).
*   **Ressources allouées :** 2 vCPU, 2 à 4 Go RAM, ~50 Go Stockage.
*   **Déploiement :** Monolithe asynchrone via `docker-compose` (approche KISS, pas de cluster Kubernetes).

## 3. Stack Technique
*   **Frontend :** Framework au choix (React, Vue, ou Vanilla JS) avec grille Masonry (pas de swipe lourd).
*   **Backend :** Node.js (Express ou Fastify).
*   **Base de données :** SQLite (fichier local).
*   **Traitement d'images :** Librairie `sharp` (basée sur libvips, stricte interdiction d'utiliser ImageMagick pour des raisons de consommation RAM).
*   **File d'attente (Message Broker) :** Redis + `BullMQ` (pour gestion des tâches de fond).

## 4. Flux de Données et Contraintes Critiques

### A. Phase d'Ingestion (Upload de 25 Go)
*   **Frontend :** Utilisation de Uppy.js ou Dropzone. Limiter la concurrence d'upload à 3-5 fichiers simultanés maximum. Reprise sur erreur obligatoire.
*   **Backend (Règle absolue) :** Utilisation de **Streams** (via `Busboy` ou `Multer` en `diskStorage`). Interdiction stricte de bufferiser les fichiers en RAM. Les octets entrants du réseau doivent être écrits directement sur le disque.
*   **Reverse Proxy :** Configurer Nginx/Traefik pour autoriser les gros fichiers (`client_max_body_size` ajusté à ~100 Mo max par photo, pas 25 Go) et augmenter les timeouts.

### B. Phase de Tri (Miniatures et Concurrence)
*   **Génération Asynchrone :** Dès l'écriture sur disque d'un original, le backend pousse un job Redis. Un Worker génère un proxy léger (WebP, < 200 Ko) via `sharp`. Le frontend de tri n'utilise **que** ces proxies.
*   **Collaboration Temps Réel :** Utilisation des **Server-Sent Events (SSE)**. Les WebSockets sont overkill. Lorsqu'un utilisateur trie une photo, une requête HTTP POST classique met à jour la base, et le serveur broadcast l'événement via SSE pour masquer la photo chez les autres utilisateurs instantanément.
*   **Concurrence BDD :** SQLite doit impérativement être initialisé avec le mode **WAL (Write-Ahead Logging)** activé (`PRAGMA journal_mode=WAL;`) pour éviter l'erreur `SQLITE_BUSY` lors des requêtes simultanées.

### C. Phase de Traitement et Publication (Workers)
*   **Filigranage :** Une fois le tri validé, création de jobs Redis par photo conservée. Le Worker Node.js charge l'original, applique le calque via `sharp`, et enregistre la version finale.
*   **Publication Facebook :** 
    *   Cible : Publication sur une **Page** ou un **Groupe** (l'API Graph ne permet plus l'automatisation sur les profils personnels).
    *   Contrainte : Le Worker doit implémenter un mécanisme de *Rate Limiting* (pauses entre les requêtes API) pour éviter le blocage par les systèmes anti-spam de Meta.

## 5. Déploiement (Structure du docker-compose cible)
3 conteneurs suffisent :
1.  **app** : Serveur Node.js (exposant les ports web, contenant le code API + Workers embarqués). Montages volumes : DB SQLite et Dossier Photos.
2.  **redis** : Conteneur Redis standard (alpine), consommant ~20 Mo RAM.
3.  **reverse-proxy** (Optionnel mais recommandé) : Nginx ou Caddy pour gérer le TLS (HTTPS).

## Code Exploration Policy

Always use jCodemunch-MCP tools for code navigation. Never fall back to Read, Grep, Glob, or Bash for code exploration.
**Exception:** Use `Read` when you need to edit a file — the agent harness requires a `Read` before `Edit`/`Write` will succeed. Use jCodemunch tools to *find and understand* code, then `Read` only the specific file you're about to modify.

**Start any session:**
1. `resolve_repo { "path": "." }` — confirm the project is indexed. If not: `index_folder { "path": "." }`
2. `suggest_queries` — when the repo is unfamiliar

**Finding code:**
- symbol by name → `search_symbols` (add `kind=`, `language=`, `file_pattern=`, `decorator=` to narrow)
- decorator-aware queries → `search_symbols(decorator="X")` to find symbols with a specific decorator (e.g. `@property`, `@route`); combine with set-difference to find symbols *lacking* a decorator (e.g. "which endpoints lack CSRF protection?")
- string, comment, config value → `search_text` (supports regex, `context_lines`)
- database columns (dbt/SQLMesh) → `search_columns`

**Reading code:**
- before opening any file → `get_file_outline` first
- one or more symbols → `get_symbol_source` (single ID → flat object; array → batch)
- symbol + its imports → `get_context_bundle`
- specific line range only → `get_file_content` (last resort)

**Repo structure:**
- `get_repo_outline` → dirs, languages, symbol counts
- `get_file_tree` → file layout, filter with `path_prefix`

**Relationships & impact:**
- what imports this file → `find_importers`
- where is this name used → `find_references`
- is this identifier used anywhere → `check_references`
- file dependency graph → `get_dependency_graph`
- what breaks if I change X → `get_blast_radius`
- what symbols actually changed since last commit → `get_changed_symbols`
- find unreachable/dead code → `find_dead_code`
- class hierarchy → `get_class_hierarchy`

## Session-Aware Routing

**Opening move for any task:**
1. `plan_turn { "repo": "...", "query": "your task description", "model": "claude-sonnet-4-6" }` — get confidence + recommended files; the `model` parameter narrows the exposed tool list to match your capabilities at zero extra requests.
2. Obey the confidence level:
   - `high` → go directly to recommended symbols, max 2 supplementary reads
   - `medium` → explore recommended files, max 5 supplementary reads
   - `low` → the feature likely doesn't exist. Report the gap to the user. Do NOT search further hoping to find it.

**Interpreting search results:**
- If `search_symbols` returns `negative_evidence` with `verdict: "no_implementation_found"`:
  - Do NOT re-search with different terms hoping to find it
  - Do NOT assume a related file (e.g. auth middleware) implements the missing feature (e.g. CSRF)
  - DO report: "No existing implementation found for X. This would need to be created."
  - DO check `related_existing` files — they show what's nearby, not what exists
- If `verdict: "low_confidence_matches"`: examine the matches critically before assuming they implement the feature

**After editing files:**
- If PostToolUse hooks are installed (Claude Code only), edited files are auto-reindexed
- Otherwise, call `register_edit` with edited file paths to invalidate caches and keep the index fresh
- For bulk edits (5+ files), always use `register_edit` with all paths to batch-invalidate

**Token efficiency:**
- If `_meta` contains `budget_warning`: stop exploring and work with what you have
- If `auto_compacted: true` appears: results were automatically compressed due to turn budget
- Use `get_session_context` to check what you've already read — avoid re-reading the same files

## Model-Driven Tool Tiering

Your jcodemunch-mcp server narrows the exposed tool list based on the model you are running as. To avoid wasting requests on primitives when a composite would do, always include `model="claude-sonnet-4-6"` in your opening `plan_turn` call.

Replace `<your-model-id>` with your active model:
- Claude Opus variants → `claude-opus-4-7` (or any `claude-opus-*`)
- Claude Sonnet variants → `claude-sonnet-4-6`
- Claude Haiku variants → `claude-haiku-4-5`
- GPT-4o / GPT-5 / o1 / Llama → use the model id as printed by your runner

The `model=` parameter rides on the existing `plan_turn` call — it does **not** add a separate tool invocation. If `plan_turn` is not appropriate for a non-code task, call `announce_model(model="...")` once instead.
