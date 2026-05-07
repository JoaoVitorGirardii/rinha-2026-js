import { createServer } from 'node:http';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createVector } from './func.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ?? 3000;
const MAX_QUEUE = 10;
const DEFAULT = '{"approved":false,"fraud_score":0.5}';

const worker = new Worker(join(__dirname, 'worker.js'));
let nextId = 0;
const pending = new Map();
let queueSize = 0;

worker.on('message', ({ id, result }) => {
  queueSize--;
  const res = pending.get(id);
  pending.delete(id);
  if (!res) return;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result));
});

worker.on('error', (err) => console.error('Worker error:', err));

const server = createServer((req, res) => {
  const { method, url } = req;

  if (method === 'GET' && url === '/ready') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (method === 'POST' && url === '/fraud-score') {
    if (queueSize >= MAX_QUEUE) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(DEFAULT);
      return;
    }

    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (queueSize >= MAX_QUEUE) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(DEFAULT);
        return;
      }

      let json;
      try {
        json = JSON.parse(body);
      } catch {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(DEFAULT);
        return;
      }

      const vector = createVector(json);
      const id = nextId++;
      queueSize++;
      pending.set(id, res);
      worker.postMessage({ id, vector: new Float32Array(vector) });
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
