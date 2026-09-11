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
const { api } = useAdminAuth()

const units = ref<UnitSummary[]>([])
const templates = ref<TemplateVersion[]>([])
const search = ref('')

const LICENSE_STATUS_COLOR: Record<string, 'success' | 'warning' | 'error'> = { active: 'success', expired: 'warning', revoked: 'error' }
const LICENSE_STATUS_TEXT: Record<string, string> = { active: '有效', expired: '已过期', revoked: '已作废' }
const TEMPLATE_STATUS_COLOR: Record<string, 'success' | 'neutral' | 'warning'> = { published: 'success', draft: 'neutral', archived: 'warning' }
const TEMPLATE_STATUS_TEXT: Record<string, string> = { published: '已发布', draft: '草稿', archived: '已归档' }

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

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

// ---- 扁平行数组：一级行 + 折叠状态控制二级行显示。不使用 TanStack expandable（避免占位空行）。
interface FlatRow {
  unitId: string
  unitName: string
  level: number
  parentUnitId: string | null
  isParent: boolean
  childCount: number
}

const collapsed = ref<Record<string, boolean>>({})

function toggleCollapse(unitId: string) {
  collapsed.value[unitId] = !collapsed.value[unitId]
}

const flatRows = computed<FlatRow[]>(() => {
  const keyword = search.value.trim().toLowerCase()
  const match = (u: UnitSummary) =>
    keyword === '' || u.unitName.toLowerCase().includes(keyword) || u.unitId.toLowerCase().includes(keyword)
  const level1 = units.value.filter(u => u.level === 1)
  const level2 = units.value.filter(u => u.level === 2)
  const rows: FlatRow[] = []
  for (const parent of level1) {
    const children = level2.filter(u => u.parentUnitId === parent.unitId && match(u))
    const parentMatch = match(parent)
    if (keyword !== '' && !parentMatch && children.length === 0) continue
    rows.push({
      unitId: parent.unitId,
      unitName: parent.unitName,
      level: 1,
      parentUnitId: null,
      isParent: children.length > 0,
      childCount: children.length,
    })
    if (!collapsed.value[parent.unitId]) {
      for (const child of children) {
        rows.push({
          unitId: child.unitId,
          unitName: child.unitName,
          level: 2,
          parentUnitId: child.parentUnitId,
          isParent: false,
          childCount: 0,
        })
      }
    }
  }
  return rows
})

const columns = [
  { accessorKey: 'unitName', header: '名称' },
  { accessorKey: 'unitId', header: '标识' },
  { id: 'actions', header: '' },
]

// ---- 详情抽屉（右侧滑出）
const detail = ref<UnitDetail | null>(null)
const detailOpen = ref(false)
const newLicenseMonths = ref(12)

async function loadDetail(unitId: string) {
  const data = await api<{ ok: true; data: UnitDetail }>(`/admin/units/${unitId}`)
  detail.value = data.data
  detailOpen.value = true
}

// ---- 删除（带确认）
const deleteTarget = ref<UnitSummary | null>(null)
const deleteOpen = ref(false)
const deleting = ref(false)

function confirmDelete(row: FlatRow) {
  deleteTarget.value = { unitId: row.unitId, unitName: row.unitName, unitType: '', level: row.level, parentUnitId: row.parentUnitId }
  deleteOpen.value = true
}

async function doDelete() {
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    await api(`/admin/units/${deleteTarget.value.unitId}`, { method: 'DELETE' })
    toast.add({ title: `已删除 ${deleteTarget.value.unitName}`, color: 'success' })
    deleteOpen.value = false
    detailOpen.value = false
    await loadUnits()
  }
  catch (e) {
    toast.add({ title: extractApiError(e, '删除失败'), color: 'error' })
  }
  finally {
    deleting.value = false
  }
}

// ---- 创建单位
const createOpen = ref(false)
const creating = ref(false)
const createForm = reactive({
  parentId: '',
  parentName: '',
  unitId: '',
  name: '',
  licenseMonths: 12,
})

const level1Units = computed(() => units.value.filter(u => u.level === 1))

// 一级单位 autocomplete：以 unitId 为 value
const parentItems = computed(() =>
  level1Units.value.map(u => ({ label: `${u.unitName}（${u.unitId}）`, value: u.unitId })),
)

/** 输入的一级标识是否已存在（已存在则直接使用，无操作；不存在则需填名称再创建） */
const existingParent = computed(() => level1Units.value.find(u => u.unitId === createForm.parentId.trim()))
const isNewParent = computed(() => {
  const id = createForm.parentId.trim()
  if (!id) return false
  return !level1Units.value.some(u => u.unitId === id)
})

function openCreate() {
  Object.assign(createForm, { parentId: '', parentName: '', unitId: '', name: '', licenseMonths: 12 })
  createOpen.value = true
}

