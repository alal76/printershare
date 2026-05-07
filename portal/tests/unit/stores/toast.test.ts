/**
 * Unit tests for the toast store.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useToastStore } from '../../../src/stores/toast'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
})

describe('toast store', () => {
  it('adds a toast via add()', () => {
    const store = useToastStore()
    store.add({ title: 'Hello', kind: 'success', duration: 4000 })
    expect(store.toasts).toHaveLength(1)
    expect(store.toasts[0].title).toBe('Hello')
    expect(store.toasts[0].kind).toBe('success')
  })

  it('success() adds a success toast', () => {
    const store = useToastStore()
    store.success('Done')
    expect(store.toasts[0].kind).toBe('success')
    expect(store.toasts[0].title).toBe('Done')
  })

  it('error() adds an error toast with message', () => {
    const store = useToastStore()
    store.error('Oops', 'detail')
    expect(store.toasts[0].kind).toBe('error')
    expect(store.toasts[0].message).toBe('detail')
  })

  it('remove() removes the toast with the given id', () => {
    const store = useToastStore()
    store.add({ title: 'A', kind: 'info', duration: 4000 })
    const id = store.toasts[0].id
    store.remove(id)
    expect(store.toasts).toHaveLength(0)
  })

  it('auto-removes toasts after duration', () => {
    const store = useToastStore()
    store.add({ title: 'Bye', kind: 'info', duration: 1000 })
    expect(store.toasts).toHaveLength(1)
    vi.advanceTimersByTime(1100)
    expect(store.toasts).toHaveLength(0)
  })
})
