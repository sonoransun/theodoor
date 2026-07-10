/**
 * ui/picker.ts — show picker: dropdown over the built-in entries, a
 * 'Load WAV…' file input, and the quiet-mode checkbox that applies an
 * 85 dB budget to WAV-generated shows.
 */

import { h } from './dom.js'

export interface PickerEntry {
  id: string
  label: string
}

export interface PickerCallbacks {
  onSelect(id: string): void
  onWav(file: File, quiet: boolean): void
}

export interface Picker {
  el: HTMLElement
  /** Non-null message shows the busy/status chip (e.g. 'Analyzing WAV…'). */
  setStatus(message: string | null): void
  /** Programmatically reflect the active entry in the dropdown. */
  setActive(id: string): void
}

export function createPicker(entries: readonly PickerEntry[], cb: PickerCallbacks): Picker {
  const select = h('select', { class: 'picker-select', title: 'Show' })
  for (const e of entries) select.append(h('option', { value: e.id }, e.label))
  select.addEventListener('change', () => cb.onSelect(select.value))

  const quietBox = h('input', { type: 'checkbox', id: 'wav-quiet' }) as HTMLInputElement
  const quietLabel = h(
    'label',
    { class: 'picker-quiet', for: 'wav-quiet', title: 'Apply an 85 dB noise budget to WAV shows' },
    quietBox,
    ' quiet 85 dB',
  )

  const fileInput = h('input', {
    type: 'file',
    accept: '.wav,audio/wav,audio/x-wav',
    class: 'picker-file',
  }) as HTMLInputElement
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0]
    if (file) cb.onWav(file, quietBox.checked)
    fileInput.value = '' // allow re-loading the same file
  })
  const wavBtn = h('button', { class: 'tb-btn picker-wav' }, 'Load WAV…')
  wavBtn.addEventListener('click', () => fileInput.click())

  const status = h('span', { class: 'picker-status', hidden: true })

  const el = h('div', { class: 'picker' }, select, wavBtn, quietLabel, fileInput, status)

  return {
    el,
    setStatus(message): void {
      if (message === null) {
        status.setAttribute('hidden', '')
        status.textContent = ''
      } else {
        status.removeAttribute('hidden')
        status.textContent = message
      }
    },
    setActive(id): void {
      select.value = id
    },
  }
}
