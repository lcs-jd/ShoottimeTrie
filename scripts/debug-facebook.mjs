#!/usr/bin/env node
/**
 * Script de diagnostic complet pour l'API Facebook Graph v25.0
 * Teste les permissions, le token, la Page, et la capacité à publier.
 *
 * Usage : node scripts/debug-facebook.mjs
 *         FB_TOKEN=xxx FB_PAGE_ID=yyy node scripts/debug-facebook.mjs
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

// ── Chargement de l'env ──────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv(envPath) {
  try {
    const raw = readFileSync(envPath, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {}
}

loadEnv(path.join(__dirname, '..', '.env'));

const TOKEN   = process.env.FB_TOKEN   || process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
const PAGE_ID = process.env.FB_PAGE_ID || process.env.FACEBOOK_PAGE_ID;
const API_VER = process.env.FB_API_VER || 'v25.0';
const BASE    = `https://graph.facebook.com/${API_VER}`;

// ── Utilitaires ──────────────────────────────────────────────────────────────
const OK  = '\x1b[32m✓\x1b[0m';
const ERR = '\x1b[31m✗\x1b[0m';
const WRN = '\x1b[33m⚠\x1b[0m';
const INF = '\x1b[36mℹ\x1b[0m';

function sep(title) {
  const bar = '─'.repeat(60);
  console.log(`\n${bar}`);
  console.log(`  ${title}`);
  console.log(bar);
}

async function fbGet(endpoint, params = {}) {
  const url = new URL(`${BASE}/${endpoint}`);
  url.searchParams.set('access_token', TOKEN);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

async function fbPost(endpoint, body) {
  const url = new URL(`${BASE}/${endpoint}`);
  url.searchParams.set('access_token', TOKEN);
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

function checkPerm(scopes, perm) {
  const found = scopes.find(s => s.permission === perm);
  if (!found) return `${ERR} ${perm} : absent`;
  if (found.status === 'granted') return `${OK} ${perm} : accordé`;
  return `${WRN} ${perm} : ${found.status}`;
}

// ── Tests ────────────────────────────────────────────────────────────────────

async function test1_config() {
  sep('TEST 1 — Configuration de base');
  if (!TOKEN)   console.log(`${ERR} FACEBOOK_PAGE_ACCESS_TOKEN non défini`);
  else          console.log(`${OK} Token présent (${TOKEN.slice(0, 20)}…)`);

  if (!PAGE_ID) console.log(`${ERR} FACEBOOK_PAGE_ID non défini`);
  else          console.log(`${OK} Page ID : ${PAGE_ID}`);

  console.log(`${INF} Version API cible : ${API_VER}`);
  return !!(TOKEN && PAGE_ID);
}

async function test2_token_inspect() {
  sep('TEST 2 — Inspection du token (debug_token)');
  // On appelle /debug_token avec l'app token ou le même token (user token self-inspect)
  const { ok, data } = await fbGet('debug_token', {
    input_token: TOKEN,
    // Si tu veux inspecter via app token, décommente et fournis APP_ID|APP_SECRET
    // access_token: `${APP_ID}|${APP_SECRET}`,
  });

  if (!ok || data.error) {
    console.log(`${WRN} Impossible d'inspecter le token via debug_token (normal sans app secret)`);
    console.log(`    Erreur : ${data.error?.message || JSON.stringify(data)}`);
    return;
  }

  const t = data.data || data;
  console.log(`${OK} Type de token : ${t.type}`);
  console.log(`${INF} App ID        : ${t.app_id}`);
  console.log(`${INF} User ID       : ${t.user_id || 'N/A'}`);
  console.log(`${INF} Valide        : ${t.is_valid}`);

  if (t.expires_at) {
    const exp = new Date(t.expires_at * 1000);
    const expired = exp < new Date();
    console.log(`${expired ? ERR : OK} Expire le : ${exp.toLocaleString('fr-FR')}${expired ? ' — EXPIRÉ !' : ''}`);
  } else {
    console.log(`${OK} Token sans expiration (long-lived ou Page token permanent)`);
  }

  if (t.scopes?.length) {
    console.log(`${INF} Scopes inclus : ${t.scopes.join(', ')}`);
  }
}

async function test3_token_perms() {
  sep('TEST 3 — Permissions accordées au token');
  // En v25.0, /me/permissions ne fonctionne qu'avec un token utilisateur.
  // Avec un token de Page, les scopes sont déjà listés dans debug_token (test 2).
  const REQUIRED_PERMS = [
    'pages_manage_posts',
    'pages_read_engagement',
    'pages_show_list',
  ];
  const OPTIONAL_PERMS = [
    'pages_manage_metadata',
    'pages_read_user_content',
    'business_management',
  ];

  // Tentative via /me/permissions (fonctionne uniquement avec user token)
  const { ok, data } = await fbGet('me/permissions');
  if (!ok || data.error) {
    console.log(`${WRN} /me/permissions non disponible avec un token de Page (c'est normal en v25.0).`);
    console.log(`${INF} Les scopes sont visibles dans le TEST 2 ci-dessus (debug_token).`);
    return;
  }

  const scopes = data.data || [];
  console.log(`\nPermissions obligatoires pour publier des photos :`);
  for (const p of REQUIRED_PERMS)  console.log('  ' + checkPerm(scopes, p));
  console.log(`\nPermissions optionnelles utiles :`);
  for (const p of OPTIONAL_PERMS)  console.log('  ' + checkPerm(scopes, p));

  const all = scopes.map(s => `${s.permission}(${s.status})`);
  console.log(`\n${INF} Toutes les permissions : ${all.join(', ')}`);
}

async function test4_me() {
  sep('TEST 4 — Identité du token (/me)');
  // "tasks" supprimé en v25.0 — on ne demande que id,name,category
  const { ok, data } = await fbGet('me', { fields: 'id,name,category' });
  if (!ok || data.error) {
    console.log(`${ERR} /me échoue : ${data.error?.message || JSON.stringify(data)}`);
    return false;
  }
  console.log(`${OK} ID   : ${data.id}`);
  console.log(`${OK} Nom  : ${data.name}`);
  if (data.category) console.log(`${INF} Catégorie : ${data.category}`);
  return true;
}

async function test5_page_info() {
  sep('TEST 5 — Infos de la Page cible');
  // "tasks" retiré en v25.0
  const { ok, data } = await fbGet(PAGE_ID, {
    fields: 'id,name,category,fan_count,published_posts.limit(1)',
  });
  if (!ok || data.error) {
    console.log(`${ERR} Impossible d'accéder à la Page ${PAGE_ID}`);
    console.log(`    ${data.error?.message}`);
    console.log(`    Code : ${data.error?.code}  Sous-code : ${data.error?.error_subcode}`);
    console.log(`\n${INF} Causes fréquentes :`);
    console.log(`    • Token utilisateur au lieu du token de Page`);
    console.log(`    • PAGE_ID incorrect`);
    console.log(`    • Rôle insuffisant sur la Page`);
    return false;
  }
  console.log(`${OK} Page trouvée : ${data.name} (${data.id})`);
  if (data.category)   console.log(`${INF} Catégorie : ${data.category}`);
  if (data.fan_count != null) console.log(`${INF} Fans : ${data.fan_count}`);
  return true;
}

async function test6_list_pages() {
  sep("TEST 6 — Pages accessibles via ce token (/me/accounts)");
  // "tasks" retiré en v25.0
  const { ok, data } = await fbGet('me/accounts', { fields: 'id,name,access_token' });
  if (!ok || data.error) {
    console.log(`${ERR} /me/accounts échoue : ${data.error?.message || JSON.stringify(data)}`);
    console.log(`    ${WRN} Si token de Page, ce endpoint ne fonctionne pas — c'est normal.`);
    return;
  }

  const pages = data.data || [];
  if (!pages.length) {
    console.log(`${WRN} Aucune Page retournée. L'utilisateur n'administre peut-être aucune Page.`);
    return;
  }

  for (const p of pages) {
    const isTarget = p.id === PAGE_ID;
    const prefix = isTarget ? `${OK} [CIBLE] ` : `${INF}        `;
    console.log(`${prefix}${p.name} (${p.id})`);
    if (isTarget && p.access_token) {
      console.log(`         ${OK} Token de Page récupéré via /me/accounts :`);
      console.log(`         ${p.access_token.slice(0, 30)}…`);
      console.log(`\n${WRN}  ACTION : Utilise CE token (Page token) dans .env, pas le token utilisateur.`);
    }
  }

  if (!pages.find(p => p.id === PAGE_ID)) {
    console.log(`\n${ERR} La Page ${PAGE_ID} n'apparaît PAS dans /me/accounts.`);
    console.log(`    → L'utilisateur n'a pas de rôle admin/éditeur sur cette Page.`);
  }
}

async function test7_albums() {
  sep(`TEST 7 — Albums existants sur la Page (/${PAGE_ID}/albums)`);
  const { ok, data } = await fbGet(`${PAGE_ID}/albums`, { fields: 'id,name,count', limit: 5 });
  if (!ok || data.error) {
    console.log(`${ERR} Impossible de lister les albums`);
    console.log(`    Code : ${data.error?.code} — ${data.error?.message}`);
    return false;
  }
  const albums = data.data || [];
  console.log(`${OK} ${albums.length} album(s) trouvé(s) :`);
  for (const a of albums) console.log(`    • ${a.name} (id: ${a.id}, photos: ${a.count ?? '?'})`);
  return true;
}

async function test8_create_album() {
  sep('TEST 8 — Création d\'un album (POST /{page}/albums)');
  const name = `Debug Test ${new Date().toISOString().slice(0, 16)}`;
  const { ok, data } = await fbPost(`${PAGE_ID}/albums`, { name });

  if (!ok || data.error) {
    const e = data.error;
    console.log(`${ERR} Création d'album refusée`);
    console.log(`    Code        : ${e?.code}`);
    console.log(`    Sous-code   : ${e?.error_subcode ?? 'N/A'}`);
    console.log(`    Type        : ${e?.type}`);
    console.log(`    Message     : ${e?.message}`);
    console.log(`    fbtrace_id  : ${e?.fbtrace_id ?? 'N/A'}`);
    diagnoseError(e);
    return null;
  }

  console.log(`${OK} Album créé ! ID : ${data.id}`);
  console.log(`${WRN} Supprime-le manuellement sur Facebook si nécessaire.`);
  return data.id;
}

async function test9_photo_url(albumId) {
  if (!albumId) return;
  sep('TEST 9 — Photo dans album via URL (POST /{album}/photos)');
  const TEST_URL = 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png';

  const { ok, data } = await fbPost(`${albumId}/photos`, {
    url: TEST_URL,
    caption: 'Photo de test debug — peut être supprimée',
    published: true,
  });

  if (!ok || data.error) {
    console.log(`${ERR} Upload photo (URL) refusé`);
    console.log(`    Code     : ${data.error?.code}`);
    console.log(`    Message  : ${data.error?.message}`);
    diagnoseError(data.error);
  } else {
    console.log(`${OK} Photo publiée ! ID : ${data.id}`);
  }
}

async function test10_photo_direct_on_page() {
  sep('TEST 10 — Photo directe sur la Page sans album (POST /{page}/photos)');
  // Contourne la création d'album — teste si le problème est spécifique aux albums
  const TEST_URL = 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png';

  const { ok, data } = await fbPost(`${PAGE_ID}/photos`, {
    url: TEST_URL,
    caption: 'Test debug direct — peut être supprimée',
    published: false, // non publié pour éviter le spam
  });

  if (!ok || data.error) {
    const e = data.error;
    console.log(`${ERR} Photo directe refusée`);
    console.log(`    Code       : ${e?.code}`);
    console.log(`    Sous-code  : ${e?.error_subcode ?? 'N/A'}`);
    console.log(`    Type       : ${e?.type}`);
    console.log(`    Message    : ${e?.message}`);
    console.log(`    fbtrace_id : ${e?.fbtrace_id ?? 'N/A'}`);
    diagnoseError(e);
  } else {
    console.log(`${OK} Photo publiée directement ! ID : ${data.id}`);
    console.log(`${INF} Conclusion : le problème est spécifique à la création d'album, pas aux photos.`);
  }
}

async function test11_feed_post() {
  sep('TEST 11 — Post texte simple sur la Page (POST /{page}/feed)');
  // Test encore plus basique — si même ça échoue, problème de capacité app profond
  const { ok, data } = await fbPost(`${PAGE_ID}/feed`, {
    message: 'Test debug Shoottimetri — ce post peut être supprimé',
    published: false,
  });

  if (!ok || data.error) {
    const e = data.error;
    console.log(`${ERR} Post texte refusé`);
    console.log(`    Code       : ${e?.code}`);
    console.log(`    Sous-code  : ${e?.error_subcode ?? 'N/A'}`);
    console.log(`    Type       : ${e?.type}`);
    console.log(`    Message    : ${e?.message}`);
    console.log(`    fbtrace_id : ${e?.fbtrace_id ?? 'N/A'}`);
    if (e?.code === 3) {
      console.log(`\n${WRN} Code 3 sur /feed aussi → problème de capacité app, PAS de permission token.`);
      console.log(`    Pistes spécifiques au code 3 :`);
      console.log(`    • L'App n'a pas ajouté le produit "Pages API" dans App Dashboard → Add Product`);
      console.log(`    • Le scope "pages_manage_posts" est listé mais n'a pas été soumis/approuvé`);
      console.log(`      (pour une app live, ce scope nécessite une App Review Meta si audience > testeurs)`);
      console.log(`    • La Page est peut-être une "New Page Experience" — certains endpoints albums`);
      console.log(`      ne fonctionnent qu'avec "Classic Pages"`);
      console.log(`    • Essaie de révoquer et recréer l'App entièrement avec le bon Business type`);
    }
  } else {
    console.log(`${OK} Post texte créé ! ID : ${data.id}`);
    console.log(`${INF} Le token peut poster sur la Page — le problème est spécifique aux albums/photos.`);
  }
}

async function test12_app_subscriptions() {
  sep('TEST 12 — Webhooks / subscriptions de l\'app (indicatif)');
  // Teste si on peut lire les subscriptions — indique les produits activés sur l'app
  const APP_ID = process.env.FB_APP_ID;
  const APP_SECRET = process.env.FB_APP_SECRET;

  if (!APP_ID || !APP_SECRET) {
    console.log(`${WRN} FB_APP_ID / FB_APP_SECRET non définis dans .env — test ignoré.`);
    console.log(`    Ajoute FB_APP_ID=xxx et FB_APP_SECRET=yyy pour inspecter les capacités de l'app.`);
    return;
  }

  const url = new URL(`${BASE}/${APP_ID}`);
  url.searchParams.set('access_token', `${APP_ID}|${APP_SECRET}`);
  url.searchParams.set('fields', 'id,name,category,permissions,features');
  const res = await fetch(url.toString());
  const data = await res.json();

  if (!res.ok || data.error) {
    console.log(`${ERR} Impossible de lire l'app : ${data.error?.message}`);
    return;
  }
  console.log(`${OK} App : ${data.name} (${data.id})`);
  if (data.category)    console.log(`${INF} Catégorie : ${data.category}`);
  if (data.features)    console.log(`${INF} Features  : ${JSON.stringify(data.features)}`);
  if (data.permissions) console.log(`${INF} Perms app : ${JSON.stringify(data.permissions)}`);
}

// ── Décodage des erreurs Graph API ───────────────────────────────────────────
function diagnoseError(error) {
  if (!error) return;
  const code = error.code;
  const subcode = error.error_subcode;
  const msg = error.message || '';

  const hints = [];

  if (code === 200 || code === 10) {
    hints.push('Permission refusée — le token ne possède pas le scope requis (pages_manage_posts).');
    hints.push('→ Recrée le token dans l\'Explorateur d\'API en cochant pages_manage_posts.');
  }
  if (code === 100) {
    hints.push('Paramètre invalide ou ressource introuvable (code 100).');
    if (subcode === 33) hints.push('→ Page ID incorrecte ou Page supprimée/non publiée.');
  }
  if (code === 190) {
    hints.push('Token invalide ou expiré (code 190).');
    if (subcode === 460 || subcode === 467) hints.push('→ Token expiré. Recrée un token long-lived.');
    if (subcode === 463) hints.push('→ Session expirée.');
  }
  if (code === 368) {
    hints.push('Compte temporairement bloqué pour spam/abus. Attends 24h.');
  }
  if (code === 4 || code === 17 || code === 341) {
    hints.push('Rate limit atteint. Attends quelques minutes.');
  }
  if (msg.includes('publish') || msg.includes('permission')) {
    hints.push('→ Vérifie que la Page est publiée (pas en mode non-publié/draft).');
    hints.push('→ Vérifie que ton app Facebook n\'est pas en mode développement avec des testeurs restreints.');
  }
  if (msg.includes('restricted') || msg.includes('not allowed')) {
    hints.push('→ L\'app Facebook est peut-être soumise à une révision Meta requise pour ce scope.');
  }

  if (hints.length) {
    console.log(`\n${INF} Diagnostics :`);
    for (const h of hints) console.log(`    ${h}`);
  } else {
    console.log(`\n${INF} Code inconnu. Consulte : https://developers.facebook.com/docs/graph-api/guides/error-handling/`);
  }
}

// ── Vérification de la version API dans l'appli ──────────────────────────────
async function test0_app_version_check() {
  sep('TEST 0 — Vérification version API dans le code applicatif');
  try {
    const workerPath = path.join(__dirname, '..', 'backend', 'src', 'workers', 'facebook.js');
    const routesPath = path.join(__dirname, '..', 'backend', 'src', 'routes', 'photos.js');
    const worker = readFileSync(workerPath, 'utf8');
    const routes = readFileSync(routesPath, 'utf8');

    const workerMatch = worker.match(/graph\.facebook\.com\/(v[\d.]+)/);
    const routesMatch = routes.match(/graph\.facebook\.com\/(v[\d.]+)/);

    const workerVer = workerMatch?.[1] ?? 'non trouvé';
    const routesVer = routesMatch?.[1] ?? 'non trouvé';

    console.log(`${INF} Version dans facebook.js  : ${workerVer}`);
    console.log(`${INF} Version dans photos.js     : ${routesVer}`);
    console.log(`${INF} Version cible de ce script : ${API_VER}`);

    if (workerVer !== API_VER) console.log(`${WRN} Décalage ! facebook.js utilise ${workerVer} au lieu de ${API_VER}`);
    else console.log(`${OK} facebook.js est à jour.`);
    if (routesVer !== API_VER) console.log(`${WRN} Décalage ! photos.js utilise ${routesVer} au lieu de ${API_VER}`);
    else console.log(`${OK} photos.js est à jour.`);
  } catch (e) {
    console.log(`${WRN} Impossible de lire les fichiers source : ${e.message}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n\x1b[1m====  DIAGNOSTIC FACEBOOK API v25.0  ====\x1b[0m');
  console.log(`Date : ${new Date().toLocaleString('fr-FR')}`);

  await test0_app_version_check();

  const configured = await test1_config();
  if (!configured) {
    console.log(`\n${ERR} Configuration incomplète — arrêt du diagnostic.\n`);
    process.exit(1);
  }

  await test2_token_inspect();
  await test3_token_perms();
  await test4_me();
  const pageOk = await test5_page_info();
  await test6_list_pages();

  if (pageOk) {
    await test7_albums();
    const albumId = await test8_create_album();
    await test9_photo_url(albumId);
    await test10_photo_direct_on_page();
    await test11_feed_post();
  }
  await test12_app_subscriptions();

  sep('RÉSUMÉ');
  console.log(`Token expire le : ${new Date(Date.now()).toLocaleString('fr-FR')} (vérifie TEST 2)`);
  console.log(`\nPour corriger un problème de permission :`);
  console.log(`  1. Va sur https://developers.facebook.com/tools/explorer/`);
  console.log(`  2. Sélectionne ton App → ta Page`);
  console.log(`  3. Coche : pages_manage_posts, pages_read_engagement, pages_show_list`);
  console.log(`  4. Génère un Page Access Token (long-lived avec /oauth/access_token)`);
  console.log(`  5. Copie-le dans .env → FACEBOOK_PAGE_ACCESS_TOKEN`);
  console.log(`\nPour le code 3 spécifiquement :`);
  console.log(`  • App Dashboard → Cas d'utilisation → "Gérer le contenu de la Page"`);
  console.log(`    → vérifie que pages_manage_posts est en statut "Approuvé" (pas juste "Ajouté")`);
  console.log(`  • Si la Page est une "New Page Experience", certains endpoints albums sont bloqués`);
  console.log(`  • Ajoute FB_APP_ID et FB_APP_SECRET dans .env pour le test 12 (diagnostic app)\n`);
}

main().catch(err => {
  console.error('\nErreur fatale :', err.message);
  process.exit(1);
});
