import { Worker } from 'bullmq';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { connection } from './queue.js';
import db from '../db.js';
import { broadcast } from '../routes/sse.js';

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
const WATERMARKED_DIR = path.join(DATA_DIR, 'watermarked');
const LOGO_PATH = path.resolve(process.env.WATERMARK_LOGO_PATH || path.join(DATA_DIR, '..', 'watermark', 'logo.png'));

fs.mkdirSync(WATERMARKED_DIR, { recursive: true });

export const watermarkWorker = new Worker('watermark', async (job) => {
  const { photoId, originalPath, sessionId } = job.data;

  const outFilename = `${photoId}.jpg`;
  const outPath = path.join(WATERMARKED_DIR, outFilename);

  const image = sharp(originalPath);
  const metadata = await image.metadata();

  // Redimensionner le logo à max 15% de la largeur de l'image
  const logoMaxWidth = Math.round((metadata.width || 1000) * 0.15);

  let compositeOptions = [];
  if (fs.existsSync(LOGO_PATH)) {
    const logoBuffer = await sharp(LOGO_PATH)
      .resize(logoMaxWidth, null, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
    compositeOptions = [{ input: logoBuffer, gravity: 'southeast', blend: 'over' }];
  }

  await sharp(originalPath)
    .composite(compositeOptions)
    .jpeg({ quality: 90, mozjpeg: true })
    .toFile(outPath);

  db.prepare('UPDATE photos SET watermarked_path = ?, status = ? WHERE id = ?')
    .run(`watermarked/${outFilename}`, 'watermarked', photoId);

  broadcast(sessionId, { type: 'watermark_done', photoId });
}, {
  connection,
  concurrency: 1,
});

watermarkWorker.on('failed', (job, err) => {
  console.error(`[watermark] job ${job?.id} failed:`, err.message);
});
