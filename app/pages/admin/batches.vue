<script setup lang="ts">
interface BatchPublic {
  batchId: string
  unitId: string
  year: number
  semester: number
  isTest: number
  status: string
  applyStartAt: number | null
  applyEndAt: number | null
  calcMode: string
  configTemplateId: string
  configTemplateVersion: number
  createdAt: number
}

const { api } = useAdminAuth()

const batches = ref<BatchPublic[]>([])
const units = ref<{ unitId: string; unitName: string; level: number; parentUnitId: string | null }[]>([])
const statusFilter = ref<string | null>(null)
const parentFilter = ref<string | null>(null)
const unitFilter = ref<string | null>(null)
const search = ref('')

const STATUS_COLOR: Record<string, 'success' | 'neutral' | 'error'> = { active: 'success', draft: 'neutral', closed: 'error' }
const STATUS_TEXT: Record<string, string> = { active: '进行中', draft: '未开始', closed: '已结束' }
const SEMESTER_TEXT: Record<number, string> = { 1: '第一学期', 2: '第二学期' }

function fmtDate(ms: number | null): string {
  return ms === null ? '—' : new Date(ms).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const columns = [
  { accessorKey: 'batchId', header: '批次' },
  { accessorKey: 'unitId', header: '单位' },
  { accessorKey: 'term', header: '学年学期' },
  { accessorKey: 'type', header: '类型' },
  { accessorKey: 'status', header: '状态' },
  { accessorKey: 'applyWindow', header: '申请窗口' },
  { accessorKey: 'calcMode', header: '计算方式' },
  { accessorKey: 'template', header: '模板' },
]

onMounted(async () => {
  await Promise.all([load(), loadUnits()])
})

async function load() {
  const params = new URLSearchParams()
  if (statusFilter.value) params.set('status', statusFilter.value)
  const data = await api<{ ok: true; data: { batches: BatchPublic[] } }>(`/admin/batches?${params}`)
  batches.value = data.data.batches
}

async function loadUnits() {
  const data = await api<{ ok: true; data: { units: { unitId: string; unitName: string; level: number; parentUnitId: string | null }[] } }>('/admin/units')
  units.value = data.data.units
}

const parentOptions = computed(() => [
  { label: '全部一级单位', value: null },
  ...units.value.filter(u => u.level === 1).map(u => ({ label: u.unitName, value: u.unitId })),
])

/** 二级选项随一级联动；未选一级时列出全部二级。 */
const unitOptions = computed(() => {
  const level2 = units.value.filter(u => u.level === 2 && (parentFilter.value === null || u.parentUnitId === parentFilter.value))
  return [{ label: '全部二级单位', value: null }, ...level2.map(u => ({ label: u.unitName, value: u.unitId }))]
})

function onParentChange() {
  if (parentFilter.value !== null && unitFilter.value !== null) {
    const current = units.value.find(u => u.unitId === unitFilter.value)
    if (!current || current.parentUnitId !== parentFilter.value) unitFilter.value = null
  }
  load()
}

const filtered = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  return batches.value.filter((b) => {
    if (unitFilter.value !== null && b.unitId !== unitFilter.value) return false
    if (keyword !== '' && !b.batchId.toLowerCase().includes(keyword) && !b.configTemplateId.toLowerCase().includes(keyword)) return false
    return true
  })
})

function transform(rows: BatchPublic[]) {
  return rows.map(b => ({ ...b, term: `${b.year} ${SEMESTER_TEXT[b.semester]}`, applyWindow: `${fmtDate(b.applyStartAt)} ~ ${fmtDate(b.applyEndAt)}`, template: `${b.configTemplateId}@v${b.configTemplateVersion}`, type: b.isTest === 1 ? '测试' : '正式' }))
}

definePageMeta({ title: '批次' })
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center gap-2 flex-wrap">
      <UInput
        v-model="search"
        icon="i-lucide-search"
        placeholder="按批次或模板筛选…"
        class="w-56"
      />
      <USelect v-model="parentFilter" :items="parentOptions" icon="i-lucide-building-2" class="w-40" @update:model-value="onParentChange" />
      <USelect v-model="unitFilter" :items="unitOptions" icon="i-lucide-layers" class="w-44" @update:model-value="() => {}" />
      <USelect
        v-model="statusFilter"
        :items="[{ label: '全部状态', value: null }, { label: '未开始', value: 'draft' }, { label: '进行中', value: 'active' }, { label: '已结束', value: 'closed' }]"
        icon="i-lucide-filter"
        class="w-32"
        @update:model-value="load"
      />
    </div>

    <UTable :data="transform(filtered)" :columns="columns">
      <template #batchId-cell="{ row }">
        <code class="text-xs">{{ row.original.batchId }}</code>
      </template>
      <template #unitId-cell="{ row }">
        <code class="text-xs">{{ row.original.unitId }}</code>
      </template>
      <template #isTest-cell="{ row }">
        <UBadge :color="row.original.isTest === 1 ? 'warning' : 'info'" variant="subtle" :label="row.original.type" />
      </template>
      <template #status-cell="{ row }">
        <UBadge variant="subtle" :color="STATUS_COLOR[row.original.status]" :label="STATUS_TEXT[row.original.status]" />
      </template>
      <template #template-cell="{ row }">
        <code class="text-xs">{{ row.original.template }}</code>
      </template>
      <template #empty>
        <p class="text-sm text-muted py-6 text-center">
          暂无批次。批次由书院管理端创建（接口 5）。
        </p>
      </template>
    </UTable>
  </div>
</template>
