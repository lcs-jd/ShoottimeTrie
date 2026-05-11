import { Worker } from 'bullmq';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { connection } from './queue.js';
import db from '../db.js';
import { broadcast } from '../routes/sse.js';
import { extractTakenAt } from '../utils/exif.js';

const DATA_DIR    = path.resolve(process.env.DATA_DIR || './data');
const PROXIES_DIR = path.join(DATA_DIR, 'proxies');

fs.mkdirSync(PROXIES_DIR, { recursive: true });

export const thumbnailWorker = new Worker('thumbnail', async (job) => {
  const { photoId, originalPath, sessionId } = job.data;

  const proxyFilename = `${photoId}.webp`;
  const proxyPath     = path.join(PROXIES_DIR, proxyFilename);

  await sharp(originalPath)
    .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 75 })
    .toFile(proxyPath);

  const takenAt = await extractTakenAt(originalPath);

  db.transaction(() => {
    db.prepare('UPDATE photos SET proxy_path = ?, status = ?, taken_at = ? WHERE id = ?')
      .run(`proxies/${proxyFilename}`, 'pending', takenAt, photoId);
  })();

  broadcast(sessionId, { type: 'proxy_ready', photoId, takenAt });
}, {
  connection,
  concurrency: 2,
});

thumbnailWorker.on('failed', (job, err) => {
  console.error(`[thumbnail] job ${job?.id} failed:`, err.message);

  if (!job?.data?.photoId) return;

  // Marquer la photo comme proxy_error pour que l'UI puisse l'afficher
  db.transaction(() => {
    db.prepare("UPDATE photos SET status = 'proxy_error' WHERE id = ?")
      .run(job.data.photoId);
  })();

  broadcast(job.data.sessionId, {
    type: 'proxy_error',
    photoId: job.data.photoId,
    error: err.message,
  });
});
