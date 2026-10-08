import { formatTime } from '#/lib/format'
import { useSettings } from '#/lib/settings'
import type { Chapter } from '#/lib/types'

export const RATES = [0.75, 1, 1.1, 1.15, 1.25, 1.5, 1.75, 2, 2.5]

interface Props {
  time: number
  duration: number
  playing: boolean
  rate: number
  chapters: Chapter[]
  chapterIdx: number
  onToggle: () => void
  onSeek: (time: number) => void
  onSkip: (delta: number) => void
  onParagraph: (dir: -1 | 1) => void
  onRate: (rate: number) => void
}

export function Icon({ d, className = 'size-5' }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} fill-current`} aria-hidden>
      <path d={d} />
    </svg>
  )
}

export const ICONS = {
  play: 'M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z',
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  back: 'M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8Z',
  fwd: 'M12 5V2l5 4-5 4V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8Z',
  prev: 'M6 6h2v12H6zm3.5 6 8.5 6V6z',
  next: 'M16 6h2v12h-2zM6 18l8.5-6L6 6z',
}

const btn = 'grid place-items-center rounded-full text-zinc-300 hover:bg-white/10 hover:text-white active:scale-95'

export function PlayerBar({
  time,
  duration,
  playing,
  rate,
  chapters,
  chapterIdx,
  onToggle,
  onSeek,
  onSkip,
  onParagraph,
  onRate,
}: Props) {
  const nextRate = () => onRate(RATES[(RATES.indexOf(rate) + 1) % RATES.length] ?? 1)
  // The span the seek bar and times cover: the whole book, or just the current chapter.
  const chapter = useSettings().seekScope === 'chapter' ? chapters[chapterIdx] : undefined
  const start = chapter?.start ?? 0
  const end = chapter ? Math.min(chapter.end, duration || chapter.end) : duration
  const length = Math.max(0, end - start)
  const elapsed = Math.max(0, Math.min(time - start, length))

  return (
    <div className="border-t border-white/10 bg-zinc-950/95 px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
      <div className="mx-auto max-w-3xl">
        <div className="relative h-5">
          {!chapter &&
            duration > 0 &&
            chapters.slice(1).map((c, i) => (
              <span
                key={i}
                className="pointer-events-none absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-zinc-600"
                style={{ left: `${(c.start / duration) * 100}%` }}
              />
            ))}
          <input
            type="range"
            min={0}
            max={length || 1}
            step={1}
            value={elapsed}
            onChange={(e) => onSeek(start + Number(e.target.value))}
            aria-label={chapter ? 'Seek in chapter' : 'Seek'}
            className="absolute inset-0 h-5 w-full cursor-pointer accent-amber-400"
          />
        </div>
        <div className="flex justify-between text-xs text-zinc-500 tabular-nums">
          <span>{formatTime(elapsed)}</span>
          <span title={`Remaining in ${chapter ? 'chapter' : 'book'} at current speed`}>
            -{formatTime((length - elapsed) / rate)}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="w-12" />
          <div className="flex flex-1 items-center justify-center gap-1 sm:gap-2">
            <button type="button" className={`${btn} size-10`} onClick={() => onParagraph(-1)} title="Previous paragraph (Shift+←)">
              <Icon d={ICONS.prev} />
            </button>
            <button type="button" className={`${btn} size-10`} onClick={() => onSkip(-15)} title="Back 15s (←)">
              <Icon d={ICONS.back} />
            </button>
            <button
              type="button"
              className="grid size-12 place-items-center rounded-full bg-amber-400 text-zinc-950 hover:bg-amber-300 active:scale-95"
              onClick={onToggle}
              title="Play/pause (Space)"
            >
              <Icon d={playing ? ICONS.pause : ICONS.play} className="size-6" />
            </button>
            <button type="button" className={`${btn} size-10`} onClick={() => onSkip(15)} title="Forward 15s (→)">
              <Icon d={ICONS.fwd} />
            </button>
            <button type="button" className={`${btn} size-10`} onClick={() => onParagraph(1)} title="Next paragraph (Shift+→)">
              <Icon d={ICONS.next} />
            </button>
          </div>
          <div className="flex w-12 items-center justify-end">
            <button
              type="button"
              onClick={nextRate}
              title="Playback speed ([ / ])"
              className="rounded-md px-1.5 py-0.5 text-xs font-medium text-zinc-300 tabular-nums ring-1 ring-white/15 hover:bg-white/10"
            >
              {rate}×
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
