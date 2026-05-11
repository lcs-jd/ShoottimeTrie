import { Worker } from 'bullmq';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { connection } from './queue.js';
import db from '../db.js';
import { broadcast } from '../routes/sse.js';

const DATA_DIR        = path.resolve(process.env.DATA_DIR || './data');
const WATERMARKED_DIR = path.join(DATA_DIR, 'watermarked');
const LOGO_PATH       = path.resolve(process.env.WATERMARK_LOGO_PATH || path.join(DATA_DIR, '..', 'watermark', 'logo.png'));

fs.mkdirSync(WATERMARKED_DIR, { recursive: true });

function getWatermarkSettings() {
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

export const watermarkWorker = new Worker('watermark', async (job) => {
  const { photoId, originalPath, sessionId } = job.data;

  const outFilename = `${photoId}.jpg`;
  const outPath     = path.join(WATERMARKED_DIR, outFilename);

  const { position, size, opacity, margin } = getWatermarkSettings();

  const image    = sharp(originalPath);
  const metadata = await image.metadata();
  const imgWidth = metadata.width || 1000;

  const logoMaxWidth = Math.round(imgWidth * (size / 100));
  const marginPx     = Math.round(imgWidth * (margin / 100));

  let compositeOptions = [];

  if (fs.existsSync(LOGO_PATH)) {
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

    compositeOptions = [{ input: logoBuffer, gravity: position, blend: 'over' }];
  }

  await sharp(originalPath)
    .composite(compositeOptions)
    .jpeg({ quality: 92, mozjpeg: true })
    .toFile(outPath);

  // Transaction : mise à jour atomique
  db.transaction(() => {
    db.prepare('UPDATE photos SET watermarked_path = ?, status = ? WHERE id = ?')
      .run(`watermarked/${outFilename}`, 'watermarked', photoId);
  })();

  broadcast(sessionId, { type: 'watermark_done', photoId });
}, {
  connection,
  concurrency: 1,
});

watermarkWorker.on('failed', (job, err) => {
  console.error(`[watermark] job ${job?.id} failed:`, err.message);

  if (!job?.data?.photoId) return;

  // Remettre la photo en statut 'kept' pour signaler que le filigranage a échoué
  // (elle reste sélectionnée mais pas filigranée)
  db.transaction(() => {
    db.prepare("UPDATE photos SET status = 'kept' WHERE id = ? AND status = 'watermarking'")
      .run(job.data.photoId);
  })();

  broadcast(job.data.sessionId, {
    type: 'watermark_error',
    photoId: job.data.photoId,
    error: err.message,
  });
});
