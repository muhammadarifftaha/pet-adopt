import { accessPermission, can, host, type PluginUser } from '@pet-adopt/plugin-sdk'

import { getConnectionAction, getFeedPreviewAction, listRecentPostsAction } from '../actions'
import { InstagramScreen } from './InstagramScreen'

// The plugin's home screen. Everyone on the team can open it (the screen's access level is `all`):
//   - the connection (keys, connecting, disconnecting) is read only for roles with `admin` view
//     (admins and developers change it, audit views it); editors get a short status instead;
//   - pinning posts and "Refresh now" need the `all` edit level (editors too).
// Everything comes through the plugin's server actions, which check those levels themselves.
export async function InstagramHome({ user }: { user: PluginUser }) {
  const seesConnection = can(user.role, accessPermission('admin', 'view'))
  const [connection, posts, feed, timeZone] = await Promise.all([
    seesConnection ? getConnectionAction() : null,
    listRecentPostsAction(),
    getFeedPreviewAction(),
    host().timeZone(),
  ])
  const problems = [connection, posts, feed].flatMap((result) => (result && !result.ok ? [result.error] : []))

  return (
    <InstagramScreen
      initialConnection={connection?.ok ? connection.data : null}
      initialPosts={posts.ok ? posts.data : []}
      initialFeed={feed.ok ? feed.data : null}
      loadProblem={problems[0] ?? null}
      seesConnection={seesConnection}
      canConnect={can(user.role, accessPermission('admin', 'edit'))}
      canPin={can(user.role, accessPermission('all', 'edit'))}
      timeZone={timeZone}
      now={new Date().toISOString()}
    />
  )
}
