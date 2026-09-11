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

const toast = useToast()
const { api, logout } = useAdminAuth()

const units = ref<UnitSummary[]>([])
const templates = ref<TemplateVersion[]>([])
const detail = ref<UnitDetail | null>(null)
const detailOpen = ref(false)
const newLicenseMonths = ref(12)
const creating = ref(false)
const createOpen = ref(false)
const createForm = reactive({ unitId: '', name: '', level: 1 as 1 | 2, unitType: 'other' as 'college' | 'department' | 'other', licenseMonths: 12 })

const LEVEL_TEXT: Record<number, string> = { 1: '一级', 2: '二级' }
const UNIT_TYPE_TEXT: Record<string, string> = { college: '书院/学院', department: '部门', other: '其他' }
const LICENSE_STATUS_COLOR: Record<string, 'success' | 'warning' | 'error'> = { active: 'success', expired: 'warning', revoked: 'error' }
const LICENSE_STATUS_TEXT: Record<string, string> = { active: '有效', expired: '已过期', revoked: '已作废' }
const TEMPLATE_STATUS_COLOR: Record<string, 'success' | 'neutral' | 'warning'> = { published: 'success', draft: 'neutral', archived: 'warning' }
const TEMPLATE_STATUS_TEXT: Record<string, string> = { published: '已发布', draft: '草稿', archived: '已归档' }

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

const level2Count = computed(() => units.value.filter(u => u.level === 2).length)

onMounted(async () => {
  await Promise.all([loadUnits(), loadTemplates()])
})

async function loadUnits() {
  const data = await api<{ ok: true; data: { units: UnitSummary[] } }>('/admin/units')
  units.value = data.data.units
}

async function loadTemplates() {
  const data = await api<{ ok: true; data: { templates: TemplateVersion[] } }>('/admin/templates')
  templates.value = data.data.templates
}

async function loadDetail(unitId: string) {
  const data = await api<{ ok: true; data: UnitDetail }>(`/admin/units/${unitId}`)
  detail.value = data.data
  detailOpen.value = true
}

async function openConfig(t: { id: string; version: number; revision: number }) {
  const data = await api<{ ok: true; data: { config: unknown } }>(`/admin/templates/${t.id}/versions/${t.version}/${t.revision}/config`)
  configJson.value = JSON.stringify(data.data.config, null, 2)
  configTitle.value = `${t.id}@${t.version}.${t.revision}`
  configOpen.value = true
}

const unitColumns = [
  { accessorKey: 'unitId', header: '标识' },
  { accessorKey: 'unitName', header: '名称' },
  { accessorKey: 'level', header: '层级' },
  { accessorKey: 'parentUnitId', header: '上级单位' },
  { id: 'actions', header: '操作' },
]

const licenseColumns = [
  { accessorKey: 'code', header: '授权码' },
  { accessorKey: 'expiresAt', header: '到期' },
  { accessorKey: 'status', header: '状态' },
  { accessorKey: 'renewCount', header: '续期次数' },
  { id: 'actions', header: '操作' },
]

const configOpen = ref(false)
const configTitle = ref('')
const configJson = ref('')


async function createUnit() {
  creating.value = true
  try {
    const body: Record<string, unknown> = {
      unitId: createForm.unitId,
      name: createForm.name,
      level: createForm.level,
      unitType: createForm.unitType,
      licenseMonths: createForm.licenseMonths,
    }
    if (createForm.level === 2) {
      const parent = units.value.find(u => u.level === 1)
      if (!parent) {
        toast.add({ title: '请先创建一级单位', color: 'error' })
        return
      }
      body.parentId = parent.unitId
      const tpl = templates.value.find(t => t.status === 'published')
      if (!tpl) {
        toast.add({ title: '没有已发布的配置模板，请先上传并发布模板', color: 'error' })
        return
      }
      body.templateId = tpl.id
    }
    const data = await api<{ ok: true; data: { code: string | null; expiresAt: number | null } }>('/admin/units', { method: 'POST', body })
    toast.add({
      title: '创建成功',
      description: data.data.code ? `首个授权码：${data.data.code}` : undefined,
      color: 'success',
    })
    createOpen.value = false
    Object.assign(createForm, { unitId: '', name: '', level: 1, unitType: 'other', licenseMonths: 12 })
    await loadUnits()
  }
  catch (e) {
    toast.add({ title: extractApiError(e, '创建失败'), color: 'error' })
  }
  finally {
    creating.value = false
  }
}

async function issueLicense(unitId: string) {
  try {
    const data = await api<{ ok: true; data: { code: string } }>(`/admin/units/${unitId}/licenses`, {
      method: 'POST',
      body: { months: newLicenseMonths.value },
    })
    toast.add({ title: '已签发授权码', description: data.data.code, color: 'success' })
    await loadDetail(unitId)
  }
  catch (e) {
    toast.add({ title: extractApiError(e, '签发失败'), color: 'error' })
  }
}

async function revokeLicense(code: string) {
  try {
    await api(`/admin/licenses/${code}/revoke`, { method: 'POST', body: {} })
    toast.add({ title: `已作废 ${code}`, color: 'success' })
    if (detail.value) await loadDetail(detail.value.unit.unitId)
  }
  catch (e) {
    toast.add({ title: extractApiError(e, '作废失败'), color: 'error' })
  }
}

async function renewLicense(code: string) {
  try {
    await api(`/admin/licenses/${code}/renew`, { method: 'POST', body: { months: newLicenseMonths.value } })
    toast.add({ title: `已续期 ${code}`, color: 'success' })
    if (detail.value) await loadDetail(detail.value.unit.unitId)
  }
  catch (e) {
    toast.add({ title: extractApiError(e, '续期失败'), color: 'error' })
  }
}

