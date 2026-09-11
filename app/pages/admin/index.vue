<script setup lang="ts">
const health = ref<{ status: string; now: number } | null>(null)
const error = ref('')

onMounted(async () => {
  try {
    const res = await $fetch<{ ok: boolean; data?: { status: string; now: number }; error?: string }>(
      '/api/v1/health',
    )
    if (res.ok && res.data) health.value = res.data
    else error.value = res.error ?? '未知错误'
  }
  catch (e) {
    error.value = e instanceof Error ? e.message : '请求失败'
  }
})
</script>

<template>
  <main class="admin-shell">
    <h1>SCES 管理后台</h1>
    <p>服务端 API 与管理后台同源部署（Nuxt on Vercel）。</p>
    <dl v-if="health">
      <dt>API 状态</dt>
      <dd>{{ health.status }}</dd>
      <dt>服务器时间</dt>
      <dd>{{ new Date(health.now).toLocaleString() }}</dd>
    </dl>
    <p v-else-if="error" class="error">
      API 不可用：{{ error }}
    </p>
    <p v-else>
      正在探测 /api/v1/health …
    </p>
  </main>
</template>

<style>
.admin-shell {
  max-width: 640px;
  margin: 4rem auto;
  font-family: system-ui, sans-serif;
}
.admin-shell .error {
  color: #b91c1c;
}
.admin-shell dt {
  font-weight: 600;
  margin-top: 0.75rem;
}
</style>
