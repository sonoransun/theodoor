/**
 * Visualizer bootstrap — thin shell around app.ts. The app owns the picker
 * (synthetic preview / Ode to Joy engine demo / quiet variant / WAV), the
 * transport + sim + audio wiring, and all overlays; a startup failure lands
 * in a visible panel instead of a blank page.
 */
import './styles.css'
import { startApp } from './app.js'
import { h } from './ui/dom.js'

function showBootError(message: string): void {
  const fallback = document.getElementById('fallback')
  const canvas = document.getElementById('stage')
  if (canvas) canvas.setAttribute('hidden', '')
  if (!fallback) return
  fallback.removeAttribute('hidden')
  fallback.replaceChildren(
    h(
      'div',
      { class: 'fatal-card' },
      h('h1', {}, 'Visualizer failed to start'),
      h('p', {}, message),
    ),
  )
}

function boot(): void {
  const app = document.getElementById('app')
  const stage = document.getElementById('stage')
  if (!app || !(stage instanceof HTMLCanvasElement)) {
    throw new Error('index.html is missing #app / #stage mount points')
  }
  startApp(app, stage)
}

try {
  boot()
} catch (e) {
  showBootError(e instanceof Error ? e.message : String(e))
}
