<script setup lang="ts">
const oldPassword = ref('')
const newPassword = ref('')
const confirm = ref('')
const error = ref('')
const busy = ref(false)
const { api, logout } = useAdminAuth()

async function submit() {
  error.value = ''
  if (newPassword.value !== confirm.value) {
    error.value = '两次输入的新密码不一致'
    return
  }
  busy.value = true
  try {
    await api('/admin/auth/change-password', {
      method: 'POST',
      body: { oldPassword: oldPassword.value, newPassword: newPassword.value },
    })
    useToast().add({ title: '密码已修改，请重新登录', color: 'success' })
    // 改密成功后强制重新登录（服务端已清除全部刷新令牌）
    await logout()
    navigateTo('/admin/login')
  }
  catch (e) {
    error.value = extractApiError(e, '修改失败，请稍后重试')
  }
  finally {
    busy.value = false
  }
}

definePageMeta({ title: '修改密码' })
</script>

<template>
  <UCard class="max-w-md mx-auto my-12">
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-key-round" class="size-5 text-primary" />
        <h1 class="text-lg font-semibold">
          修改密码
        </h1>
      </div>
    </template>

    <UForm :state="{ oldPassword, newPassword, confirm }" @submit="submit">
      <UFormField label="原密码" name="oldPassword">
        <UInput v-model="oldPassword" type="password" autocomplete="current-password" class="w-full" required />
      </UFormField>
      <UFormField label="新密码（至少 12 位）" name="newPassword" class="mt-4">
        <UInput v-model="newPassword" type="password" autocomplete="new-password" minlength="12" class="w-full" required />
      </UFormField>
      <UFormField label="确认新密码" name="confirm" class="mt-4">
        <UInput v-model="confirm" type="password" autocomplete="new-password" minlength="12" class="w-full" required />
      </UFormField>

      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :title="error"
        class="mt-4"
      />

      <UButton type="submit" block class="mt-6" :loading="busy" label="修改并重新登录" />
    </UForm>
  </UCard>
</template>
