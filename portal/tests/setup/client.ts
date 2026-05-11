// Beta test version v1.2.0
/**
 * Client-side test setup.
 * Configures Vue Test Utils global options and Pinia for all store tests.
 */
import { config } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, vi } from 'vitest'

// ── Default Vue Test Utils globals ───────────────────────────────────────────
config.global.stubs = {
  // Stub router-link and router-view so tests don't need a router
  RouterLink:  { template: '<a><slot /></a>' },
  RouterView:  { template: '<div />' },
  Teleport:    true,
}

// ── Fresh Pinia instance before every test ───────────────────────────────────
beforeEach(() => {
  setActivePinia(createPinia())
})

// ── Stub global fetch so tests never hit the network ─────────────────────────
vi.stubGlobal('fetch', vi.fn())
