import { Worker } from 'bullmq';
import fs from 'fs';
import path from 'path';
import { connection } from './queue.js';
import db from '../db.js';
import { broadcast } from '../routes/sse.js';

const DATA_DIR   = path.resolve(process.env.DATA_DIR || './data');
const FB_API_BASE = 'https://graph.facebook.com/v25.0';
const PAGE_ID     = process.env.FACEBOOK_PAGE_ID;
const ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
const DELAY_MS    = parseInt(process.env.FACEBOOK_UPLOAD_DELAY_MS || '2000', 10);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function uploadPhotoToAlbum(albumId, photoPath, caption) {
  const form = new FormData();
  form.append('access_token', ACCESS_TOKEN);
  form.append('published', 'true');
  if (caption) form.append('caption', caption);

  const fileBuffer = fs.readFileSync(photoPath);
  const blob = new Blob([fileBuffer], { type: 'image/jpeg' });
  form.append('source', blob, path.basename(photoPath));

  const res  = await fetch(`${FB_API_BASE}/${albumId}/photos`, { method: 'POST', body: form });
  const data = await res.json();

  if (!res.ok || data.error) {
    throw new Error(data.error?.message || `HTTP ${res.status}`);
  }
  return data.id;
}

export const facebookWorker = new Worker('facebook', async (job) => {
  const { photoId, watermarkedPath, albumId, sessionId, index, total } = job.data;

  if (!photoId) throw new Error('photoId manquant dans le job');
  if (!PAGE_ID || !ACCESS_TOKEN) throw new Error('FACEBOOK_PAGE_ID ou FACEBOOK_PAGE_ACCESS_TOKEN non configurés');

  const absPath = path.join(DATA_DIR, watermarkedPath);
  if (!fs.existsSync(absPath)) throw new Error(`Fichier introuvable : ${absPath}`);

  // Rate limiting : pause avant chaque photo sauf la première
  if (index > 0) await sleep(DELAY_MS);

  const fbPhotoId = await uploadPhotoToAlbum(albumId, absPath, null);

  // Transaction pour éviter les mises à jour partielles
  db.transaction(() => {
    db.prepare('UPDATE photos SET facebook_photo_id = ?, status = ? WHERE id = ?')
      .run(fbPhotoId, 'published', photoId);
  })();

  broadcast(sessionId, { type: 'facebook_progress', photoId, index, total });
}, {
  connection,
  concurrency: 1,
  // 3 tentatives automatiques avec backoff exponentiel (2s, 8s, 18s)
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  },
});

facebookWorker.on('failed', (job, err) => {
  console.error(`[facebook] job ${job?.id} échec définitif (${job?.attemptsMade} tentatives) :`, err.message);

  if (!job?.data?.photoId) return;

  // Marquer en erreur seulement après épuisement de toutes les tentatives
  if (job.attemptsMade >= (job.opts?.attempts ?? 1)) {
    db.transaction(() => {
      db.prepare("UPDATE photos SET status = 'facebook_error' WHERE id = ?")
        .run(job.data.photoId);
    })();
    broadcast(job.data.sessionId, {
      type: 'facebook_error',
      photoId: job.data.photoId,
      error: err.message,
    });
  }
});
