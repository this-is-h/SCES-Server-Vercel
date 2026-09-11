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

// ---- 表格数据：一级分组行内嵌二级 subRows，含搜索过滤
interface UnitTreeNode extends UnitSummary {
  subRows?: UnitTreeNode[]
}

const tableData = computed<UnitTreeNode[]>(() => {
  const keyword = search.value.trim().toLowerCase()
  const match = (u: UnitSummary) =>
    keyword === '' || u.unitName.toLowerCase().includes(keyword) || u.unitId.toLowerCase().includes(keyword)
  const level2 = units.value.filter(u => u.level === 2)
  const level1 = units.value.filter(u => u.level === 1)
  return level1
    .map((parent) => {
      const children = level2.filter(u => u.parentUnitId === parent.unitId && match(u))
      const selfMatch = match(parent)
      if (keyword !== '' && !selfMatch && children.length === 0) return null
      return { ...parent, subRows: children }
    })
    .filter((n): n is UnitTreeNode => n !== null)
})

// 默认展开全部一级分组；watch immediate 让初始数据也展开
const expanded = ref<Record<string, boolean>>({})
watch(tableData, (rows) => {
  const next: Record<string, boolean> = {}
  for (const r of rows) next[r.unitId] = true
  expanded.value = next
}, { immediate: true })

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

function confirmDelete(u: UnitSummary) {
  deleteTarget.value = u
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
  unitId: '',
  name: '',
  unitType: 'college' as 'college' | 'department' | 'other',
  parentName: '',
  licenseMonths: 12,
})

// 一级单位列表（已有 + 用于 InputMenu autocomplete）
const level1Units = computed(() => units.value.filter(u => u.level === 1))

// 一级单位自动补全选项：已有单位名 + 新建提示
const parentItems = computed(() => {
  const existing = level1Units.value.map(u => ({ label: u.unitName, value: u.unitName }))
  return existing
})

// 检测用户输入的一级单位名称是否为「新建」（不存在于已有列表）
const isNewParent = computed(() => {
  const name = createForm.parentName.trim()
  if (!name) return false
  return !level1Units.value.some(u => u.unitName === name)
})

// 新建一级需要二次确认
const confirmNewParent = ref(false)

/** 用户在 InputMenu 选择「Create xxx」时，@create 回调传入 searchTerm 字符串；直接赋给 parentName。 */
function onParentCreate(term: unknown) {
  createForm.parentName = String(term).trim()
  confirmNewParent.value = false
}
function openCreate() {
  Object.assign(createForm, { unitId: '', name: '', unitType: 'college', parentName: '', licenseMonths: 12 })
  confirmNewParent.value = false
  createOpen.value = true
}

async function createUnit() {
  if (!createForm.unitId.trim() || !createForm.name.trim() || !createForm.parentName.trim()) {
    toast.add({ title: '请填写单位标识、名称与所属一级单位', color: 'error' })
    return
  }
  // 新建一级必须先确认
  if (isNewParent.value && !confirmNewParent.value) {
    toast.add({ title: '检测到新的一级单位，请先勾选确认', color: 'warning' })
    return
  }

  creating.value = true
  try {
    // 查找或创建一级单位
    let parentId: string | undefined
    const existing = level1Units.value.find(u => u.unitName === createForm.parentName.trim())
    if (existing) {
      parentId = existing.unitId
    }
    else {
      // 新建一级单位（先创建一级，再创建二级）
      const parentRes = await api<{ ok: true; data: { unit: { unitId: string } } }>('/admin/units', {
        method: 'POST',
        body: { unitId: createForm.parentName.trim(), name: createForm.parentName.trim(), level: 1 },
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
        unitType: createForm.unitType,
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

    <UTable
      v-model:expanded="expanded"
      :data="tableData"
      :columns="columns"
      :get-sub-rows="(row: UnitTreeNode) => row.subRows ?? []"
      :get-row-id="(row: UnitTreeNode) => row.unitId"
    >
      <template #unitName-cell="{ row }">
        <div class="flex items-center gap-1.5" :class="!row.getCanExpand() && 'pl-6'">
          <UButton
            v-if="row.getCanExpand()"
            :icon="row.getIsExpanded() ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
            color="neutral"
            variant="ghost"
            size="xs"
            :ui="{ base: 'size-5' }"
            @click="row.toggleExpanded()"
          />
          <span :class="row.getCanExpand() ? 'font-semibold' : ''">{{ row.original.unitName }}</span>
          <UBadge
            v-if="row.getCanExpand()"
            size="sm"
            variant="subtle"
            color="neutral"
            :label="`${row.original.subRows?.length ?? 0} 个下级`"
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
    <UModal v-model:open="createOpen" title="创建单位" description="二级单位将自动绑定最新已发布模板并签发首个授权码" :ui="{ footer: 'justify-end' }">
      <template #body>
        <UForm :state="createForm" class="space-y-4">
          <UFormField label="所属一级单位" name="parentName" required>
            <UInputMenu
              v-model="createForm.parentName"
              mode="autocomplete"
              :items="parentItems"
              value-key="value"
              create-item
              placeholder="搜索已有或输入新建"
              class="w-full"
              @create="onParentCreate"
            />
          </UFormField>

          <!-- 新建一级单位二次确认 -->
          <UAlert
            v-if="isNewParent"
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="检测到新的一级单位"
            description="请确认名称无误后勾选下方复选框，否则无法创建。"
          />
          <UCheckbox
            v-if="isNewParent"
            v-model="confirmNewParent"
            label="确认新建一级单位"
          />

          <UFormField label="二级单位标识（camelCase）" name="unitId" required>
            <UInput v-model="createForm.unitId" placeholder="如 myCollege" class="w-full" />
          </UFormField>

          <UFormField label="二级单位名称" name="name" required>
            <UInput v-model="createForm.name" class="w-full" />
          </UFormField>

          <UFormField label="类型" name="unitType">
            <USelect
              v-model="createForm.unitType"
              :items="[{ label: '书院/学院', value: 'college' }, { label: '部门', value: 'department' }, { label: '其他', value: 'other' }]"
              class="w-full"
            />
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
