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
    error.value = e instanceof Error && 'data' in e
      ? ((e as { data?: { error?: string } }).data?.error ?? '登录失败，请稍后重试')
      : '登录失败，请稍后重试'
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="login">
    <h1>SCES 管理后台</h1>
    <form @submit.prevent="submit">
      <label>
        用户名
        <input v-model="username" type="text" autocomplete="username" required>
      </label>
      <label>
        密码
        <input v-model="password" type="password" autocomplete="current-password" required>
      </label>
      <p v-if="error" class="error">
        {{ error }}
      </p>
      <button type="submit" :disabled="busy">
        {{ busy ? '登录中…' : '登录' }}
      </button>
    </form>
  </main>
</template>

<style scoped>
.login {
  max-width: 320px;
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
  cursor: default;
}
.error {
  color: #b91c1c;
}
</style>
