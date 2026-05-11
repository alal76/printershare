// Beta test version v1.2.0
/**
 * @composable useConfirm
 * @description Programmatic confirmation dialog composable.  Provides an
 * accessible alternative to `globalThis.confirm()` that integrates with the
 * app's design system.
 *
 * Usage pattern
 * ─────────────
 * 1. Create an instance with `useConfirm()` in a parent component.
 * 2. Render `<ConfirmModal v-bind="confirmState" />` in the template.
 * 3. Call `await confirm('Are you sure?')` anywhere in child components via
 *    provide / inject or a shared store.
 *
 * @example
 * ```ts
 * const { pending, confirm, answer } = useConfirm()
 *
 * // In a delete handler:
 * if (!(await confirm(`Delete "${file.name}"?`))) return
 * await deleteFile(file.name)
 * ```
 */

import { ref } from 'vue'

export interface ConfirmPending {
  /** Message displayed to the user. */
  message: string
  /** Resolve function from the pending Promise. */
  resolve:  (value: boolean) => void
}

/**
 * Creates a single confirm-dialog controller.
 *
 * Only one dialog can be pending at a time; a second call will immediately
 * resolve the previous one with `false`.
 */
export function useConfirm() {
  const pending = ref<ConfirmPending | null>(null)

  /**
   * Show a confirmation dialog and wait for the user's response.
   *
   * @param message - Text to display in the dialog body.
   * @returns `true` if the user confirmed, `false` otherwise.
   */
  function confirm(message: string): Promise<boolean> {
    // Dismiss any previously unanswered dialog
    if (pending.value) {
      pending.value.resolve(false)
    }

    return new Promise<boolean>(resolve => {
      pending.value = { message, resolve }
    })
  }

  /**
   * Programmatically answer the pending dialog.
   *
   * Called by the `<ConfirmModal>` component's confirm/cancel buttons.
   *
   * @param value - `true` = confirmed, `false` = cancelled.
   */
  function answer(value: boolean): void {
    pending.value?.resolve(value)
    pending.value = null
  }

  return { pending, confirm, answer }
}