async function createUnit() {
  if (!createForm.parentId.trim() || !createForm.unitId.trim() || !createForm.name.trim()) {
    toast.add({ title: '请填写一级标识、二级标识与名称', color: 'error' })
    return
  }
  // 新建一级时必须有名称
  if (isNewParent.value && !createForm.parentName.trim()) {
    toast.add({ title: '一级标识不存在，请填写一级单位名称', color: 'warning' })
    return
  }

  creating.value = true
  try {
    let parentId: string
    if (existingParent.value) {
      parentId = existingParent.value.unitId
    }
    else {
      const parentRes = await api<{ ok: true; data: { unit: { unitId: string } } }>('/admin/units', {
        method: 'POST',
        body: { unitId: createForm.parentId.trim(), name: createForm.parentName.trim(), level: 1 },
      })
      parentId = parentRes.data.unit.unitId
    }

    const tpl = templates.value.find(t => t.status === 'published')
    if (!tpl) {
      toast.add({ title: '没有已发布的配置模板，请先上传并发布模板', color: 'error' })
      return
    }

    const data = await api<{ ok: true; data: { code: string | null } }>('/admin/units', {
      method: 'POST',
      body: {
        unitId: createForm.unitId.trim(),
        name: createForm.name.trim(),
        level: 2,
        parentId,
        templateId: tpl.id,
        licenseMonths: createForm.licenseMonths,
      },
    })
    toast.add({
      title: '创建成功',
      description: data.data.code ? `首个授权码：${data.data.code}` : undefined,
      color: 'success',
    })
    createOpen.value = false
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

const detailColumns = [
  { accessorKey: 'code', header: '授权码' },
  { accessorKey: 'expiresAt', header: '到期' },
  { accessorKey: 'status', header: '状态' },
  { accessorKey: 'renewCount', header: '续期' },
  { id: 'actions', header: '' },
]

definePageMeta({ title: '单位' })
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center gap-2">
      <UInput
        v-model="search"
        icon="i-lucide-search"
        placeholder="按名称或标识筛选…"
        class="w-64"
      />
      <span class="text-sm text-muted">
        {{ units.filter(u => u.level === 2).length }} 个二级单位
      </span>
      <UButton class="ml-auto" icon="i-lucide-plus" label="创建单位" @click="openCreate" />
    </div>

    <UTable :data="flatRows" :columns="columns">
      <template #unitName-cell="{ row }">
        <div class="flex items-center gap-1.5" :class="row.original.level === 2 && 'pl-6'">
          <UButton
            v-if="row.original.isParent"
            :icon="collapsed[row.original.unitId] ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'"
            color="neutral"
            variant="ghost"
            size="xs"
            :ui="{ base: 'size-5' }"
            @click="toggleCollapse(row.original.unitId)"
          />
          <span :class="row.original.isParent ? 'font-semibold' : ''">{{ row.original.unitName }}</span>
          <UBadge
            v-if="row.original.isParent"
            size="sm"
            variant="subtle"
            color="neutral"
            :label="`${row.original.childCount} 个下级`"
          />
        </div>
      </template>
      <template #unitId-cell="{ row }">
        <code class="text-xs">{{ row.original.unitId }}</code>
      </template>
      <template #actions-cell="{ row }">
        <div class="flex gap-1">
          <UButton size="xs" variant="soft" label="详情" @click="loadDetail(row.original.unitId)" />
          <UButton size="xs" variant="soft" color="error" icon="i-lucide-trash-2" label="删除" @click="confirmDelete(row.original)" />
        </div>
      </template>
      <template #empty>
        <p class="text-sm text-muted py-6 text-center">
          无匹配单位
        </p>
      </template>
    </UTable>

    <!-- 单位详情：右侧滑出层 -->
    <USlideover
      v-model:open="detailOpen"
      :title="detail ? `单位详情：${detail.unit.unitName}` : ''"
      :ui="{ content: 'max-w-xl' }"
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
            <dd>{{ detail.unit.level === 1 ? '一级' : '二级' }}</dd>
            <dt class="text-muted">
              上级单位
            </dt>
            <dd>{{ detail.unit.parentUnitId ?? '—' }}</dd>
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

          <UTable :data="detail.licenses" :columns="detailColumns">
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
    </USlideover>

    <!-- 删除确认 -->
    <UModal v-model:open="deleteOpen" title="删除单位" description="将同时删除其授权码、批次与配置模板，且不可恢复。">
      <template #body>
        <p v-if="deleteTarget" class="text-sm">
          确认删除
          <b>{{ deleteTarget.unitName }}</b>（{{ deleteTarget.unitId }}）？
        </p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="ghost" label="取消" @click="deleteOpen = false" />
          <UButton color="error" :loading="deleting" label="删除" @click="doDelete" />
        </div>
      </template>
    </UModal>

    <!-- 创建单位 -->
    <UModal v-model:open="createOpen" title="创建单位" description="二级单位将自动绑定最新已发布模板并签发首个授权码">
      <template #body>
        <UForm :state="createForm" class="space-y-4">
          <!-- 一级标识（camelCase）：已存在则自动填充名称；不存在则需填名称 -->
          <UFormField label="所属一级标识" name="parentId" required>
            <UInputMenu
              v-model="createForm.parentId"
              mode="autocomplete"
              :items="parentItems"
              value-key="value"
              create-item
              placeholder="输入已有标识或新建"
              class="w-full"
            />
          </UFormField>

          <!-- 已存在时显示单位名称 -->
          <UFormField v-if="existingParent" label="一级单位名称" name="parentNameExisting">
            <UInput :model-value="existingParent.unitName" disabled class="w-full" />
          </UFormField>

          <!-- 不存在时显示名称输入框（代替二次确认） -->
          <UFormField v-if="isNewParent" label="新一级单位名称" name="parentName" required>
            <UInput v-model="createForm.parentName" placeholder="如 宁夏大学" class="w-full" />
          </UFormField>

          <UFormField label="二级单位标识（camelCase）" name="unitId" required>
            <UInput v-model="createForm.unitId" placeholder="如 nxuLx" class="w-full" />
          </UFormField>

          <UFormField label="二级单位名称" name="name" required>
            <UInput v-model="createForm.name" placeholder="如 励行书院" class="w-full" />
          </UFormField>

          <UFormField label="首个授权码月数" name="licenseMonths">
            <UInputNumber v-model="createForm.licenseMonths" :min="1" :max="120" class="w-full" />
          </UFormField>
        </UForm>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="ghost" label="取消" @click="createOpen = false" />
          <UButton :loading="creating" label="创建" @click="createUnit" />
        </div>
      </template>
    </UModal>
  </div>
</template>
