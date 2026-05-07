import { parentPort } from 'node:worker_threads';
import { knnScoreService } from './service.knn.js';

parentPort.on('message', ({ id, vector }) => {
  const result = knnScoreService(vector);
  parentPort.postMessage({ id, result });
});
