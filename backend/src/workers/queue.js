import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const thumbnailQueue = new Queue('thumbnail', { connection });
export const watermarkQueue = new Queue('watermark', { connection });

export { connection };
