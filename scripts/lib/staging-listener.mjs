// Child process used only by verify-staging.mjs, with explicitly isolated env.
import { createServer } from 'node:http'
if (!process.send || process.env.SCES_STAGING_ACCEPTANCE !== '1') throw new Error('Use verify-staging.mjs')
console.error = (...values) => process.send({ errorCodes: values.filter((v) => v && typeof v === 'object').map((v) => v.code ?? v.name ?? 'unknown') })
const { default: listener } = await import('../../.vercel/output/functions/__fallback.func/index.mjs')
const server = createServer(listener)
server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }))
process.on('message', (message) => {
  if (message === 'stop') { server.closeAllConnections(); server.close(() => process.exit(0)) }
})
