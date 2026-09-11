<script setup lang="ts">
interface UnitSummary {
  unitId: string
  unitName: string
  unitType: string
  level: number
  parentUnitId: string | null
}
interface LicenseRow {
  code: string
  expiresAt: number
  status: string
  renewCount: number
  createdAt: number
}
interface UnitDetail {
  unit: UnitSummary
  publicKeyJwk: unknown | null
  template: { id: string; name: string; version: number; revision: number; status: string } | null
  licenses: LicenseRow[]
}
interface TemplateVersion {
  id: string
  unitId: string
  name: string
  version: number
  revision: number
  status: string
  updatedAt: number
}

const { api, logout } = useAdminAuth()

const units = ref<UnitSummary[]>([])
const templates = ref<TemplateVersion[]>([])
const detail = ref<UnitDetail | null>(null)
const newUnit = ref({ unitId: '', name: '', level: 1 })
const newLicenseMonths = ref(12)
const message = ref('')
const error = ref('')

onMounted(async () => {
  await Promise.all([loadUnits(), loadTemplates()])
})

async function loadUnits() {
  try {
    const data = await api<{ ok: true; data: { units: UnitSummary[] } }>('/admin/units')
    units.value = data.data.units
  }
  catch {
    error.value = '单位列表加载失败'
  }
}

async function loadTemplates() {
  try {
    const data = await api<{ ok: true; data: { templates: TemplateVersion[] } }>('/admin/templates')
    templates.value = data.data.templates
  }
  catch {
    error.value = '模板列表加载失败'
  }
}

async function loadDetail(unitId: string) {
  error.value = ''
  try {
    const data = await api<{ ok: true; data: UnitDetail }>(`/admin/units/${unitId}`)
    detail.value = data.data
  }
  catch {
    error.value = '单位详情加载失败'
  }
}

async function createUnit() {
  message.value = ''
  error.value = ''
  try {
    const body: Record<string, unknown> = {
      unitId: newUnit.value.unitId,
      name: newUnit.value.name,
      level: newUnit.value.level,
    }
    if (newUnit.value.level === 2) {
      const parent = units.value.find(u => u.level === 1)
      if (!parent) {
        error.value = '请先创建一级单位'
        return
      }
      body.parentId = parent.unitId
      body.templateId = templates.value[0]?.id ?? 'default-template'
    }
    const data = await api<{ ok: true; data: { code: string | null } }>('/admin/units', { method: 'POST', body })
    message.value = data.data.code ? `创建成功，首个授权码：${data.data.code}` : '创建成功'
    newUnit.value = { unitId: '', name: '', level: 1 }
    await loadUnits()
  }
  catch (e) {
    error.value = e instanceof Error && 'data' in e
      ? ((e as { data?: { error?: string } }).data?.error ?? '创建失败')
      : '创建失败'
  }
}

async function issueLicense(unitId: string) {
  message.value = ''
  error.value = ''
  try {
    const data = await api<{ ok: true; data: { code: string } }>(`/admin/units/${unitId}/licenses`, {
      method: 'POST',
      body: { months: newLicenseMonths.value },
    })
    message.value = `已签发授权码：${data.data.code}`
    await loadDetail(unitId)
  }
  catch (e) {
    error.value = e instanceof Error && 'data' in e
      ? ((e as { data?: { error?: string } }).data?.error ?? '签发失败')
      : '签发失败'
  }
}

async function revokeLicense(code: string) {
  message.value = ''
  try {
    await api(`/admin/licenses/${code}/revoke`, { method: 'POST', body: {} })
    message.value = `已作废 ${code}`
    if (detail.value) await loadDetail(detail.value.unit.unitId)
  }
  catch (e) {
    error.value = e instanceof Error && 'data' in e
      ? ((e as { data?: { error?: string } }).data?.error ?? '作废失败')
      : '作废失败'
  }
}

async function renewLicense(code: string) {
  message.value = ''
  try {
    await api(`/admin/licenses/${code}/renew`, { method: 'POST', body: { months: newLicenseMonths.value } })
    message.value = `已续期 ${code}`
    if (detail.value) await loadDetail(detail.value.unit.unitId)
  }
  catch (e) {
    error.value = e instanceof Error && 'data' in e
      ? ((e as { data?: { error?: string } }).data?.error ?? '续期失败')
      : '续期失败'
  }
}

