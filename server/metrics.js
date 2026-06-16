import client from 'prom-client'

client.collectDefaultMetrics({ prefix: 'astrachat_' })

export const httpRequestDuration = new client.Histogram({
  name: 'astrachat_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.3, 1, 3, 10],
})

export const websocketConnections = new client.Gauge({
  name: 'astrachat_websocket_connections',
  help: 'Current WebSocket connections in this Node.js process',
})

export async function metricsText() {
  return client.register.metrics()
}

export function metricsContentType() {
  return client.register.contentType
}
