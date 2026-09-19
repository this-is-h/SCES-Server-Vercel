import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Each suite owns a WASM PostgreSQL instance; bound CI memory usage.
    fileParallelism: false,
    include: ['tests/**/*.test.{ts,mjs}'],
    env: {
      // 后台令牌签名密钥：测试用固定值（生产经 Vercel 环境变量注入）
      TOKEN_SIGNING_SECRET: 'test-signing-secret-0123456789abcdef',
    },
  },
})
