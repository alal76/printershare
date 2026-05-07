/**
 * @composable useApi
 * @description Thin wrapper around `fetch` that sets `loading` / `error`
 * reactive refs and surfaces failures through the toast store.
 *
 * @example
 * ```ts
 * const { loading, error, call } = useApi<HealthData>()
 * const data = await call('/api/v1/health')
 * ```
 */

import { ref } from 'vue'
import { useToastStore } from '@/stores/toast'

/**
 * Options forwarded to the underlying `fetch` call with an extra `silent`
 * flag to suppress the automatic error toast.
 */
export interface ApiCallOptions extends RequestInit {
  /** When `true`, errors are NOT shown in a toast (still sets `error` ref). */
  silent?: boolean
}

/**
 * Creates a stateful API client bound to the current component's lifecycle.
 *
 * @template T - Expected shape of the JSON response.
 */
export function useApi<T = unknown>() {
  const loading = ref(false)
  const error   = ref<string | null>(null)
  const toast   = useToastStore()

  /**
   * Performs a `fetch` request and returns the parsed JSON body.
   *
   * @param url     - Absolute or relative URL.
   * @param options - Optional fetch + useApi options.
   * @returns Parsed response body, or `null` on error.
   */
  async function call(url: string, options: ApiCallOptions = {}): Promise<T | null> {
    const { silent = false, ...fetchOpts } = options
    loading.value = true
    error.value   = null

    try {
      const r = await fetch(url, fetchOpts)

      if (!r.ok) {
        const payload = await r.json().catch(() => ({ error: `HTTP ${r.status}` }))
        throw new Error((payload as { error?: string }).error ?? `HTTP ${r.status}`)
      }

      return (await r.json()) as T
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      error.value = msg
      if (!silent) toast.error('Request failed', msg)
      return null
    } finally {
      loading.value = false
    }
  }

  /**
   * Convenience wrapper for JSON PATCH / POST mutations.
   *
   * @param url     - Endpoint URL.
   * @param body    - Object to serialise as JSON.
   * @param method  - HTTP method (default `'POST'`).
   */
  async function mutate(
    url: string,
    body: unknown,
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'POST',
  ): Promise<T | null> {
    return call(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
  }

  return { loading, error, call, mutate }
}
