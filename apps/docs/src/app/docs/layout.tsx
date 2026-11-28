import { DocsLayout } from 'fumadocs-ui/layouts/docs'

import { SidebarFooter } from '@/components/sidebar-footer'
import { baseOptions } from '@/lib/layout.shared'
import { source } from '@/lib/source'

export default function Layout({ children }: LayoutProps<'/docs'>) {
  // The sidebar's own icon bar is switched off (no GitHub icon, no switch) in favour of SidebarFooter,
  // which labels the link. The landing page keeps the shared options as they are.
  return (
    <DocsLayout
      tree={source.getPageTree()}
      {...baseOptions()}
      githubUrl={undefined}
      themeSwitch={{ enabled: false }}
      sidebar={{ footer: <SidebarFooter /> }}
    >
      {children}
    </DocsLayout>
  )
}
