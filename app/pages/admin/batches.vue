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
const statusFilter = ref<string | null>(null)

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
  { accessorKey: 'isTest', header: '类型' },
  { accessorKey: 'status', header: '状态' },
  { accessorKey: 'applyWindow', header: '申请窗口' },
  { accessorKey: 'calcMode', header: '计算方式' },
  { accessorKey: 'template', header: '模板' },
]

onMounted(load)

async function load() {
  const q = statusFilter.value ? `?status=${statusFilter.value}` : ''
  const data = await api<{ ok: true; data: { batches: BatchPublic[] } }>(`/admin/batches${q}`)
  batches.value = data.data.batches
}

function transform(rows: BatchPublic[]) {
  return rows.map(b => ({ ...b, term: `${b.year}-${SEMESTER_TEXT[b.semester]}`, applyWindow: `${fmtDate(b.applyStartAt)} ~ ${fmtDate(b.applyEndAt)}`, template: `${b.configTemplateId}@v${b.configTemplateVersion}`, type: b.isTest === 1 ? '测试' : '正式' }))
}

definePageMeta({ title: '批次' })
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-lg font-semibold">
          批次
        </h2>
        <p class="text-sm text-muted">
          全部批次公开信息（不含私钥与分数明细）
        </p>
      </div>
      <USelect
        v-model="statusFilter"
        :items="[{ label: '全部状态', value: null }, { label: '未开始', value: 'draft' }, { label: '进行中', value: 'active' }, { label: '已结束', value: 'closed' }]"
        icon="i-lucide-filter"
        class="w-36"
        @update:model-value="load"
      />
    </div>

    <UTable :data="transform(batches)" :columns="columns">
      <template #batchId-cell="{ row }">
        <code class="text-xs">{{ row.original.batchId }}</code>
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
