import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { GutterBar } from '#/components/PdfViewer'
import {
  DEFAULT_SETTINGS,
  boxStyle,
  gutterStyle,
  saveSettings,
  showsParagraph,
  showsWord,
  useSettings,
  wordStyle,
} from '#/lib/settings'
import type { HighlightColor, HighlightMode, HighlightStyle, SeekScope, Settings } from '#/lib/settings'
import { MAX_NAME_LENGTH, cleanName, fetchMe, setMyName } from '#/server/fns'
import type { Me } from '#/server/fns'

export const Route = createFileRoute('/settings')({
  // Settings live in localStorage; render on the client only.
  ssr: false,
  loader: () => fetchMe(),
  head: () => ({ meta: [{ title: 'Settings · Reader Sensei' }] }),
  component: SettingsPage,
})

const SWATCHES = ['#fbbf24', '#fb923c', '#fb7185', '#a78bfa', '#38bdf8', '#34d399', '#ffffff']

const MODES: { value: HighlightMode; label: string }[] = [
  { value: 'paragraph', label: 'Paragraph' },
  { value: 'word', label: 'Word' },
  { value: 'both', label: 'Both' },
]

const STYLES: { value: HighlightStyle; label: string; hint: string }[] = [
  { value: 'box', label: 'Box', hint: 'Tinted box around the paragraph' },
  { value: 'gutter', label: 'Gutter', hint: 'Bar in the left margin' },
]

const SEEK_SCOPES: { value: SeekScope; label: string }[] = [
  { value: 'book', label: 'Whole book' },
  { value: 'chapter', label: 'Current chapter' },
]

const SAMPLE = [
  'The morning light spilled across the wheat fields, and the village slowly stirred to life.',
  'I climbed onto the chair by the window, as I usually did, to get a better look at the world outside. My father was in the yard again, swinging his sword in slow, careful arcs.',
  'Somewhere behind me, my mother hummed a tune I didn’t recognize.',
]
/** Which word of the middle sample paragraph is shown as "being spoken". */
const SAMPLE_WORD = 11

