<script setup lang="ts">
interface RebindRow {
  id: string
  unitId: string
  oldInstallId: string
  newInstallId: string
  status: string
  reason: string | null
  createdAt: number
}

const toast = useToast()
const { api } = useAdminAuth()

const rebinds = ref<RebindRow[]>([])
const units = ref<{ unitId: string; unitName: string; level: number; parentUnitId: string | null }[]>([])
const statusFilter = ref<string | null>(null)
const parentFilter = ref<string | null>(null)
const unitFilter = ref<string | null>(null)
const search = ref('')

const STATUS_COLOR: Record<string, 'warning' | 'neutral' | 'success' | 'error'> = { pending: 'warning', 'self-served': 'neutral', approved: 'success', rejected: 'error' }
const STATUS_TEXT: Record<string, string> = { pending: '待放行', 'self-served': '自助完成', approved: '已放行', rejected: '已拒绝' }

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const columns = [
  { accessorKey: 'id', header: '申请' },
  { accessorKey: 'unitId', header: '单位' },
  { accessorKey: 'status', header: '状态' },
  { accessorKey: 'createdAt', header: '时间' },
  { id: 'actions', header: '操作' },
]

onMounted(async () => {
  await Promise.all([load(), loadUnits()])
})

async function load() {
  const params = new URLSearchParams()
  if (statusFilter.value) params.set('status', statusFilter.value)
  const data = await api<{ ok: true; data: { rebinds: RebindRow[] } }>(`/admin/rebinds?${params}`)
  rebinds.value = data.data.rebinds
}

async function loadUnits() {
  const data = await api<{ ok: true; data: { units: { unitId: string; unitName: string; level: number; parentUnitId: string | null }[] } }>('/admin/units')
  units.value = data.data.units
}

const parentOptions = computed(() => [
  { label: '全部一级单位', value: null },
  ...units.value.filter(u => u.level === 1).map(u => ({ label: u.unitName, value: u.unitId })),
])

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
  return rebinds.value.filter((r) => {
    if (unitFilter.value !== null && r.unitId !== unitFilter.value) return false
    if (keyword !== '' && !r.id.toLowerCase().includes(keyword) && !r.unitId.toLowerCase().includes(keyword)) return false
    return true
  })
})

async function approve(r: RebindRow, ok: boolean) {
  try {
    await api(`/admin/rebinds/${r.id}/approve`, { method: 'POST', body: { approve: ok } })
    toast.add({ title: ok ? '已放行（旧码作废，新码见审计日志）' : '已拒绝', color: ok ? 'success' : 'neutral' })
    await load()
  }
  catch (e) {
    toast.add({ title: extractApiError(e, '操作失败'), color: 'error' })
  }
}

definePageMeta({ title: '换机记录' })
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center gap-2 flex-wrap">
      <UInput
        v-model="search"
        icon="i-lucide-search"
        placeholder="按申请或单位筛选…"
        class="w-56"
      />
      <USelect v-model="parentFilter" :items="parentOptions" icon="i-lucide-building-2" class="w-40" @update:model-value="onParentChange" />
      <USelect v-model="unitFilter" :items="unitOptions" icon="i-lucide-layers" class="w-44" @update:model-value="() => {}" />
      <USelect
        v-model="statusFilter"
        :items="[{ label: '全部状态', value: null }, { label: '待放行', value: 'pending' }, { label: '自助完成', value: 'self-served' }, { label: '已放行', value: 'approved' }, { label: '已拒绝', value: 'rejected' }]"
        icon="i-lucide-filter"
        class="w-36"
        @update:model-value="load"
      />
    </div>

    <UTable :data="filtered" :columns="columns">
      <template #id-cell="{ row }">
        <code class="text-xs">{{ row.original.id.slice(0, 8) }}…</code>
      </template>
      <template #unitId-cell="{ row }">
        <code class="text-xs">{{ row.original.unitId }}</code>
      </template>
      <template #status-cell="{ row }">
        <UBadge variant="subtle" :color="STATUS_COLOR[row.original.status]" :label="STATUS_TEXT[row.original.status]" />
      </template>
      <template #createdAt-cell="{ row }">
        {{ fmtDate(row.original.createdAt) }}
      </template>
      <template #actions-cell="{ row }">
        <div v-if="row.original.status === 'pending'" class="flex gap-1">
          <UButton size="xs" label="放行" @click="approve(row.original, true)" />
          <UButton size="xs" variant="soft" color="error" label="拒绝" @click="approve(row.original, false)" />
        </div>
      </template>
      <template #empty>
        <p class="text-sm text-muted py-6 text-center">
          暂无换机记录
        </p>
      </template>
    </UTable>
  </div>
</template>
