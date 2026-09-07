import { Worker } from 'bullmq';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { connection } from './queue.js';
import db from '../db.js';
import { broadcast } from '../routes/sse.js';
import { buildWatermarkComposite } from '../utils/watermark.js';

const DATA_DIR        = path.resolve(process.env.DATA_DIR || './data');
const WATERMARKED_DIR = path.join(DATA_DIR, 'watermarked');

fs.mkdirSync(WATERMARKED_DIR, { recursive: true });

export const watermarkWorker = new Worker('watermark', async (job) => {
  const { photoId, originalPath, sessionId } = job.data;

  const outFilename = `${photoId}.jpg`;
  const outPath     = path.join(WATERMARKED_DIR, outFilename);

  const metadata         = await sharp(originalPath).metadata();
  const compositeOptions = await buildWatermarkComposite(metadata.width || 1000);

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