function SettingsPage() {
  const settings = useSettings()
  const router = useRouter()

  const update = (patch: Partial<Settings>) => saveSettings({ ...settings, ...patch })
  const back = () => (window.history.length > 1 ? router.history.back() : router.navigate({ to: '/' }))

  return (
    <div className="min-h-dvh">
      <header className="flex items-center gap-2 border-b border-white/10 px-3 py-2 sm:px-4">
        <button
          type="button"
          onClick={back}
          className="rounded-md p-1.5 text-zinc-400 hover:bg-white/5 hover:text-white"
          title="Back"
        >
          <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
            <path d="M12.5 4.5 7 10l5.5 5.5" />
          </svg>
        </button>
        <h1 className="text-sm font-medium">Settings</h1>
        <Link to="/" className="ml-auto rounded-md px-2 py-1 text-sm text-zinc-400 hover:bg-white/5 hover:text-white">
          Library
        </Link>
      </header>

      <main className="mx-auto max-w-2xl space-y-8 px-4 py-6 sm:py-10">
        <NameSection me={Route.useLoaderData()} />

        <section>
          <h2 className="text-base font-semibold">Highlight</h2>
          <p className="mt-1 text-sm text-zinc-400">What follows the narration. Saved on this device.</p>
          <div
            className="mt-4 grid grid-cols-3 gap-1 rounded-lg bg-white/5 p-1 ring-1 ring-white/10"
            role="radiogroup"
            aria-label="Highlight mode"
          >
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={settings.mode === m.value}
                onClick={() => update({ mode: m.value })}
                className={`rounded-md py-2 text-sm font-medium transition ${
                  settings.mode === m.value ? 'bg-amber-400 text-zinc-950' : 'text-zinc-300 hover:bg-white/5'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="mt-4 rounded-lg bg-black px-8 py-6 ring-1 ring-white/5 sm:px-12">
            <SamplePage settings={settings} />
          </div>
        </section>

        {showsParagraph(settings) && (
          <section>
            <h2 className="text-base font-semibold">Paragraph</h2>
            <div className="mt-4 grid grid-cols-2 gap-3" role="radiogroup" aria-label="Paragraph style">
              {STYLES.map((s) => {
                const selected = settings.highlight === s.value
                return (
                  <button
                    key={s.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => update({ highlight: s.value })}
                    className={`rounded-xl p-3 text-left ring-1 transition ${
                      selected ? 'bg-white/5 ring-amber-400/70' : 'ring-white/10 hover:bg-white/[0.03]'
                    }`}
                  >
                    <div className="pointer-events-none rounded-md bg-black px-4 py-3 ring-1 ring-white/5" aria-hidden>
                      <SamplePage settings={{ ...settings, mode: 'paragraph', highlight: s.value }} small />
                    </div>
                    <span className="mt-3 block text-sm font-medium">{s.label}</span>
                    <span className="block text-xs text-zinc-500">{s.hint}</span>
                  </button>
                )
              })}
            </div>
            <ColorControls
              label={settings.highlight === 'box' ? 'Box' : 'Gutter'}
              value={settings[settings.highlight]}
              onChange={(v) => update({ [settings.highlight]: v } as Partial<Settings>)}
            />
          </section>
        )}

        {showsWord(settings) && (
          <section>
            <h2 className="text-base font-semibold">Word</h2>
            <p className="mt-1 text-sm text-zinc-400">
              The word being spoken. Timing comes from the transcript, so it can be a fraction of a second off.
            </p>
            <ColorControls label="Word" value={settings.word} onChange={(word) => update({ word })} />
          </section>
        )}

        <section>
          <h2 className="text-base font-semibold">Seek bar</h2>
          <p className="mt-1 text-sm text-zinc-400">
            What the player’s seek bar and times cover. Saved on this device.
          </p>
          <div
            className="mt-4 grid grid-cols-2 gap-1 rounded-lg bg-white/5 p-1 ring-1 ring-white/10"
            role="radiogroup"
            aria-label="Seek bar span"
          >
            {SEEK_SCOPES.map((m) => (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={settings.seekScope === m.value}
                onClick={() => update({ seekScope: m.value })}
                className={`rounded-md py-2 text-sm font-medium transition ${
                  settings.seekScope === m.value ? 'bg-amber-400 text-zinc-950' : 'text-zinc-300 hover:bg-white/5'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </section>

        <button
          type="button"
          onClick={() => saveSettings(DEFAULT_SETTINGS)}
          className="text-sm text-zinc-400 underline-offset-4 hover:text-white hover:underline"
        >
          Reset to defaults
        </button>
      </main>
    </div>
  )
}

function NameSection({ me }: { me: Me }) {
  const router = useRouter()
  const user = me.user
  const [name, setName] = useState(user?.nickname ?? '')
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  if (!user) return null
  const changed = cleanName(name) !== (user.nickname ?? '')

  return (
    <section>
      <h2 className="text-base font-semibold">Your name</h2>
      <p className="mt-1 text-sm text-zinc-400">
        {me.authEnabled
          ? `Shown in the menu and to admins. Leave empty to use your Google name (${user.accountName}).`
          : 'Leave empty for “You”. If Google login is turned on later, it carries over to the first admin.'}
      </p>
      <form
        className="mt-4 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault()
          setState('saving')
          try {
            await setMyName({ data: { name } })
            setName(cleanName(name))
            await router.invalidate()
            setState('saved')
          } catch {
            setState('error')
          }
        }}
      >
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setState('idle')
          }}
          maxLength={MAX_NAME_LENGTH}
          placeholder={user.accountName}
          aria-label="Your name"
          className="min-w-0 flex-1 rounded-lg bg-white/5 px-3 py-2 text-sm ring-1 ring-white/10 placeholder:text-zinc-600 focus:ring-amber-400/60 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!changed || state === 'saving'}
          className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-300 disabled:opacity-40"
        >
          {state === 'saving' ? 'Saving…' : 'Save'}
        </button>
      </form>
      {state === 'saved' && <p className="mt-2 text-xs text-zinc-500">Saved.</p>}
      {state === 'error' && <p className="mt-2 text-xs text-rose-300">Couldn’t save. Try again.</p>}
    </section>
  )
}

