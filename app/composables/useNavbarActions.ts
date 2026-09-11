/** 页面向 UDashboardNavbar 右侧声明动作：目前支持「创建单位」入口（单位页置 true,离开自动清空）。 */
export function useNavbarCreateUnit() {
  return useState<boolean>('navbar-create-unit', () => false)
}