async function publishTemplate(t: TemplateVersion) {
  message.value = ''
  try {
    await api(`/admin/templates/${t.id}/publish`, {
      method: 'POST',
      body: { version: t.version, revision: t.revision },
    })
    message.value = `已发布 ${t.id}@${t.version}.${t.revision}`
    await loadTemplates()
  }
  catch (e) {
    error.value = e instanceof Error && 'data' in e
      ? ((e as { data?: { error?: string } }).data?.error ?? '发布失败')
      : '发布失败'
  }
}

const STATUS_TEXT: Record<string, string> = {
  active: '有效',
  expired: '已过期',
  revoked: '已作废',
  draft: '草稿',
  published: '已发布',
  archived: '已归档',
}
</script>

<template>
  <main class="admin">
    <header>
      <h1>SCES 管理后台</h1>
      <button @click="async () => { await logout(); navigateTo('/admin/login') }">
        退出登录
      </button>
    </header>

    <p v-if="message" class="ok">
      {{ message }}
    </p>
    <p v-if="error" class="error">
      {{ error }}
    </p>

    <section>
      <h2>单位</h2>
      <form class="row" @submit.prevent="createUnit">
        <input v-model="newUnit.unitId" placeholder="单位标识（如 xiaoQu1）" required>
        <input v-model="newUnit.name" placeholder="单位名称" required>
        <select v-model.number="newUnit.level">
          <option :value="1">
            一级单位
          </option>
          <option :value="2">
            二级单位
          </option>
        </select>
        <button type="submit">
          创建
        </button>
      </form>

      <table>
        <thead>
          <tr>
            <th>标识</th>
            <th>名称</th>
            <th>层级</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="unit in units" :key="unit.unitId">
            <td>{{ unit.unitId }}</td>
            <td>{{ unit.unitName }}</td>
            <td>{{ unit.level === 1 ? '一级' : '二级' }}</td>
            <td>
              <button @click="loadDetail(unit.unitId)">
                详情
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="detail">
      <h2>单位详情：{{ detail.unit.unitName }}</h2>
      <label class="row">
        签发月数
        <input v-model.number="newLicenseMonths" type="number" min="1" max="120">
      </label>
      <button @click="issueLicense(detail.unit.unitId)">
        签发新授权码
      </button>

      <table>
        <thead>
          <tr>
            <th>授权码</th>
            <th>到期</th>
            <th>状态</th>
            <th>续期次数</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="license in detail.licenses" :key="license.code">
            <td><code>{{ license.code }}</code></td>
            <td>{{ new Date(license.expiresAt).toLocaleDateString() }}</td>
            <td>{{ STATUS_TEXT[license.status] ?? license.status }}</td>
            <td>{{ license.renewCount }}</td>
            <td>
              <button @click="renewLicense(license.code)">
                续期
              </button>
              <button class="danger" @click="revokeLicense(license.code)">
                作废
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section>
      <h2>配置模板</h2>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>名称</th>
            <th>版本</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="template in templates" :key="`${template.id}-${template.version}-${template.revision}`">
            <td>{{ template.id }}</td>
            <td>{{ template.name }}</td>
            <td>{{ template.version }}.{{ template.revision }}</td>
            <td>{{ STATUS_TEXT[template.status] ?? template.status }}</td>
            <td>
              <button
                v-if="template.status === 'draft'"
                @click="publishTemplate(template)"
              >
                发布
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </main>
</template>

<style scoped>
.admin {
  max-width: 860px;
  margin: 2rem auto;
  font-family: system-ui, sans-serif;
}
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
section {
  margin-top: 2rem;
}
table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 0.75rem;
}
th,
td {
  border: 1px solid #d4d4d4;
  padding: 0.4rem 0.6rem;
  text-align: left;
}
.row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
}
.ok {
  color: #15803d;
}
.error {
  color: #b91c1c;
}
.danger {
  color: #b91c1c;
}
</style>
