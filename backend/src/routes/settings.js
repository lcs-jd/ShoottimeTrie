import db from '../db.js';
import path from 'path';
import fs from 'fs';
import { pipeline } from 'stream/promises';
import sharp from 'sharp';

const ALLOWED_KEYS = [
  'facebook_page_url',
  'watermark_position',
  'watermark_size',
  'watermark_opacity',
  'watermark_margin',
];

const WATERMARK_POSITIONS = [
  'northwest', 'north', 'northeast',
  'west',      'center', 'east',
  'southwest', 'south', 'southeast',
];

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
const WATERMARK_DIR = path.join(DATA_DIR, '..', 'watermark');
const LOGO_PATH = path.resolve(process.env.WATERMARK_LOGO_PATH || path.join(WATERMARK_DIR, 'logo.png'));
const PREVIEW_PHOTO_PATH = path.join(WATERMARK_DIR, 'preview_photo');

fs.mkdirSync(WATERMARK_DIR, { recursive: true });

function getWatermarkSettings() {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key IN ('watermark_position','watermark_size','watermark_opacity','watermark_margin')").all();
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return {
    position: map.watermark_position || 'southeast',
    size: parseFloat(map.watermark_size || '15'),
    opacity: parseFloat(map.watermark_opacity || '100'),
    margin: parseFloat(map.watermark_margin || '2'),
  };
}

