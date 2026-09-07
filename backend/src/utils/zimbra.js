import crypto from 'crypto';
import db from '../db.js';

const ZIMBRA_HOST = process.env.ZIMBRA_HOST || 'partage.cpe.fr';
const SOAP_URL    = `https://${ZIMBRA_HOST}/service/soap`;

// Le mot de passe Zimbra doit être rejouable (SOAP + SMTP) : on le chiffre au
// repos avec JWT_SECRET plutôt que de le hacher.
const KEY = crypto.createHash('sha256').update(process.env.JWT_SECRET || 'changeme-jwt-secret-32chars-min!!').digest();

export function encryptSecret(plain) {
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc    = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(stored) {
  const [iv, tag, data] = String(stored).split(':');
  if (!iv || !tag || !data) throw new Error('secret illisible');
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

export function getZimbraCredentials() {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key IN ('zimbra_user','zimbra_password')").all();
  const map  = Object.fromEntries(rows.map(r => [r.key, r.value]));
  if (!map.zimbra_user || !map.zimbra_password) return null;
  try {
    return { user: map.zimbra_user, password: decryptSecret(map.zimbra_password) };
  } catch {
    return null;
  }
}

const escapeXml = (s) => String(s).replace(/[<>&'"]/g, c => (
  { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]
));

async function soapCall(bodyXml, authToken) {
  const header = authToken
    ? `<soap:Header><context xmlns="urn:zimbra"><authToken>${escapeXml(authToken)}</authToken></context></soap:Header>`
    : '';

  const res = await fetch(SOAP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' },
    body: `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">${header}<soap:Body>${bodyXml}</soap:Body></soap:Envelope>`,
    signal: AbortSignal.timeout(20000),
  });

  const text = await res.text();
  if (!res.ok) {
    const reason = text.match(/<soap:Text>([^<]*)<\/soap:Text>/)?.[1] || `HTTP ${res.status}`;
    throw new Error(reason);
  }
  return text;
}

export async function zimbraAuth(user, password) {
  const xml = await soapCall(
    `<AuthRequest xmlns="urn:zimbraAccount"><account by="name">${escapeXml(user)}</account><password>${escapeXml(password)}</password></AuthRequest>`
  );
  const token = xml.match(/<authToken>([^<]*)<\/authToken>/)?.[1];
  if (!token) throw new Error('authentification Zimbra refusée');
  return token;
}

// Extrait les attributs <a n="...">valeur</a> d'un bloc <cn>
function parseAttrs(block) {
  const attrs = {};
  for (const m of block.matchAll(/<a n="([^"]+)">([^<]*)<\/a>/g)) {
    attrs[m[1]] = m[2]
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }
  return attrs;
}

function toContact(attrs) {
  const email = attrs.email || attrs.email2 || attrs.email3 || attrs.workEmail1;
  if (!email || !email.includes('@')) return null;
  const name = [attrs.firstName, attrs.lastName].filter(Boolean).join(' ')
    || attrs.fullName || attrs.displayName || attrs.nickname || email;
  return { name, email: email.toLowerCase() };
}

// Carnet d'adresses personnel
export async function fetchContacts(authToken) {
  const xml = await soapCall(`<GetContactsRequest xmlns="urn:zimbraMail"/>`, authToken);
  const out = [];
  for (const m of xml.matchAll(/<cn\b[^>]*>([\s\S]*?)<\/cn>/g)) {
    const c = toContact(parseAttrs(m[1]));
    if (c) out.push(c);
  }
  return out;
}

// Annuaire global (GAL) — recherche serveur, nécessite au moins 2 caractères
export async function searchGal(authToken, query) {
  const xml = await soapCall(
    `<SearchGalRequest xmlns="urn:zimbraAccount" type="account" limit="50"><name>${escapeXml(query)}</name></SearchGalRequest>`,
    authToken
  );
  const out = [];
  for (const m of xml.matchAll(/<cn\b[^>]*>([\s\S]*?)<\/cn>/g)) {
    const c = toContact(parseAttrs(m[1]));
    if (c) out.push(c);
  }
  return out;
}

export function dedupeContacts(list) {
  const seen = new Map();
  for (const c of list) {
    if (!seen.has(c.email)) seen.set(c.email, c);
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export { ZIMBRA_HOST };
