#!/usr/bin/env node
/**
 * Générateur de token Facebook long-lived (60 jours) et token de Page permanent.
 *
 * Prérequis dans .env :
 *   FACEBOOK_PAGE_ACCESS_TOKEN  — token court obtenu depuis l'Explorateur d'API
 *   FB_APP_ID                   — App ID (Paramètres de l'app > Général)
 *   FB_APP_SECRET               — App Secret (Paramètres de l'app > Général)
 *   FACEBOOK_PAGE_ID            — ID de la Page cible
 *
 * Usage :
 *   node scripts/generate-fb-token.mjs
 *
 * Le script écrit automatiquement le nouveau token dans .env.
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import readline from 'readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH  = path.join(__dirname, '..', '.env');
const API       = 'https://graph.facebook.com/v25.0';

// ── Couleurs ─────────────────────────────────────────────────────────────────
const OK  = '\x1b[32m✓\x1b[0m';
const ERR = '\x1b[31m✗\x1b[0m';
const INF = '\x1b[36mℹ\x1b[0m';
const WRN = '\x1b[33m⚠\x1b[0m';
const BLD = (s) => `\x1b[1m${s}\x1b[0m`;

function sep(t) { console.log(`\n${'─'.repeat(60)}\n  ${t}\n${'─'.repeat(60)}`); }

// ── Chargement .env ───────────────────────────────────────────────────────────
function loadEnv() {
  const raw = readFileSync(ENV_PATH, 'utf8');
  const map = {};
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.indexOf('=');
    if (idx === -1) continue;
    map[t.slice(0, idx).trim()] = t.slice(idx + 1).trim();
  }
  return map;
}

function updateEnv(key, value) {
  let raw = readFileSync(ENV_PATH, 'utf8');
  const regex = new RegExp(`^(${key}=).*$`, 'm');
  if (regex.test(raw)) {
    raw = raw.replace(regex, `$1${value}`);
  } else {
    raw = raw.trimEnd() + `\n${key}=${value}\n`;
  }
  writeFileSync(ENV_PATH, raw, 'utf8');
}

// ── Prompt interactif ─────────────────────────────────────────────────────────
function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

// ── Appels API ────────────────────────────────────────────────────────────────
async function get(url) {
  const res = await fetch(url);
  return res.json();
}

// ── Étape 1 : échange token court → long-lived (60 jours) ────────────────────
async function exchangeLongLived(shortToken, appId, appSecret) {
  sep('ÉTAPE 1 — Échange token court → long-lived (60 jours)');
  const url = `${API}/oauth/access_token`
    + `?grant_type=fb_exchange_token`
    + `&client_id=${appId}`
    + `&client_secret=${appSecret}`
    + `&fb_exchange_token=${encodeURIComponent(shortToken)}`;

  const data = await get(url);

  if (data.error) {
    console.log(`${ERR} Échec : ${data.error.message}`);
    if (data.error.code === 190) {
      console.log(`    ${WRN} Le token court est déjà expiré. Génère-en un nouveau depuis :`);
      console.log(`    https://developers.facebook.com/tools/explorer/`);
    }
    return null;
  }

  const expiresIn = data.expires_in;
  const expDate   = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;
  console.log(`${OK} Token long-lived obtenu !`);
  console.log(`${INF} Expire dans : ${expiresIn ? `${Math.round(expiresIn / 86400)} jours (${expDate.toLocaleDateString('fr-FR')})` : 'N/A'}`);
  console.log(`${INF} Token : ${data.access_token.slice(0, 40)}…`);
  return data.access_token;
}

// ── Étape 2 : token de Page permanent depuis le long-lived ───────────────────
async function getPageToken(longLivedToken, pageId) {
  sep('ÉTAPE 2 — Récupération du token de Page permanent');

  // D'abord vérifier via /me/accounts (fonctionne avec token utilisateur long-lived)
  const accountsUrl = `${API}/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(longLivedToken)}`;
  const accounts    = await get(accountsUrl);

  if (accounts.error) {
    console.log(`${WRN} /me/accounts inaccessible : ${accounts.error.message}`);
    console.log(`    ${INF} Tentative directe sur /${pageId}?fields=access_token…`);

    // Fallback : token de Page directement (si longLivedToken est déjà un token de Page)
    const pageUrl  = `${API}/${pageId}?fields=id,name,access_token&access_token=${encodeURIComponent(longLivedToken)}`;
    const pageData = await get(pageUrl);

    if (pageData.error || !pageData.access_token) {
      console.log(`${ERR} Impossible de récupérer le token de Page : ${pageData.error?.message || 'accès refusé'}`);
      console.log(`\n${INF} Cause probable : le token fourni est un token de Page, pas un token utilisateur.`);
      console.log(`    Un token de Page long-lived ne peut pas être obtenu depuis un autre token de Page.`);
      console.log(`    → Génère un ${BLD('token utilisateur')} dans l'Explorateur d'API (pas un token de Page).`);
      return null;
    }

    console.log(`${OK} Token de Page récupéré via fallback.`);
    console.log(`${INF} Page : ${pageData.name} (${pageData.id})`);
    console.log(`${INF} Ce token de Page ${BLD("n'expire pas")}.`);
    return pageData.access_token;
  }

  const pages = accounts.data || [];
  const page  = pages.find(p => p.id === pageId);

  if (!page) {
    console.log(`${ERR} La Page ${pageId} n'apparaît pas dans /me/accounts.`);
    console.log(`    Pages disponibles :`);
    for (const p of pages) console.log(`    • ${p.name} (${p.id})`);
    return null;
  }

  console.log(`${OK} Token de Page récupéré pour : ${page.name} (${page.id})`);
  console.log(`${INF} Ce token de Page ${BLD("n'expire pas")}.`);
  return page.access_token;
}

// ── Étape 3 : vérification du token final ────────────────────────────────────
async function verifyToken(token, appId, appSecret) {
  sep('ÉTAPE 3 — Vérification du token final');

  const url  = `${API}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${appId}|${appSecret}`;
  const data = await get(url);

  if (data.error || !data.data?.is_valid) {
    console.log(`${ERR} Token invalide : ${data.error?.message || 'is_valid=false'}`);
    return false;
  }

  const t = data.data;
  console.log(`${OK} Token valide`);
  console.log(`${INF} Type      : ${t.type}`);
  console.log(`${INF} App ID    : ${t.app_id}`);
  console.log(`${INF} Scopes    : ${(t.scopes || []).join(', ')}`);
  if (t.expires_at && t.expires_at !== 0) {
    const exp = new Date(t.expires_at * 1000);
    console.log(`${INF} Expire le : ${exp.toLocaleDateString('fr-FR')}`);
  } else {
    console.log(`${OK} Aucune expiration (token permanent)`);
  }
  return true;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${BLD('====  GÉNÉRATEUR TOKEN FACEBOOK LONG-LIVED  ====')}`);
  console.log(`API version : v25.0\n`);

  const env = loadEnv();

  // Récupération des credentials
  let appId     = env.FB_APP_ID;
  let appSecret = env.FB_APP_SECRET;
  let shortToken = env.FACEBOOK_PAGE_ACCESS_TOKEN;
  const pageId  = env.FACEBOOK_PAGE_ID;

  if (!pageId) {
    console.log(`${ERR} FACEBOOK_PAGE_ID manquant dans .env`);
    process.exit(1);
  }

  if (!appId) {
    console.log(`${WRN} FB_APP_ID absent du .env.`);
    console.log(`    Trouve-le sur : https://developers.facebook.com → ton App → Paramètres > Général`);
    appId = await ask('  → Entre ton App ID : ');
    if (!appId) { console.log(`${ERR} Annulé.`); process.exit(1); }
    updateEnv('FB_APP_ID', appId);
    console.log(`${OK} FB_APP_ID sauvegardé dans .env`);
  } else {
    console.log(`${OK} FB_APP_ID trouvé : ${appId}`);
  }

  if (!appSecret) {
    console.log(`${WRN} FB_APP_SECRET absent du .env.`);
    console.log(`    Trouve-le sur : https://developers.facebook.com → ton App → Paramètres > Général`);
    appSecret = await ask('  → Entre ton App Secret : ');
    if (!appSecret) { console.log(`${ERR} Annulé.`); process.exit(1); }
    updateEnv('FB_APP_SECRET', appSecret);
    console.log(`${OK} FB_APP_SECRET sauvegardé dans .env`);
  } else {
    console.log(`${OK} FB_APP_SECRET trouvé : ${appSecret.slice(0, 6)}…`);
  }

  if (!shortToken) {
    console.log(`\n${WRN} FACEBOOK_PAGE_ACCESS_TOKEN absent du .env.`);
    console.log(`    Génère un token UTILISATEUR (pas de Page) depuis :`);
    console.log(`    https://developers.facebook.com/tools/explorer/`);
    console.log(`    Scopes requis : pages_manage_posts, pages_read_engagement, pages_show_list`);
    shortToken = await ask('  → Colle le token ici : ');
    if (!shortToken) { console.log(`${ERR} Annulé.`); process.exit(1); }
  } else {
    console.log(`${OK} Token court trouvé dans .env`);
  }

  // Étape 1 : long-lived
  const longLived = await exchangeLongLived(shortToken, appId, appSecret);
  if (!longLived) process.exit(1);

  // Étape 2 : token de Page permanent
  const pageToken = await getPageToken(longLived, pageId);

  // Choisir le meilleur token disponible
  const finalToken = pageToken || longLived;
  const tokenType  = pageToken ? 'Page permanent' : 'utilisateur long-lived (60 jours)';

  // Étape 3 : vérification
  await verifyToken(finalToken, appId, appSecret);

  // Écriture dans .env
  sep('ÉTAPE 4 — Mise à jour du .env');
  updateEnv('FACEBOOK_PAGE_ACCESS_TOKEN', finalToken);
  console.log(`${OK} FACEBOOK_PAGE_ACCESS_TOKEN mis à jour (token ${tokenType})`);

  if (!pageToken) {
    console.log(`\n${WRN} Token utilisateur long-lived enregistré (expire dans ~60 jours).`);
    console.log(`    Pour un token permanent, il faut un token ${BLD('utilisateur')} dans l'Explorateur d'API.`);
    console.log(`    Assure-toi de ne pas sélectionner "Page Access Token" dans l'Explorateur.`);
  }

  sep('RÉSUMÉ');
  console.log(`${OK} Token type      : ${tokenType}`);
  console.log(`${OK} Page ID         : ${pageId}`);
  console.log(`${INF} Lance le diagnostic pour confirmer :`);
  console.log(`    node scripts/debug-facebook.mjs\n`);
}

main().catch(err => {
  console.error(`\n${ERR} Erreur fatale :`, err.message);
  process.exit(1);
});
