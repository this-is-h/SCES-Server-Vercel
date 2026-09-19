import { defineNuxtConfig } from 'nuxt/config'
import type { ModuleOptions as UiOptions } from '@nuxt/ui'

// UI resolves its font module dependencies before inline module options.
const uiConfig: { ui: UiOptions } = { ui: { fonts: false } }
// Nitro 2's automatic detector caps at Node 22; match the Vercel project.
const deploymentConfig = { nitro: { vercel: { functions: { runtime: 'nodejs24.x' } } } }

export default defineNuxtConfig({
  ...uiConfig,
  ...deploymentConfig,
  modules: ['@nuxt/ui'],

  css: ['~/assets/css/main.css'],

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