export default async function settingsRoutes(fastify) {
  fastify.get('/api/settings', async () => {
    // On ne renvoie que les clés publiques : la table `settings` contient aussi
    // le mot de passe Zimbra chiffré, qui ne doit jamais transiter par l'API.
    const placeholders = ALLOWED_KEYS.map(() => '?').join(',');
    const rows = db.prepare(`SELECT key, value FROM settings WHERE key IN (${placeholders})`).all(...ALLOWED_KEYS);
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  });

  // Bornes des réglages numériques : évite qu'une valeur absurde fasse exploser
  // la mémoire de sharp lors du redimensionnement du logo.
  const NUMERIC_BOUNDS = {
    watermark_size:    { min: 1, max: 100 },
    watermark_opacity: { min: 0, max: 100 },
    watermark_margin:  { min: 0, max: 50  },
  };

  fastify.post('/api/settings', async (req, reply) => {
    const body = req.body || {};
    const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

    for (const [key, value] of Object.entries(body)) {
      if (!ALLOWED_KEYS.includes(key)) continue;
      if (typeof value !== 'string') continue;
      const v = value.trim();

      if (key === 'watermark_position' && !WATERMARK_POSITIONS.includes(v)) {
        return reply.code(400).send({ error: 'Position de filigrane invalide.' });
      }
      const bounds = NUMERIC_BOUNDS[key];
      if (bounds) {
        const n = parseFloat(v);
        if (!Number.isFinite(n) || n < bounds.min || n > bounds.max) {
          return reply.code(400).send({ error: `Valeur invalide pour ${key} (attendu entre ${bounds.min} et ${bounds.max}).` });
        }
      }
      if (key === 'facebook_page_url' && v && !/^https:\/\/(www\.)?facebook\.com\//i.test(v)) {
        return reply.code(400).send({ error: 'URL Facebook invalide.' });
      }
      if (v.length > 500) return reply.code(400).send({ error: 'Valeur trop longue.' });

      upsert.run(key, v);
    }
    return { ok: true };
  });

  // GET /api/watermark — retourne le logo actuel
  fastify.get('/api/watermark', async (req, reply) => {
    if (!fs.existsSync(LOGO_PATH)) return reply.code(404).send({ error: 'Aucun filigrane configuré.' });
    const stream = fs.createReadStream(LOGO_PATH);
    reply.type('image/png');
    return reply.send(stream);
  });

  // POST /api/watermark — upload du logo
  fastify.post('/api/watermark', async (req, reply) => {
    const parts = req.parts({ limits: { fileSize: 5 * 1024 * 1024 } });
    for await (const part of parts) {
      if (part.type !== 'file') continue;
      fs.mkdirSync(path.dirname(LOGO_PATH), { recursive: true });

      // On écrit d'abord dans un fichier temporaire : le logo n'est remplacé
      // que si le contenu est réellement une image décodable.
      const tmp = `${LOGO_PATH}.upload`;
      await pipeline(part.file, fs.createWriteStream(tmp));

      if (part.file.truncated) {
        await fs.promises.rm(tmp, { force: true });
        return reply.code(413).send({ error: 'Logo trop volumineux (5 Mo max).' });
      }
      try {
        await sharp(tmp).metadata();
      } catch {
        await fs.promises.rm(tmp, { force: true });
        return reply.code(400).send({ error: "Le fichier n'est pas une image valide." });
      }
      // Normalisé en PNG : le logo est toujours servi comme tel
      await sharp(tmp).png().toFile(LOGO_PATH);
      await fs.promises.rm(tmp, { force: true });
      return { ok: true };
    }
    return reply.code(400).send({ error: 'Aucun fichier reçu.' });
  });

  // GET /api/watermark/preview-photo — retourne la photo de prévisualisation persistée
  fastify.get('/api/watermark/preview-photo', async (req, reply) => {
    const extensions = ['.jpg', '.jpeg', '.png', '.webp'];
    let found = null;
    for (const ext of extensions) {
      if (fs.existsSync(PREVIEW_PHOTO_PATH + ext)) { found = PREVIEW_PHOTO_PATH + ext; break; }
    }
    if (!found) return reply.code(404).send({ error: 'Aucune photo de prévisualisation.' });
    const ext = path.extname(found).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    reply.type(mime);
    return reply.send(fs.createReadStream(found));
  });

  // POST /api/watermark/preview-photo — upload de la photo de prévisualisation
  fastify.post('/api/watermark/preview-photo', async (req, reply) => {
    const parts = req.parts({ limits: { fileSize: 50 * 1024 * 1024 } });
    for await (const part of parts) {
      if (part.type !== 'file') continue;

      const tmp = `${PREVIEW_PHOTO_PATH}.upload`;
      await pipeline(part.file, fs.createWriteStream(tmp));

      if (part.file.truncated) {
        await fs.promises.rm(tmp, { force: true });
        return reply.code(413).send({ error: 'Photo trop volumineuse (50 Mo max).' });
      }
      try {
        await sharp(tmp).metadata();
      } catch {
        await fs.promises.rm(tmp, { force: true });
        return reply.code(400).send({ error: "Le fichier n'est pas une image valide." });
      }

      // Supprimer les anciennes versions
      ['.jpg', '.jpeg', '.png', '.webp'].forEach(e => {
        try { fs.unlinkSync(PREVIEW_PHOTO_PATH + e); } catch {}
      });
      // Extension imposée par le serveur, jamais celle du client
      await fs.promises.rename(tmp, `${PREVIEW_PHOTO_PATH}.jpg`);
      return { ok: true };
    }
    return reply.code(400).send({ error: 'Aucun fichier reçu.' });
  });

  // GET /api/watermark/preview — génère l'aperçu avec les paramètres actuels
  fastify.get('/api/watermark/preview', async (req, reply) => {
    // Trouver la photo de prévisualisation
    const extensions = ['.jpg', '.jpeg', '.png', '.webp'];
    let photoPath = null;
    for (const ext of extensions) {
      if (fs.existsSync(PREVIEW_PHOTO_PATH + ext)) { photoPath = PREVIEW_PHOTO_PATH + ext; break; }
    }
    if (!photoPath) return reply.code(404).send({ error: 'Aucune photo de prévisualisation.' });
    if (!fs.existsSync(LOGO_PATH)) return reply.code(404).send({ error: 'Aucun filigrane configuré.' });

    const { position, size, opacity, margin } = getWatermarkSettings();

    if (!WATERMARK_POSITIONS.includes(position)) {
      return reply.code(400).send({ error: 'Position invalide.' });
    }

    const image = sharp(photoPath);
    const metadata = await image.metadata();
    const imgWidth = metadata.width || 1000;
    const logoMaxWidth = Math.round(imgWidth * (size / 100));
    const marginPx = Math.round(imgWidth * (margin / 100));

    let logoBuffer = await sharp(LOGO_PATH)
      .resize(logoMaxWidth, null, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();

    if (opacity < 100) {
      const raw = await sharp(logoBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const { data, info } = raw;
      for (let i = 3; i < data.length; i += 4) {
        data[i] = Math.round(data[i] * (opacity / 100));
      }
      logoBuffer = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
    }

    // Ajouter le padding (marge) autour du logo selon la position
    if (marginPx > 0) {
      const isNorth = ['northwest', 'north', 'northeast'].includes(position);
      const isSouth = ['southwest', 'south', 'southeast'].includes(position);
      const isWest  = ['northwest', 'west', 'southwest'].includes(position);
      const isEast  = ['northeast', 'east', 'southeast'].includes(position);
      logoBuffer = await sharp(logoBuffer)
        .extend({
          top:    isNorth ? marginPx : 0,
          bottom: isSouth ? marginPx : 0,
          left:   isWest  ? marginPx : 0,
          right:  isEast  ? marginPx : 0,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer();
    }

    const result = await sharp(photoPath)
      .composite([{ input: logoBuffer, gravity: position, blend: 'over' }])
      .jpeg({ quality: 85 })
      .toBuffer();

    reply.type('image/jpeg');
    return reply.send(result);
  });
}
