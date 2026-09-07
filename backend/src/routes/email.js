import path from 'path';
import fs from 'fs';
import nodemailer from 'nodemailer';
import db from '../db.js';
import { watermarkToBuffer } from '../utils/watermark.js';
import {
  ZIMBRA_HOST, zimbraAuth, fetchContacts, searchGal, dedupeContacts,
  getZimbraCredentials, encryptSecret,
} from '../utils/zimbra.js';

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');

// Limite de taille des pièces jointes (Zimbra rejette souvent au-delà de ~25 Mo).
const MAX_ATTACH_BYTES = parseInt(process.env.EMAIL_MAX_ATTACH_MB || '20', 10) * 1024 * 1024;

// Cache court du token SOAP : évite de se réauthentifier à chaque frappe d'autocomplétion.
let tokenCache = null; // { user, token, expiresAt }

async function getAuthToken() {
  const creds = getZimbraCredentials();
  if (!creds) throw new Error("Compte Zimbra non configuré. Renseigne-le dans les réglages.");

  if (tokenCache && tokenCache.user === creds.user && tokenCache.expiresAt > Date.now()) {
    return tokenCache.token;
  }
  const token = await zimbraAuth(creds.user, creds.password);
  tokenCache = { user: creds.user, token, expiresAt: Date.now() + 30 * 60 * 1000 };
  return token;
}

function buildTransport(creds) {
  return nodemailer.createTransport({
    host: ZIMBRA_HOST,
    port: 587,
    secure: false,       // STARTTLS négocié ensuite
    requireTLS: true,
    auth: { user: creds.user, pass: creds.password },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
  });
}

// Prépare la pièce jointe selon la version demandée, sans modifier le statut de la photo.
async function buildAttachment(photo, version) {
  const baseName = photo.filename.replace(/\.[^.]+$/, '');

  if (version === 'original') {
    const abs = path.join(DATA_DIR, photo.original_path);
    if (!fs.existsSync(abs)) throw new Error(`Fichier original introuvable pour ${photo.filename}`);
    return { filename: photo.filename, path: abs, size: fs.statSync(abs).size };
  }

  // version === 'watermarked'
  if (photo.watermarked_path) {
    const abs = path.join(DATA_DIR, photo.watermarked_path);
    if (fs.existsSync(abs)) {
      return { filename: `${baseName}.jpg`, path: abs, size: fs.statSync(abs).size };
    }
  }

  // Pas encore filigranée : on la filigrane à la volée, en mémoire.
  // Volontairement sans écriture disque ni changement de statut : l'app
  // continue de la considérer comme non filigranée.
  const abs = path.join(DATA_DIR, photo.original_path);
  if (!fs.existsSync(abs)) throw new Error(`Fichier original introuvable pour ${photo.filename}`);
  const content = await watermarkToBuffer(abs);
  return { filename: `${baseName}.jpg`, content, size: content.length };
}

