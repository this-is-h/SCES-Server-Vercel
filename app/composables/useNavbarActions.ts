import type { Component, Ref } from 'vue'

/** 页面向 UDashboardNavbar 右侧功能区注册动作组件（每页一个，路由切换自动清空）。 */
interface NavbarActions {
  component: Ref<Component | null>
  set: (c: Component | null) => void
}

export function useNavbarActions(): NavbarActions {
  const component = useState<Component | null>('navbar-actions', () => null)
  const set = (c: Component | null) => {
    component.value = c
  }
  return { component, set }
}
