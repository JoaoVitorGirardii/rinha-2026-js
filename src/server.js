import { createServer } from 'node:http';
import { createVector } from './func.js';

const PORT = process.env.PORT ?? 3000;

const server = createServer((req, res) => {
  const { method, url } = req;

  if (method === 'GET' && url === '/ready') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (method === 'POST' && url === '/fraud-score') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });

      const teste = createVector(JSON.parse(body))
      console.log("createVector: ", teste)

      res.end(JSON.stringify({ approved: false, fraud_score: 0.0 }));
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
