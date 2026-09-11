<script setup lang="ts">
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

const templates = ref<TemplateVersion[]>([])
const versions = ref<TemplateVersion[]>([])
const versionsFor = ref<string | null>(null)
const configOpen = ref(false)
const configTitle = ref('')
const configJson = ref('')
const search = ref('')
const unitFilter = ref<string | null>(null)

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const columns = [
  { accessorKey: 'id', header: 'ID' },
  { accessorKey: 'name', header: '名称' },
  { accessorKey: 'unitId', header: '绑定单位' },
  { accessorKey: 'version', header: '版本' },
  { accessorKey: 'status', header: '状态' },
  { accessorKey: 'updatedAt', header: '更新时间' },
  { id: 'actions', header: '操作' },
]

const versionColumns = [
  { accessorKey: 'version', header: '版本' },
  { accessorKey: 'revision', header: '修订' },
  { accessorKey: 'status', header: '状态' },
  { accessorKey: 'updatedAt', header: '更新时间' },
  { id: 'actions', header: '操作' },
]

const TEMPLATE_STATUS_COLOR: Record<string, 'success' | 'neutral' | 'warning'> = { published: 'success', draft: 'neutral', archived: 'warning' }
const TEMPLATE_STATUS_TEXT: Record<string, string> = { published: '已发布', draft: '草稿', archived: '已归档' }

onMounted(loadTemplates)

async function loadTemplates() {
  const data = await api<{ ok: true; data: { templates: TemplateVersion[] } }>('/admin/templates')
  templates.value = data.data.templates
}

/** 模板按单位（到一级即可）+ 名称/标识搜索过滤。 */
const filtered = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  return templates.value.filter((t) => {
    if (keyword !== '' && !t.name.toLowerCase().includes(keyword) && !t.id.toLowerCase().includes(keyword)) return false
    return true
  })
})

const unitOptions = computed(() => {
  const ids = [...new Set(templates.value.map(t => t.unitId))]
  return [{ label: '全部单位', value: null }, ...ids.map(id => ({ label: id, value: id }))]
})

const filteredByUnit = computed(() =>
  unitFilter.value === null ? filtered.value : filtered.value.filter(t => t.unitId === unitFilter.value),
)

async function loadVersions(id: string) {
  versionsFor.value = versionsFor.value === id ? null : id
  if (versionsFor.value !== id) return
  const data = await api<{ ok: true; data: { versions: TemplateVersion[] } }>(`/admin/templates/${id}/versions`)
  versions.value = data.data.versions
}

async function viewConfig(t: { id: string; version: number; revision: number }) {
  try {
    const data = await api<{ ok: true; data: { config: unknown } }>(`/admin/templates/${t.id}/versions/${t.version}/${t.revision}/config`)
    configJson.value = JSON.stringify(data.data.config, null, 2)
    configTitle.value = `${t.id}@${t.version}.${t.revision} 配置内容`
    configOpen.value = true
  }
  catch (e) {
    toast.add({ title: extractApiError(e, '配置读取失败'), color: 'error' })
  }
}

async function publishTemplate(t: TemplateVersion) {
  try {
    await api(`/admin/templates/${t.id}/publish`, {
      method: 'POST',
      body: { version: t.version, revision: t.revision },
    })
    toast.add({ title: `已发布 ${t.id}@${t.version}.${t.revision}`, color: 'success' })
    await loadTemplates()
    if (versionsFor.value === t.id) await loadVersions(t.id)
  }
  catch (e) {
    toast.add({ title: extractApiError(e, '发布失败'), color: 'error' })
  }
}

definePageMeta({ title: '配置模板' })
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
      <USelect v-model="unitFilter" :items="unitOptions" icon="i-lucide-building-2" class="w-44" />
    </div>

    <UTable :data="filteredByUnit" :columns="columns">
      <template #unitId-cell="{ row }">
        <code class="text-xs">{{ row.original.unitId }}</code>
      </template>
      <template #version-cell="{ row }">
        v{{ row.original.version }}.{{ row.original.revision }}
      </template>
      <template #status-cell="{ row }">
        <UBadge
          variant="subtle"
          :color="TEMPLATE_STATUS_COLOR[row.original.status]"
          :label="TEMPLATE_STATUS_TEXT[row.original.status]"
        />
      </template>
      <template #updatedAt-cell="{ row }">
        {{ fmtDate(row.original.updatedAt) }}
      </template>
      <template #actions-cell="{ row }">
        <div class="flex gap-1">
          <UButton size="xs" variant="soft" :label="versionsFor === row.original.id ? '收起历史' : '版本历史'" @click="loadVersions(row.original.id)" />
          <UButton size="xs" variant="soft" icon="i-lucide-eye" label="查看配置" @click="viewConfig(row.original)" />
          <UButton
            v-if="row.original.status === 'draft'"
            size="xs"
            label="发布"
            @click="publishTemplate(row.original)"
          />
        </div>
      </template>
      <template #empty>
        <p class="text-sm text-muted py-6 text-center">
          无匹配模板
        </p>
      </template>
    </UTable>

    <UTable
      v-if="versionsFor"
      :data="versions"
      :columns="versionColumns"
      class="border border-default rounded-lg"
    >
      <template #version-cell="{ row }">
        v{{ row.original.version }}.{{ row.original.revision }}
      </template>
      <template #status-cell="{ row }">
        <UBadge
          variant="subtle"
          :color="TEMPLATE_STATUS_COLOR[row.original.status]"
          :label="TEMPLATE_STATUS_TEXT[row.original.status]"
        />
      </template>
      <template #updatedAt-cell="{ row }">
        {{ fmtDate(row.original.updatedAt) }}
      </template>
      <template #actions-cell="{ row }">
        <UButton size="xs" variant="soft" icon="i-lucide-eye" label="查看配置" @click="viewConfig(row.original)" />
      </template>
    </UTable>

    <UModal v-model:open="configOpen" :title="configTitle" :ui="{ content: 'max-w-3xl' }">
      <template #body>
        <pre class="max-h-[60vh] overflow-auto text-xs bg-muted/50 rounded-md p-3 font-mono">{{ configJson }}</pre>
      </template>
    </UModal>
  </div>
</template>
