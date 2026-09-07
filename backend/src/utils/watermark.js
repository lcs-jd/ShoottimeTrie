import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import db from '../db.js';

const DATA_DIR  = path.resolve(process.env.DATA_DIR || './data');
const LOGO_PATH = path.resolve(process.env.WATERMARK_LOGO_PATH || path.join(DATA_DIR, '..', 'watermark', 'logo.png'));

export function getWatermarkSettings() {
  const rows = db.prepare(
    "SELECT key, value FROM settings WHERE key IN ('watermark_position','watermark_size','watermark_opacity','watermark_margin')"
  ).all();
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return {
    position: map.watermark_position || 'southeast',
    size:     parseFloat(map.watermark_size    || '15'),
    opacity:  parseFloat(map.watermark_opacity || '100'),
    margin:   parseFloat(map.watermark_margin  || '2'),
  };
}

// Construit le calque du filigrane (logo redimensionné, opacité et marge appliquées)
// pour une image de largeur donnée. Retourne [] si aucun logo n'est configuré.
export async function buildWatermarkComposite(imgWidth) {
  if (!fs.existsSync(LOGO_PATH)) return [];

  const { position, size, opacity, margin } = getWatermarkSettings();
  const logoMaxWidth = Math.round(imgWidth * (size / 100));
  const marginPx     = Math.round(imgWidth * (margin / 100));

  let logoBuffer = await sharp(LOGO_PATH)
    .resize(logoMaxWidth, null, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();

  if (opacity < 100) {
    const { data, info } = await sharp(logoBuffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (let i = 3; i < data.length; i += 4) {
      data[i] = Math.round(data[i] * (opacity / 100));
    }
    logoBuffer = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
      .png()
      .toBuffer();
  }

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

  return [{ input: logoBuffer, gravity: position, blend: 'over' }];
}

// Applique le filigrane et retourne un Buffer JPEG, sans rien écrire sur disque
// ni modifier la base : utilisé pour l'envoi par email d'une photo non filigranée.
export async function watermarkToBuffer(originalPath) {
  const metadata   = await sharp(originalPath).metadata();
  const composites = await buildWatermarkComposite(metadata.width || 1000);

  return sharp(originalPath)
    .composite(composites)
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();
}
