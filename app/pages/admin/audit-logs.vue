<script setup lang="ts">
interface AuditLogRow {
  id: number
  adminUserId: string | null
  action: string
  target: string
  detail: string | null
  ip: string | null
  createdAt: number
}

const { api } = useAdminAuth()

const logs = ref<AuditLogRow[]>([])
const allLogs = ref<AuditLogRow[]>([])
const cursor = ref<number | null>(null)
const hasMore = ref(false)
const loading = ref(false)
const search = ref('')
const actionFilter = ref<string | null>(null)

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

const columns = [
  { accessorKey: 'id', header: '#' },
  { accessorKey: 'action', header: '操作' },
  { accessorKey: 'target', header: '对象' },
  { accessorKey: 'detail', header: '详情' },
  { accessorKey: 'ip', header: 'IP' },
  { accessorKey: 'createdAt', header: '时间' },
]

async function load(next: boolean) {
  loading.value = true
  try {
    const params = new URLSearchParams({ limit: '50' })
    if (next && cursor.value !== null) params.set('cursor', String(cursor.value))
    const data = await api<{ ok: true; data: { logs: AuditLogRow[]; nextCursor: number | null } }>(`/admin/audit-logs?${params}`)
    allLogs.value = next ? [...allLogs.value, ...data.data.logs] : data.data.logs
    cursor.value = data.data.nextCursor
    hasMore.value = data.data.nextCursor !== null
  }
  finally {
    loading.value = false
  }
}

onMounted(() => load(false))

const actionOptions = computed(() => {
  const actions = [...new Set(allLogs.value.map(l => l.action))].sort()
  return [{ label: '全部操作', value: null }, ...actions.map(a => ({ label: a, value: a }))]
})

const filtered = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  return allLogs.value.filter((l) => {
    if (actionFilter.value !== null && l.action !== actionFilter.value) return false
    if (keyword !== '' && !l.target.toLowerCase().includes(keyword) && !l.action.toLowerCase().includes(keyword)) return false
    return true
  })
})

definePageMeta({ title: '审计日志' })
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center gap-2 flex-wrap">
      <UInput
        v-model="search"
        icon="i-lucide-search"
        placeholder="按操作或对象筛选…"
        class="w-56"
      />
      <USelect v-model="actionFilter" :items="actionOptions" icon="i-lucide-filter" class="w-48" />
      <UButton icon="i-lucide-refresh-cw" variant="ghost" :loading="loading" label="刷新" @click="load(false)" />
    </div>

    <UTable :data="filtered" :columns="columns" :loading="loading">
      <template #action-cell="{ row }">
        <code class="text-xs">{{ row.original.action }}</code>
      </template>
      <template #detail-cell="{ row }">
        <span class="text-sm text-muted">{{ row.original.detail ?? '—' }}</span>
      </template>
      <template #ip-cell="{ row }">
        <span class="text-xs">{{ row.original.ip ?? '—' }}</span>
      </template>
      <template #createdAt-cell="{ row }">
        {{ fmtDate(row.original.createdAt) }}
      </template>
      <template #empty>
        <p class="text-sm text-muted py-6 text-center">
          无匹配日志
        </p>
      </template>
    </UTable>

    <div v-if="hasMore" class="flex justify-center">
      <UButton variant="soft" :loading="loading" label="加载更多" @click="load(true)" />
    </div>
  </div>
</template>
