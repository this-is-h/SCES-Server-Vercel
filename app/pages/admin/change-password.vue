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
    // 改密成功后强制重新登录（服务端已清除全部刷新令牌）
    await logout()
    navigateTo('/admin/login')
  }
  catch (e) {
    error.value = e instanceof Error && 'data' in e
      ? ((e as { data?: { error?: string } }).data?.error ?? '修改失败，请稍后重试')
      : '修改失败，请稍后重试'
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="change-password">
    <h1>修改密码</h1>
    <form @submit.prevent="submit">
      <label>
        原密码
        <input v-model="oldPassword" type="password" autocomplete="current-password" required>
      </label>
      <label>
        新密码（至少 12 位）
        <input v-model="newPassword" type="password" autocomplete="new-password" minlength="12" required>
      </label>
      <label>
        确认新密码
        <input v-model="confirm" type="password" autocomplete="new-password" minlength="12" required>
      </label>
      <p v-if="error" class="error">
        {{ error }}
      </p>
      <button type="submit" :disabled="busy">
        {{ busy ? '提交中…' : '修改并重新登录' }}
      </button>
    </form>
  </main>
</template>

<style scoped>
.change-password {
  max-width: 340px;
  margin: 6rem auto;
  font-family: system-ui, sans-serif;
}
label {
  display: block;
  margin-bottom: 1rem;
}
input {
  display: block;
  width: 100%;
  padding: 0.5rem;
  margin-top: 0.25rem;
  box-sizing: border-box;
}
button {
  width: 100%;
  padding: 0.6rem;
  cursor: pointer;
}
button:disabled {
  opacity: 0.6;
}
.error {
  color: #b91c1c;
}
</style>
