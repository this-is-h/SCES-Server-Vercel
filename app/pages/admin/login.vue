<script setup lang="ts">
const username = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)
const { login } = useAdminAuth()

async function submit() {
  error.value = ''
  busy.value = true
  try {
    const result = await login(username.value, password.value)
    navigateTo(result.mustChangePassword ? '/admin/change-password' : '/admin')
  }
  catch (e) {
    error.value = extractApiError(e, '登录失败，请稍后重试')
  }
  finally {
    busy.value = false
  }
}

definePageMeta({ title: '登录' })
</script>

<template>
  <div class="min-h-dvh flex items-center justify-center bg-muted/30 px-4">
    <UCard class="w-full max-w-sm">
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-shield-check" class="size-6 text-primary" />
          <h1 class="text-lg font-semibold">
            SCES 管理后台
          </h1>
        </div>
      </template>

      <UForm :state="{ username, password }" @submit="submit">
        <UFormField label="用户名" name="username">
          <UInput v-model="username" type="text" autocomplete="username" class="w-full" required />
        </UFormField>
        <UFormField label="密码" name="password" class="mt-4">
          <UInput v-model="password" type="password" autocomplete="current-password" class="w-full" required />
        </UFormField>

        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :title="error"
          class="mt-4"
        />

        <UButton type="submit" block class="mt-6" :loading="busy" label="登录" />
      </UForm>
    </UCard>
  </div>
</template>
