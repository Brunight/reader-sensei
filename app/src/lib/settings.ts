import { useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import { load, store } from './storage'

export type HighlightStyle = 'box' | 'gutter'
/** What follows the narration: the paragraph, the word being spoken, or both. */
export type HighlightMode = 'paragraph' | 'word' | 'both'
/** What the player bar's seek bar and times span. */
export type SeekScope = 'book' | 'chapter'

export interface HighlightColor {
  /** #rrggbb */
  color: string
  /** 0..1 */
  opacity: number
}

export interface Settings {
  mode: HighlightMode
  /** Paragraph highlight style. */
  highlight: HighlightStyle
  box: HighlightColor
  gutter: HighlightColor
  word: HighlightColor
  seekScope: SeekScope
}

export const DEFAULT_SETTINGS: Settings = {
  mode: 'paragraph',
  highlight: 'box',
  box: { color: '#fbbf24', opacity: 0.12 },
  gutter: { color: '#fbbf24', opacity: 0.9 },
  word: { color: '#fbbf24', opacity: 0.35 },
  seekScope: 'book',
}

const KEY = 'settings'
const EVENT = 'settings-change'

function read(): Settings {
  const saved = load<Partial<Settings>>(KEY, {})
  return {
    mode: saved.mode === 'word' || saved.mode === 'both' ? saved.mode : 'paragraph',
    highlight: saved.highlight === 'gutter' ? 'gutter' : 'box',
    box: { ...DEFAULT_SETTINGS.box, ...saved.box },
    gutter: { ...DEFAULT_SETTINGS.gutter, ...saved.gutter },
    word: { ...DEFAULT_SETTINGS.word, ...saved.word },
    seekScope: saved.seekScope === 'chapter' ? 'chapter' : 'book',
  }
}

// useSyncExternalStore needs a stable snapshot; re-read only when settings change.
let snapshot: Settings | null = null

function subscribe(onChange: () => void) {
  const handler = () => {
    snapshot = null
    onChange()
  }
  window.addEventListener(EVENT, handler)
  window.addEventListener('storage', handler) // other tabs
  return () => {
    window.removeEventListener(EVENT, handler)
    window.removeEventListener('storage', handler)
  }
}

/** Reading preferences, stored per device (localStorage). */
export function useSettings(): Settings {
  return useSyncExternalStore(
    subscribe,
    () => (snapshot ??= read()),
    () => DEFAULT_SETTINGS,
  )
}

export function saveSettings(next: Settings) {
  store(KEY, next)
  snapshot = null
  window.dispatchEvent(new Event(EVENT))
}

export function rgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.replace('#', ''), 16)
  const a = Math.max(0, Math.min(1, alpha))
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

export const showsParagraph = (s: Settings) => s.mode !== 'word'
export const showsWord = (s: Settings) => s.mode !== 'paragraph'

/** Style for the active paragraph's box (the clickable rect around the text). */
export function boxStyle(s: Settings): CSSProperties | undefined {
  if (!showsParagraph(s) || s.highlight !== 'box') return undefined
  const { color, opacity } = s.box
  return {
    background: rgba(color, opacity),
    boxShadow: `0 0 0 1px ${rgba(color, opacity + 0.35)}, 0 0 18px ${rgba(color, opacity * 1.5)}`,
  }
}

/** Style for the gutter bar drawn in the margin, left of the active paragraph. */
export function gutterStyle(s: Settings): CSSProperties | undefined {
  if (!showsParagraph(s) || s.highlight !== 'gutter') return undefined
  return { background: rgba(s.gutter.color, s.gutter.opacity) }
}

/** Style for the box behind the word being spoken. */
export function wordStyle(s: Settings): CSSProperties | undefined {
  if (!showsWord(s)) return undefined
  const { color, opacity } = s.word
  return { background: rgba(color, opacity), boxShadow: `0 0 0 1px ${rgba(color, opacity * 0.8)}` }
}
