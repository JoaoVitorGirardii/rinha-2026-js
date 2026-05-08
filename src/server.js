import { createVector } from './func.js'
import { knnScoreService } from './service.tree.js'

const PORT = process.env.PORT ?? 3000

// fraud_score = votes/5 onde votes ∈ {0,1,2,3,4,5} → apenas 6 respostas possíveis
// threshold 0.2: aprova somente se 0/5 vizinhos são fraude (wFN=3 > wFP=1 → ser agressivo compensa)
const RESPONSES = new Array(6)
for (let v = 0; v <= 5; v++) {
  const fraud_score = parseFloat((v / 5).toFixed(4))
  const approved = fraud_score < 0.2
  RESPONSES[v] = JSON.stringify({ fraud_score, approved })
}
const DEFAULT = RESPONSES[3]
const HEADERS = { 'Content-Type': 'application/json' }

// Aquece o JIT antes de receber tráfego
const _warmVec = new Float32Array(14).fill(0.5)
for (let _i = 0; _i < 5000; _i++) knnScoreService(_warmVec)

if (typeof Bun !== 'undefined') {
  // Runtime Bun: usa servidor HTTP nativo (uWS internamente) para menor overhead
  Bun.serve({
    port: PORT,
    idleTimeout: 30,
    async fetch(req) {
      const url = req.url
      const method = req.method

      if (method === 'GET' && url.endsWith('/ready')) {
        return new Response(null, { status: 200 })
      }

      if (method === 'POST' && url.endsWith('/fraud-score')) {
        let json
        try {
          json = await req.json()
        } catch {
          return new Response(DEFAULT, { headers: HEADERS })
        }
        const vector = createVector(json)
        const votes = knnScoreService(vector)
        return new Response(RESPONSES[votes], { headers: HEADERS })
      }

      return new Response('Not Found', { status: 404 })
    },
    error() {
      return new Response(DEFAULT, { headers: HEADERS })
    }
  })
  console.log(`Servidor Bun rodando na porta ${PORT}`)
} else {
  // Fallback Node.js (para compatibilidade local / testes)
  const { createServer } = await import('node:http')
  let queueSize = 0
  const MAX_QUEUE = 500

  const server = createServer((req, res) => {
    const { method, url } = req

    if (method === 'GET' && url === '/ready') {
      res.writeHead(200); res.end(); return
    }

    if (method === 'POST' && url === '/fraud-score') {
      if (queueSize >= MAX_QUEUE) {
        res.writeHead(200, HEADERS); res.end(DEFAULT); return
      }
      queueSize++
      let body = ''
      req.on('data', c => { body += c })
      req.on('end', () => {
        queueSize--
        let json
        try { json = JSON.parse(body) } catch {
          res.writeHead(200, HEADERS); res.end(DEFAULT); return
        }
        const vector = createVector(json)
        const votes = knnScoreService(vector)
        res.writeHead(200, HEADERS); res.end(RESPONSES[votes])
      })
      return
    }

    res.writeHead(404); res.end()
  })

  server.listen(PORT, () => console.log(`Servidor Node.js rodando na porta ${PORT}`))
}