function ColorControls({
  label,
  value,
  onChange,
}: {
  label: string
  value: HighlightColor
  onChange: (v: HighlightColor) => void
}) {
  const color = value.color.toLowerCase()
  const custom = !SWATCHES.includes(color)
  const id = `opacity-${label.toLowerCase()}`
  return (
    <div className="mt-4 space-y-5 rounded-xl p-4 ring-1 ring-white/10">
      <div>
        <div className="text-sm font-medium">{label} color</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChange({ ...value, color: c })}
              title={c}
              aria-label={`${label} color ${c}`}
              aria-pressed={color === c}
              className={`size-8 rounded-full ring-offset-2 ring-offset-zinc-950 transition ${
                color === c ? 'ring-2 ring-white' : 'ring-1 ring-white/20 hover:scale-110'
              }`}
              style={{ background: c }}
            />
          ))}
          <label
            className={`relative grid size-8 cursor-pointer place-items-center overflow-hidden rounded-full ring-offset-2 ring-offset-zinc-950 ${
              custom ? 'ring-2 ring-white' : 'ring-1 ring-white/20'
            }`}
            title="Custom color"
            style={{
              background: custom ? value.color : 'conic-gradient(#f87171, #fbbf24, #34d399, #38bdf8, #a78bfa, #f87171)',
            }}
          >
            <input
              type="color"
              value={value.color}
              onChange={(e) => onChange({ ...value, color: e.target.value })}
              className="absolute inset-0 cursor-pointer opacity-0"
              aria-label={`Custom ${label.toLowerCase()} color`}
            />
          </label>
        </div>
      </div>
      <div>
        <div className="flex items-baseline justify-between">
          <label htmlFor={id} className="text-sm font-medium">
            {label} opacity
          </label>
          <span className="text-xs text-zinc-400 tabular-nums">{Math.round(value.opacity * 100)}%</span>
        </div>
        <input
          id={id}
          type="range"
          min={0.05}
          max={1}
          step={0.01}
          value={value.opacity}
          onChange={(e) => onChange({ ...value, opacity: Number(e.target.value) })}
          className="mt-2 w-full cursor-pointer accent-amber-400"
        />
      </div>
    </div>
  )
}

/** A few paragraphs on a dark page, the middle one highlighted exactly like in the reader. */
function SamplePage({ settings, small = false }: { settings: Settings; small?: boolean }) {
  const box = boxStyle(settings)
  const gutter = gutterStyle(settings)
  const word = wordStyle(settings)
  return (
    <div className={`space-y-2 text-zinc-300 ${small ? 'text-[5px] leading-[7px]' : 'text-sm leading-relaxed'}`}>
      {SAMPLE.map((text, i) => (
        <div
          key={i}
          className="relative -mx-1 rounded-md px-1 py-1 transition-[background-color,box-shadow] duration-300"
          style={i === 1 ? box : undefined}
        >
          {i === 1 && gutter && <GutterBar style={gutter} scale={small ? 0.3 : 1} />}
          <p className="indent-6">
            {i === 1 && word
              ? text.split(' ').map((w, k) => (
                  <span key={k}>
                    {k > 0 && ' '}
                    <span className={k === SAMPLE_WORD ? '-mx-0.5 rounded-[3px] px-0.5' : undefined} style={k === SAMPLE_WORD ? word : undefined}>
                      {w}
                    </span>
                  </span>
                ))
              : text}
          </p>
        </div>
      ))}
    </div>
  )
}
