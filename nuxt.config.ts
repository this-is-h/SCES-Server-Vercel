import { defineNuxtConfig } from 'nuxt/config'

export default defineNuxtConfig({
  compatibilityDate: '2026-09-11',

  // 管理后台是登录后才可见的内部系统，无需 SEO；SSR 关闭可获得纯 SPA 行为，
  // 且避免每个页面渲染都占用服务函数调用（免费额度敏感）。
  ssr: false,

  devtools: { enabled: false },

  typescript: {
    // Nuxt 生成的工程引用方案与现有根 tsconfig 冲突，暂用独立 strict 设置。
    strict: true,
    typeCheck: false,
  },
})
