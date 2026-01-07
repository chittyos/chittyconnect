/**
 * Context routes: keep sessions, active files, and sync reports in sync across channels.
 */

import { Hono } from 'hono'

export const contextRoutes = new Hono()

// Set active files for a session
// Body: { session_id: string, files: [{ uri, name?, size?, sha256?, mime?, metadata? }] }
contextRoutes.post('/files/set-active', async (c) => {
  try {
    const body = await c.req.json()
    const { session_id, files = [] } = body || {}
    if (!session_id || !Array.isArray(files)) {
      return c.json({ error: 'invalid_request' }, 400)
    }

    const apiKey = c.get('apiKey')
    const chitty_id = apiKey?.chittyId || apiKey?.userId || 'unknown'

    // NEW: Persist to D1
    if (c.env.DB && files.length > 0) {
      try {
        const now = Math.floor(Date.now() / 1000)
        await c.env.DB.batch(
          files.map(file => c.env.DB.prepare(`
            INSERT OR REPLACE INTO context_files
            (id, session_id, chitty_id, file_uri, file_name, file_size, sha256, mime_type, is_active, last_accessed, synced_at, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
          `).bind(
            crypto.randomUUID(),
            session_id,
            chitty_id,
            file.uri,
            file.name || null,
            file.size || null,
            file.sha256 || null,
            file.mime || null,
            now,
            now,
            JSON.stringify(file.metadata || {})
          ))
        )
      } catch (error) {
        console.error('[context.files.set-active] D1 error:', error.message)
        // Continue even if D1 fails - SSE broadcast is still valuable
      }
    }

    // EXISTING: Broadcast SSE
    const sm = c.get('streaming')
    if (sm) {
      await sm.broadcast({ type: 'context.files.updated', sessionId: session_id, files })
    }
    return c.json({ ok: true, count: files.length })
  } catch (err) {
    return c.json({ error: 'bad_json', message: String(err?.message || err) }, 400)
  }
})

// Report a sync summary from a bulk sync client (e.g., rclone)
// Body: { path_prefix?: string, items: [{ r2_key?, sha256?, size?, modified? }], source?: string }
contextRoutes.post('/files/sync-report', async (c) => {
  try {
    const body = await c.req.json()
    const { path_prefix, items = [], source = 'rclone' } = body || {}
    if (!Array.isArray(items)) {
      return c.json({ error: 'invalid_request' }, 400)
    }

    const apiKey = c.get('apiKey')
    const session_id = apiKey?.sessionId || 'unknown'
    const chitty_id = apiKey?.chittyId || apiKey?.userId || 'unknown'

    // NEW: Record sync event
    let eventId = null
    if (c.env.DB) {
      try {
        eventId = crypto.randomUUID()
        const now = Math.floor(Date.now() / 1000)
        const totalBytes = items.reduce((sum, item) => sum + (item.size || 0), 0)

        await c.env.DB.prepare(`
          INSERT INTO sync_events
          (event_id, session_id, event_type, source, items_count, bytes_synced, status, synced_at)
          VALUES (?, ?, 'file_sync', ?, ?, ?, 'success', ?)
        `).bind(eventId, session_id, source, items.length, totalBytes, now).run()

        // NEW: Update context_files (bulk upsert)
        if (items.length > 0) {
          await c.env.DB.batch(
            items.map(item => c.env.DB.prepare(`
              INSERT OR REPLACE INTO context_files
              (id, session_id, chitty_id, file_uri, file_name, file_size, sha256, is_active, last_accessed, synced_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            `).bind(
              crypto.randomUUID(),
              session_id,
              chitty_id,
              item.r2_key ? `r2://${item.r2_key}` : item.uri || 'unknown',
              item.r2_key ? item.r2_key.split('/').pop() : item.name || null,
              item.size || null,
              item.sha256 || null,
              now,
              now
            ))
          )
        }
      } catch (error) {
        console.error('[context.files.sync-report] D1 error:', error.message)
        // Continue even if D1 fails
      }
    }

    // EXISTING: Broadcast SSE
    const sm = c.get('streaming')
    if (sm) {
      await sm.broadcast({
        type: 'context.files.synced',
        sessionId: session_id,
        pathPrefix: path_prefix || '',
        count: items.length,
        eventId
      })
    }
    return c.json({ ok: true, count: items.length, eventId })
  } catch (err) {
    return c.json({ error: 'bad_json', message: String(err?.message || err) }, 400)
  }
})

export default contextRoutes

