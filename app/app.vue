<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

// 登录前页面（/admin/login、/admin/change-password 未登录态）不包后台壳
const route = useRoute()
const bare = computed(() => route.path === '/admin/login')

const items = computed<NavigationMenuItem[][]>(() => [
  [
    { label: '单位', icon: 'i-lucide-building-2', to: '/admin' },
    { label: '配置模板', icon: 'i-lucide-file-cog', to: '/admin/templates' },
    { label: '批次', icon: 'i-lucide-layers', to: '/admin/batches' },
    { label: '换机记录', icon: 'i-lucide-smartphone', to: '/admin/rebinds' },
    { label: '审计日志', icon: 'i-lucide-scroll-text', to: '/admin/audit-logs' },
  ],
])
</script>

<template>
  <UApp>
    <NuxtPage v-if="bare" />
    <UDashboardGroup v-else unit="rem" storage="local">
      <UDashboardSidebar
        id="admin"
        collapsible
        resizable
        class="bg-elevated/25"
        :ui="{ footer: 'border-t border-default' }"
      >
        <template #header="{ collapsed }">
          <UButton
            :icon="collapsed ? 'i-lucide-shield-check' : undefined"
            :label="collapsed ? undefined : 'SCES 管理后台'"
            color="neutral"
            variant="ghost"
            block
            :square="collapsed"
            class="py-2"
          />
        </template>

        <template #default="{ collapsed }">
          <UNavigationMenu
            :collapsed="collapsed"
            :items="items"
            orientation="vertical"
            tooltip
          />
        </template>

        <template #footer="{ collapsed }">
          <UButton
            icon="i-lucide-key-round"
            :label="collapsed ? undefined : '修改密码'"
            color="neutral"
            variant="ghost"
            block
            :square="collapsed"
            class="py-2"
            to="/admin/change-password"
          />
        </template>
      </UDashboardSidebar>

      <UDashboardPanel id="admin-panel">
        <template #header>
          <UDashboardNavbar :title="route.meta.title as string ?? 'SCES 管理后台'">
            <template #leading>
              <UDashboardSidebarCollapse />
            </template>
          </UDashboardNavbar>
        </template>

        <template #body>
          <NuxtPage />
        </template>
      </UDashboardPanel>
    </UDashboardGroup>
  </UApp>
</template>