definePageMeta({ title: '单位' })
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-lg font-semibold">
          单位
        </h2>
        <p class="text-sm text-muted">
          共 {{ units.length }} 个单位（一级 {{ units.length - level2Count }} / 二级 {{ level2Count }}）
        </p>
      </div>
      <div class="flex gap-2">
        <UButton
          icon="i-lucide-log-out"
          color="neutral"
          variant="ghost"
          label="退出登录"
          @click="async () => { await logout(); navigateTo('/admin/login') }"
        />
        <UButton icon="i-lucide-plus" label="创建单位" @click="createOpen = true" />
      </div>
    </div>

    <UTable :data="units" :columns="unitColumns" :loading="units.length === 0 && false">
      <template #unitId-cell="{ row }">
        <span class="font-medium">{{ row.original.unitId }}</span>
      </template>
      <template #level-cell="{ row }">
        <UBadge :color="row.original.level === 1 ? 'info' : 'secondary'" variant="subtle" :label="LEVEL_TEXT[row.original.level]" />
      </template>
      <template #actions-cell="{ row }">
        <UButton size="xs" variant="soft" label="详情" @click="loadDetail(row.original.unitId)" />
      </template>
    </UTable>

    <!-- 单位详情抽屉 -->
    <UDrawer
      v-model:open="detailOpen"
      :title="detail ? `单位详情：${detail.unit.unitName}` : ''"
      :ui="{ content: 'max-w-2xl' }"
    >
      <template #body>
        <div v-if="detail" class="space-y-6">
          <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt class="text-muted">
              标识
            </dt>
            <dd>{{ detail.unit.unitId }}</dd>
            <dt class="text-muted">
              名称
            </dt>
            <dd>{{ detail.unit.unitName }}</dd>
            <dt class="text-muted">
              层级
            </dt>
            <dd>{{ LEVEL_TEXT[detail.unit.level] }}</dd>
            <dt class="text-muted">
              类型
            </dt>
            <dd>{{ UNIT_TYPE_TEXT[detail.unit.unitType] ?? detail.unit.unitType }}</dd>
            <dt class="text-muted">
              绑定模板
            </dt>
            <dd v-if="detail.template">
              {{ detail.template.id }}@{{ detail.template.version }}.{{ detail.template.revision }}
              <UBadge
                size="sm"
                variant="subtle"
                :color="TEMPLATE_STATUS_COLOR[detail.template.status]"
                :label="TEMPLATE_STATUS_TEXT[detail.template.status]"
              />
            </dd>
            <dd v-else class="text-muted">
              未绑定
            </dd>
            <dt class="text-muted">
              单位公钥
            </dt>
            <dd>{{ detail.publicKeyJwk ? '已生成' : '未生成' }}</dd>
          </dl>

          <div class="flex items-center gap-2">
            <UInputNumber v-model="newLicenseMonths" :min="1" :max="120" class="w-28" />
            <span class="text-sm text-muted">月</span>
            <UButton
              v-if="detail.unit.level === 2"
              icon="i-lucide-ticket-plus"
              label="签发新授权码"
              @click="issueLicense(detail.unit.unitId)"
            />
          </div>

          <UTable :data="detail.licenses" :columns="licenseColumns">
            <template #code-cell="{ row }">
              <code class="font-mono text-sm">{{ row.original.code }}</code>
            </template>
            <template #expiresAt-cell="{ row }">
              {{ fmtDate(row.original.expiresAt) }}
            </template>
            <template #status-cell="{ row }">
              <UBadge
                variant="subtle"
                :color="LICENSE_STATUS_COLOR[row.original.status]"
                :label="LICENSE_STATUS_TEXT[row.original.status]"
              />
            </template>
            <template #actions-cell="{ row }">
              <div class="flex gap-1">
                <UButton size="xs" variant="soft" label="续期" @click="renewLicense(row.original.code)" />
                <UButton
                  v-if="row.original.status === 'active'"
                  size="xs"
                  variant="soft"
                  color="error"
                  label="作废"
                  @click="revokeLicense(row.original.code)"
                />
              </div>
            </template>
            <template #empty>
              <p class="text-sm text-muted py-6 text-center">
                暂无授权码
              </p>
            </template>
          </UTable>
        </div>
      </template>
    </UDrawer>

    <!-- 创建单位弹窗 -->
    <UModal v-model:open="createOpen" title="创建单位" description="二级单位将自动绑定最新已发布模板并签发首个授权码">
      <template #body>
        <UForm :state="createForm" @submit="createUnit">
          <UFormField label="单位标识（camelCase）" name="unitId">
            <UInput v-model="createForm.unitId" placeholder="如 myCollege" class="w-full" required />
          </UFormField>
          <UFormField label="单位名称" name="name" class="mt-4">
            <UInput v-model="createForm.name" class="w-full" required />
          </UFormField>
          <UFormField label="层级" name="level" class="mt-4">
            <USelect
              v-model="createForm.level"
              :items="[{ label: '一级（学校）', value: 1 }, { label: '二级（书院）', value: 2 }]"
              class="w-full"
            />
          </UFormField>
          <UFormField label="类型" name="unitType" class="mt-4">
            <USelect
              v-model="createForm.unitType"
              :items="[{ label: '书院/学院', value: 'college' }, { label: '部门', value: 'department' }, { label: '其他', value: 'other' }]"
              class="w-full"
            />
          </UFormField>
          <UFormField label="首个授权码月数" name="licenseMonths" class="mt-4">
            <UInputNumber v-model="createForm.licenseMonths" :min="1" :max="120" class="w-full" />
          </UFormField>
        </UForm>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" label="取消" @click="createOpen = false" />
          <UButton :loading="creating" label="创建" @click="createUnit" />
        </div>
      </template>
    </UModal>
  </div>
</template>