export default async function emailRoutes(fastify) {
  // ── Configuration du compte Zimbra ──────────────────────────────────────
  fastify.get('/api/email/config', async () => {
    const creds = getZimbraCredentials();
    return { host: ZIMBRA_HOST, configured: Boolean(creds), user: creds?.user || null };
  });

  fastify.post('/api/email/config', async (req, reply) => {
    const { user, password } = req.body || {};
    if (!user || !password) return reply.code(400).send({ error: 'Identifiant et mot de passe requis.' });

    // On valide les identifiants avant de les stocker.
    try {
      await zimbraAuth(user, password);
    } catch (err) {
      return reply.code(401).send({ error: `Connexion Zimbra échouée : ${err.message}` });
    }

    const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    db.transaction(() => {
      stmt.run('zimbra_user', String(user));
      stmt.run('zimbra_password', encryptSecret(password));
    })();

    tokenCache = null;
    return { ok: true, user };
  });

  fastify.delete('/api/email/config', async () => {
    db.prepare("DELETE FROM settings WHERE key IN ('zimbra_user','zimbra_password')").run();
    tokenCache = null;
    return { ok: true };
  });

  // ── Destinataires ───────────────────────────────────────────────────────
  // Carnet d'adresses personnel + annuaire global (GAL) si une recherche est fournie.
  fastify.get('/api/email/contacts', async (req, reply) => {
    const q = (req.query.q || '').trim();
    try {
      const token = await getAuthToken();
      const results = await fetchContacts(token);

      if (q.length >= 2) {
        try {
          results.push(...await searchGal(token, q));
        } catch {
          // GAL indisponible ou non autorisé : on garde le carnet personnel
        }
      }

      const all = dedupeContacts(results);
      const filtered = q
        ? all.filter(c => c.name.toLowerCase().includes(q.toLowerCase()) || c.email.includes(q.toLowerCase()))
        : all;

      return filtered.slice(0, 100);
    } catch (err) {
      return reply.code(502).send({ error: err.message });
    }
  });

  // ── Envoi ───────────────────────────────────────────────────────────────
  fastify.post('/api/email/send', async (req, reply) => {
    const { to, photoIds, version = 'watermarked', subject, message } = req.body || {};

    const recipients = (Array.isArray(to) ? to : [to])
      .map(s => String(s || '').trim())
      .filter(s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));

    if (recipients.length === 0)  return reply.code(400).send({ error: 'Aucun destinataire valide.' });
    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      return reply.code(400).send({ error: 'Aucune photo sélectionnée.' });
    }
    if (!['watermarked', 'original', 'both'].includes(version)) {
      return reply.code(400).send({ error: 'Version invalide.' });
    }

    const creds = getZimbraCredentials();
    if (!creds) return reply.code(400).send({ error: "Compte Zimbra non configuré." });

    const placeholders = photoIds.map(() => '?').join(',');
    const photos = db.prepare(`SELECT * FROM photos WHERE id IN (${placeholders})`).all(...photoIds);
    if (photos.length === 0) return reply.code(404).send({ error: 'Photos introuvables.' });

    const versions = version === 'both' ? ['watermarked', 'original'] : [version];
    const attachments = [];
    let totalBytes = 0;

    try {
      for (const photo of photos) {
        for (const v of versions) {
          const att = await buildAttachment(photo, v);
          totalBytes += att.size;
          if (totalBytes > MAX_ATTACH_BYTES) {
            return reply.code(413).send({
              error: `Pièces jointes trop volumineuses (${Math.round(totalBytes / 1048576)} Mo, max ${Math.round(MAX_ATTACH_BYTES / 1048576)} Mo). Envoie moins de photos ou choisis la version filigranée.`,
            });
          }
          // En mode 'both', on distingue les deux fichiers d'une même photo
          const finalName = version === 'both' && v === 'original'
            ? att.filename.replace(/(\.[^.]+)$/, '_original$1')
            : att.filename;
          attachments.push({ filename: finalName, path: att.path, content: att.content });
        }
      }
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }

    const count = photos.length;
    const finalSubject = subject?.trim() || `Vos photos (${count})`;
    const finalText    = message?.trim() || `Bonjour,\n\nVeuillez trouver ci-joint ${count > 1 ? `vos ${count} photos` : 'votre photo'}.\n\nBonne réception.`;

    try {
      const transport = buildTransport(creds);
      const info = await transport.sendMail({
        from: creds.user.includes('@') ? creds.user : `${creds.user}@${ZIMBRA_HOST}`,
        to: recipients.join(', '),
        subject: finalSubject,
        text: finalText,
        attachments,
      });
      transport.close();

      return {
        ok: true,
        sent: recipients.length,
        photos: count,
        attachments: attachments.length,
        sizeMb: Math.round(totalBytes / 1048576 * 10) / 10,
        messageId: info.messageId,
      };
    } catch (err) {
      return reply.code(502).send({ error: `Envoi échoué : ${err.message}` });
    }
  });
}
