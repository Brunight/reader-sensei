import { Link, createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChapterMenu } from '#/components/ChapterMenu'
import { PageView, usePdfDocument } from '#/components/PdfViewer'
import type { PageRect } from '#/components/PdfViewer'
import { ICONS, Icon, PlayerBar, RATES } from '#/components/PlayerBar'
import { WakeLockNotice, canKeepAwake } from '#/components/WakeLockNotice'
import { boxStyle, gutterStyle, showsWord, useSettings, wordStyle } from '#/lib/settings'
import { formatTime } from '#/lib/format'
import { load, store } from '#/lib/storage'
import type { Chapter, Paragraph, Progress } from '#/lib/types'
import { useActiveWord, useWords } from '#/lib/useWords'
import { fetchBook } from '#/server/fns'

export const Route = createFileRoute('/books/$series/$volume')({
  // pdf.js and <audio> are browser-only; skip SSR for the reader.
  ssr: false,
  loader: ({ params }) => fetchBook({ data: { series: params.series, volume: params.volume } }),
  head: ({ loaderData }) => ({ meta: [{ title: loaderData?.sync.title ?? 'Reader' }] }),
  component: Reader,
})

const PAGE_GAP = 16
const TOP_PAD = 16
/** Page width when zoom is 100%: the screen width, capped for comfortable reading on desktop. */
const FIT_MAX = 800
/** Multipliers of the fit width. Above 1 the page overflows the screen and its wide margins are cropped. */
const ZOOMS = [0.5, 0.6, 0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2]
const DEFAULT_ZOOM = ZOOMS.indexOf(1)
const SAVE_EVERY_MS = 10_000
/** Floating round buttons over the page in fullscreen. */
const focusBtn =
  'grid size-10 place-items-center rounded-full text-zinc-300 shadow-lg shadow-black/40 ring-1 ring-white/10 backdrop-blur'

/** Index of the last item with start <= t (or -1). */
function lastStartingBefore<T extends { start: number }>(items: T[], t: number): number {
  let lo = 0
  let hi = items.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (items[mid].start <= t) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

/** When narration reaches page segment `k` of a paragraph. Older sync files lack per-segment
 *  times, so those fall back to splitting the paragraph's duration by segment height. */
function segmentStart(p: Paragraph, k: number): number {
  const r = p.rects[k]
  if (r.start != null) return r.start
  const heights = p.rects.map((x) => x.y1 - x.y0)
  const total = heights.reduce((a, b) => a + b, 0) || 1
  const before = heights.slice(0, k).reduce((a, b) => a + b, 0)
  return p.start + ((p.end - p.start) * before) / total
}

// On phones/tablets, fullscreen reading is landscape. Orientation locks only work while
// fullscreen (Android Chrome; unsupported on iOS), and the browser drops the lock on exit,
// so leaving fullscreen by any means (button, back gesture) returns to portrait.
type LockableOrientation = ScreenOrientation & { lock?: (o: 'landscape' | 'portrait') => Promise<void> }
const isTouch = () => window.matchMedia('(pointer: coarse)').matches

async function enterReadingFullscreen() {
  try {
    await document.documentElement.requestFullscreen()
    if (isTouch()) await (screen.orientation as LockableOrientation).lock?.('landscape').catch(() => {})
  } catch {
    // fullscreen refused (e.g. not triggered by a user gesture)
  }
}

async function exitReadingFullscreen() {
  const orientation = screen.orientation as LockableOrientation
  const touch = isTouch()
  try {
    if (touch) await orientation.lock?.('portrait').catch(() => {})
    await document.exitFullscreen()
    if (touch) orientation.unlock?.()
  } catch {
    // already left fullscreen
  }
}

function Reader() {
  const { series, volume } = Route.useParams()
  const { sync, progress: serverProgress, storageUser } = Route.useLoaderData()
  // Key for saved progress (matches the server's "<series>/<volume>" book id).
  const bookId = `${series}/${volume}`
  const progressKey = storageUser ? `progress:${storageUser}:${bookId}` : `progress:${bookId}`
  const { paragraphs, chapters, pages } = sync
  const bookPath = `${encodeURIComponent(series)}/${encodeURIComponent(volume)}`
  const api = `/api/books/${bookPath}`
  const { doc, error: pdfError } = usePdfDocument(`${api}/pdf`)

  const initialTime = useMemo(() => {
    const local = load<Progress | null>(progressKey, null)
    const best = [local, serverProgress]
      .filter((p): p is Progress => p != null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
    return best?.time ?? 0
  }, [progressKey, serverProgress])

  const audioRef = useRef<HTMLAudioElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  // Where a follow animation started; those pages stay rendered until it ends.
  const animFrom = useRef<number | null>(null)
  const [time, setTime] = useState(initialTime)
  const [duration, setDuration] = useState(sync.duration)
  const [playing, setPlaying] = useState(false)
  const [rate, setRate] = useState(() => load('rate', 1))
  const [follow, setFollow] = useState(true)
  const [zoomIdx, setZoomIdx] = useState(() => {
    const saved = load('zoomIdx', DEFAULT_ZOOM)
    return saved >= 0 && saved < ZOOMS.length ? saved : DEFAULT_ZOOM
  })
  const setZoom = (next: number) => {
    const idx = Math.max(0, Math.min(ZOOMS.length - 1, next))
    setZoomIdx(idx)
    store('zoomIdx', idx)
  }
  const [containerWidth, setContainerWidth] = useState(0)
  const [range, setRange] = useState<[number, number]>([0, 2])
  const [fullscreen, setFullscreen] = useState(false)
  // On touch devices, fullscreen can hide the header and player bar for distraction-free reading.
  const [uiHidden, setUiHidden] = useState(false)
  const canFullscreen = typeof document !== 'undefined' && document.fullscreenEnabled

  useEffect(() => {
    const onChange = () => {
      const on = document.fullscreenElement != null
      setFullscreen(on)
      if (!on) setUiHidden(false)
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFullscreen = useCallback(() => {
    void (document.fullscreenElement ? exitReadingFullscreen() : enterReadingFullscreen())
  }, [])

  // Leaving the reader (back button, browser back) also leaves fullscreen and landscape.
  useEffect(
    () => () => {
      if (document.fullscreenElement) void exitReadingFullscreen()
    },
    [],
  )

  // ----- layout -----
  const fitWidth = Math.max(200, Math.min(FIT_MAX, containerWidth - 24))
  const width = Math.round(fitWidth * ZOOMS[zoomIdx])
  const layout = useMemo(() => {
    let y = TOP_PAD
    return pages.map(([w, h]) => {
      const scale = width / w
      const item = { top: y, height: h * scale, scale }
      y += item.height + PAGE_GAP
      return item
    })
  }, [pages, width])
  const totalHeight = layout.length ? layout[layout.length - 1].top + layout[layout.length - 1].height + TOP_PAD : 0

  // Keep the reading position when the zoom changes, and center the (overflowing) page horizontally.
  const prevHeight = useRef(0)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || !totalHeight) return
    if (prevHeight.current) el.scrollTop *= totalHeight / prevHeight.current
    prevHeight.current = totalHeight
    el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2
  }, [totalHeight, width])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setContainerWidth(el.clientWidth))
    ro.observe(el)
    setContainerWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const rectsByPage = useMemo(() => {
    const map: PageRect[][] = pages.map(() => [])
    for (const p of paragraphs) for (const rect of p.rects) map[rect.page]?.push({ id: p.id, rect })
    return map
  }, [pages, paragraphs])

  const updateRange = useCallback(() => {
    const el = scrollRef.current
    if (!el || !layout.length) return
    const from = animFrom.current ?? el.scrollTop
    const lo = Math.min(el.scrollTop, from) - el.clientHeight
    const hi = Math.max(el.scrollTop, from) + el.clientHeight * 2
    let first = layout.findIndex((p) => p.top + p.height >= lo)
    if (first < 0) first = layout.length - 1
    let last = first
    while (last + 1 < layout.length && layout[last + 1].top <= hi) last++
    setRange((r) => (r[0] === first && r[1] === last ? r : [first, last]))
  }, [layout])

  useEffect(updateRange, [updateRange, containerWidth])

  // ----- current paragraph / chapter -----
  const chapterIdx = Math.max(0, lastStartingBefore(chapters, time + 0.01))
  const activeIdx = useMemo(() => {
    // While a chapter's title is read, before its first paragraph starts, show that paragraph
    // rather than the end of the previous chapter.
    const chapter = chapters[chapterIdx]
    if (chapter?.firstParagraphId != null && time >= chapter.start) {
      const first = paragraphs.findIndex((p) => p.id === chapter.firstParagraphId)
      if (first >= 0 && time < paragraphs[first].start) return first
    }
    const i = lastStartingBefore(paragraphs, time)
    return i >= 0 && time < paragraphs[i].end + 1 ? i : -1
  }, [chapters, chapterIdx, paragraphs, time])
  const active: Paragraph | undefined = paragraphs[activeIdx]
  // Listening time left in the current chapter, at the current speed.
  const chapterLeft = chapters[chapterIdx] ? Math.max(0, chapters[chapterIdx].end - time) / rate : null
  // Which page segment of the active paragraph is being read (paragraphs can span a page break).
  const activeSeg = useMemo(() => {
    if (!active) return 0
    let k = 0
    while (k + 1 < active.rects.length && segmentStart(active, k + 1) <= time) k++
    return k
  }, [active, time])

  // ----- auto-scroll -----
  const programmaticUntil = useRef(0)
  const scrolledOnce = useRef(false)
  const scrollAnim = useRef<Animation | null>(null)

  /** Stops a follow animation, keeping the page where it currently appears on screen. */
  const cancelScrollAnim = useCallback(() => {
    const anim = scrollAnim.current
    if (!anim) return
    scrollAnim.current = null
    animFrom.current = null
    const el = scrollRef.current
    const content = contentRef.current
    const offset = content ? new DOMMatrixReadOnly(getComputedStyle(content).transform).m42 : 0
    anim.cancel()
    if (el) el.scrollTop -= offset
  }, [])

  const scrollToSegment = useCallback(
    (p: Paragraph, seg: number, smooth: boolean) => {
      const el = scrollRef.current
      const content = contentRef.current
      const r = p.rects[seg] ?? p.rects[0]
      const pg = layout[r.page]
      if (!el || !content || !pg) return
      cancelScrollAnim()
      const y0 = pg.top + r.y0 * pg.scale
      const y1 = pg.top + r.y1 * pg.scale
      const target = Math.min(
        el.scrollHeight - el.clientHeight,
        Math.max(0, (y0 + y1) / 2 - el.clientHeight * 0.4),
      )
      const from = el.scrollTop
      const dist = target - from
      const far = Math.abs(dist) > el.clientHeight * 3
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      programmaticUntil.current = Date.now() + 200
      if (!smooth || far || reduceMotion || Math.abs(dist) < 1) {
        el.scrollTop = target
        return
      }
      // Jump to the target, then slide the pages over from where they were. A transform
      // animation runs on the compositor at the display's refresh rate, unaffected by the
      // main-thread work during playback (word highlighting, pdf.js drawing pages). The
      // browser's own smooth scroll finishes short distances in ~100 ms, which reads as a jump.
      const duration = Math.min(900, 350 + Math.sqrt(Math.abs(dist)) * 20)
      animFrom.current = from
      el.scrollTop = target
      updateRange()
      const anim = content.animate([{ transform: `translateY(${dist}px)` }, { transform: 'none' }], {
        duration,
        easing: 'cubic-bezier(0.65, 0, 0.35, 1)',
      })
      scrollAnim.current = anim
      anim.onfinish = () => {
        if (scrollAnim.current !== anim) return
        scrollAnim.current = null
        animFrom.current = null
        updateRange()
      }
    },
    [layout, cancelScrollAnim, updateRange],
  )

  useEffect(() => cancelScrollAnim, [cancelScrollAnim])

  useEffect(() => {
    if (!active || !follow || !containerWidth) return
    scrollToSegment(active, activeSeg, scrolledOnce.current)
    scrolledOnce.current = true
    // uiHidden: the viewport height changes, so re-center the current paragraph.
  }, [active, activeSeg, follow, containerWidth, scrollToSegment, uiHidden])

  // Any manual scrolling pauses following until "Back to narration".
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const stop = () => {
      if (Date.now() > programmaticUntil.current) setFollow(false)
    }
    // A running follow animation would fight the user's finger or wheel; they take over.
    const takeOver = () => {
      if (!scrollAnim.current) return
      cancelScrollAnim()
      programmaticUntil.current = 0
    }
    const onKey = (e: KeyboardEvent) => {
      if (['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(e.key)) stop()
    }
    const onPointer = (e: PointerEvent) => {
      if (e.target === el) stop() // scrollbar drag
    }
    el.addEventListener('wheel', takeOver, { passive: true })
    el.addEventListener('touchstart', takeOver, { passive: true })
    el.addEventListener('wheel', stop, { passive: true })
    el.addEventListener('touchmove', stop, { passive: true })
    el.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      el.removeEventListener('wheel', takeOver)
      el.removeEventListener('touchstart', takeOver)
      el.removeEventListener('wheel', stop)
      el.removeEventListener('touchmove', stop)
      el.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [cancelScrollAnim])

  // ----- progress (resume) -----
  const lastSaved = useRef(-1)
  const saveProgress = useCallback(
    (beacon = false) => {
      const audio = audioRef.current
      if (!audio || !Number.isFinite(audio.currentTime)) return
      const t = Math.round(audio.currentTime * 10) / 10
      if (t === lastSaved.current) return
      lastSaved.current = t
      store(progressKey, { time: t, updatedAt: new Date().toISOString() })
      const url = `/api/progress/${bookPath}`
      const body = JSON.stringify({ time: t })
      if (beacon && navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))
      } else {
        fetch(url, { method: 'PUT', body, headers: { 'Content-Type': 'application/json' }, keepalive: true })
          .then((res) => {
            // Signed out or access revoked: saving would keep failing silently.
            if (res.status === 401) window.location.href = '/login'
          })
          .catch(() => {})
      }
    },
    [progressKey, bookPath],
  )

  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => saveProgress(), SAVE_EVERY_MS)
    return () => clearInterval(id)
  }, [playing, saveProgress])

  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && saveProgress(true)
    const onPageHide = () => saveProgress(true)
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onPageHide)
      saveProgress()
    }
  }, [saveProgress])

  // ----- audio controls -----
  const seek = useCallback((t: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = Math.max(0, Math.min(t, audio.duration || t))
    setTime(audio.currentTime)
  }, [])

  const toggle = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) void audio.play()
    else audio.pause()
  }, [])

  const skip = useCallback((d: number) => seek((audioRef.current?.currentTime ?? 0) + d), [seek])

  const stepParagraph = useCallback(
    (dir: -1 | 1) => {
      const t = audioRef.current?.currentTime ?? 0
      const i = lastStartingBefore(paragraphs, t)
      let target: number
      if (dir === 1) target = i + 1
      // Like a music player: "previous" first restarts the current paragraph.
      else target = i >= 0 && t - paragraphs[i].start > 2 ? i : i - 1
      const p = paragraphs[Math.max(0, Math.min(target, paragraphs.length - 1))]
      if (p) {
        setFollow(true)
        seek(p.start)
      }
    },
    [paragraphs, seek],
  )

  const changeRate = useCallback((r: number) => {
    setRate(r)
    store('rate', r)
  }, [])

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate
  }, [rate])

  const onParagraphClick = useCallback(
    (id: number) => {
      const p = paragraphs.find((x) => x.id === id)
      if (!p) return
      setFollow(true)
      seek(p.start)
    },
    [paragraphs, seek],
  )

  const goToChapter = useCallback(
    (c: Chapter) => {
      setFollow(true)
      seek(c.start)
    },
    [seek],
  )

  // ----- keyboard shortcuts -----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return
      const idx = RATES.indexOf(rate)
      if (e.key === ' ' || e.key === 'k') toggle()
      else if (e.key === 'ArrowLeft') e.shiftKey ? stepParagraph(-1) : skip(-15)
      else if (e.key === 'ArrowRight') e.shiftKey ? stepParagraph(1) : skip(15)
      else if (e.key === '[') changeRate(RATES[Math.max(0, idx - 1)] ?? 1)
      else if (e.key === ']') changeRate(RATES[Math.min(RATES.length - 1, idx + 1)] ?? 1)
      else if (e.key === 'f' || e.key === 'F') setFollow((f) => !f)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rate, toggle, skip, stepParagraph, changeRate])

  // ----- keep the screen on while playing -----
  // The browser drops the lock when the tab is hidden, so it's re-requested on return.
  // Wake Lock needs a secure context (HTTPS or localhost); otherwise WakeLockNotice explains the fix.
  useEffect(() => {
    if (!playing || !canKeepAwake()) return
    let lock: WakeLockSentinel | null = null
    let cancelled = false
    const request = async () => {
      if (document.visibilityState !== 'visible' || (lock && !lock.released)) return
      try {
        const next = await navigator.wakeLock.request('screen')
        if (cancelled) void next.release()
        else lock = next
      } catch {
        // denied (e.g. battery saver)
      }
    }
    void request()
    document.addEventListener('visibilitychange', request)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', request)
      void lock?.release()
    }
  }, [playing])

  // ----- media session (headphones, lock screen) -----
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: chapters[chapterIdx]?.title ?? sync.title,
      album: sync.title,
      artwork: [{ src: `${api}/cover` }],
    })
  }, [api, chapterIdx, chapters, sync.title])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    const audio = () => audioRef.current
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => void audio()?.play()],
      ['pause', () => audio()?.pause()],
      ['seekbackward', (d) => skip(-(d.seekOffset ?? 15))],
      ['seekforward', (d) => skip(d.seekOffset ?? 15)],
      ['seekto', (d) => d.seekTime != null && seek(d.seekTime)],
      ['previoustrack', () => goToChapter(chapters[Math.max(0, chapterIdx - 1)])],
      ['nexttrack', () => goToChapter(chapters[Math.min(chapters.length - 1, chapterIdx + 1)])],
    ]
    for (const [action, handler] of handlers) {
      try {
        ms.setActionHandler(action, handler)
      } catch {
        // unsupported action
      }
    }
  }, [chapterIdx, chapters, goToChapter, seek, skip])

  const activeId = active?.id ?? null
  const settings = useSettings()
  const highlight = useMemo(
    () => ({ box: boxStyle(settings), gutter: gutterStyle(settings), word: wordStyle(settings) }),
    [settings],
  )
  const words = useWords(`${api}/words`, showsWord(settings))
  const wordIdx = useActiveWord(words, audioRef, playing, time)
  const activeWord = words && wordIdx >= 0 ? words[wordIdx] : null
  const activePages = useMemo(() => new Set(active?.rects.map((r) => r.page)), [active])

  return (
    <div className="flex h-dvh flex-col">
      <header className={`${uiHidden ? 'hidden' : 'flex'} items-center gap-2 border-b border-white/10 px-3 py-2 sm:px-4`}>
        <Link to="/" className="rounded-md p-1.5 text-zinc-400 hover:bg-white/5 hover:text-white" title="Library">
          <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
            <path d="M12.5 4.5 7 10l5.5 5.5" />
          </svg>
        </Link>
        <h1 className="hidden min-w-0 truncate text-sm font-medium sm:block">{sync.title}</h1>
        <div className="ml-auto flex min-w-0 items-center gap-1">
          <ChapterMenu chapters={chapters} current={chapterIdx} onSelect={goToChapter} />
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => setZoom(zoomIdx - 1)}
              disabled={zoomIdx === 0}
              className="rounded-md px-2 py-1 text-zinc-400 hover:bg-white/5 hover:text-white disabled:opacity-30"
              title="Zoom out"
            >
              −
            </button>
            <button
              type="button"
              onClick={() => setZoom(DEFAULT_ZOOM)}
              className="w-11 rounded-md py-1 text-center text-xs text-zinc-400 tabular-nums hover:bg-white/5 hover:text-white"
              title="Reset zoom"
            >
              {Math.round(ZOOMS[zoomIdx] * 100)}%
            </button>
            <button
              type="button"
              onClick={() => setZoom(zoomIdx + 1)}
              disabled={zoomIdx === ZOOMS.length - 1}
              className="rounded-md px-2 py-1 text-zinc-400 hover:bg-white/5 hover:text-white disabled:opacity-30"
              title="Zoom in"
            >
              +
            </button>
          </div>
          {canFullscreen && (
            <button
              type="button"
              onClick={toggleFullscreen}
              className="rounded-md p-1.5 text-zinc-400 hover:bg-white/5 hover:text-white"
              title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                <path d={fullscreen ? 'M8 3v5H3M12 3v5h5M8 17v-5H3M12 17v-5h5' : 'M3 8V3h5M17 8V3h-5M3 12v5h5M17 12v5h-5'} />
              </svg>
            </button>
          )}
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={updateRange}
          className="h-full overflow-auto overscroll-contain pointer-fine:[scrollbar-color:#3f3f46_transparent]"
        >
          {pdfError ? (
            <p className="p-8 text-center text-red-400">Could not load PDF: {pdfError}</p>
          ) : (
            <div ref={contentRef} className="relative mx-auto" style={{ width, height: totalHeight }}>
              {layout.map((pg, i) => (
                <PageView
                  key={i}
                  doc={doc}
                  index={i}
                  top={pg.top}
                  width={width}
                  height={pg.height}
                  scale={pg.scale}
                  render={i >= range[0] && i <= range[1]}
                  rects={rectsByPage[i]}
                  activeId={activePages.has(i) ? activeId : null}
                  highlight={highlight}
                  word={activeWord && activeWord[0] === i ? activeWord : null}
                  onSeek={onParagraphClick}
                />
              ))}
            </div>
          )}
        </div>
        {!follow && (
          <button
            type="button"
            onClick={() => setFollow(true)}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-amber-400 px-4 py-2 text-sm font-medium text-zinc-950 shadow-lg shadow-black/40 hover:bg-amber-300"
          >
            Back to narration
          </button>
        )}
        <WakeLockNotice playing={playing} />
        {fullscreen && (
          <div className="absolute right-3 bottom-3 hidden flex-col items-end gap-2 pointer-coarse:flex">
            {chapterLeft != null && (
              <div
                className={`pointer-events-none text-sm text-zinc-200 tabular-nums drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] ${uiHidden ? 'opacity-80' : ''}`}
                title="Time left in this chapter"
              >
                -{formatTime(chapterLeft)}
              </div>
            )}
            <div className="flex items-center gap-2">
              {/* With the player bar hidden, play/pause stays in reach. */}
              {uiHidden && (
                <button
                  type="button"
                  onClick={toggle}
                  title={playing ? 'Pause' : 'Play'}
                  className={`${focusBtn} bg-zinc-900/50 opacity-60`}
                >
                  <Icon d={playing ? ICONS.pause : ICONS.play} />
                </button>
              )}
              <button
                type="button"
                onClick={() => setUiHidden((h) => !h)}
                title={uiHidden ? 'Show controls' : 'Hide controls'}
                className={`${focusBtn} ${uiHidden ? 'bg-zinc-900/50 opacity-60' : 'bg-zinc-900/90'}`}
              >
                <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  {uiHidden ? (
                    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
                  ) : (
                    <path d="M3 3l18 18M10.6 5.6A9.9 9.9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.8M6.4 6.9A17.6 17.6 0 0 0 2.5 12S6 18.5 12 18.5a9.4 9.4 0 0 0 4.3-1M9.9 9.9a3 3 0 0 0 4.2 4.2" />
                  )}
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>

      <div className={uiHidden ? 'hidden' : undefined}>
        <PlayerBar
          time={time}
          duration={duration}
          playing={playing}
          rate={rate}
          chapters={chapters}
          chapterIdx={chapterIdx}
          onToggle={toggle}
          onSeek={seek}
          onSkip={skip}
          onParagraph={stepParagraph}
          onRate={changeRate}
        />
      </div>

      <audio
        ref={audioRef}
        src={`${api}/audio`}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const a = e.currentTarget
          setDuration(a.duration)
          a.playbackRate = rate
          if (initialTime > 0 && a.currentTime < 1) a.currentTime = initialTime
          setTime(a.currentTime)
        }}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onSeeked={(e) => {
          setTime(e.currentTarget.currentTime)
          saveProgress()
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => {
          setPlaying(false)
          saveProgress()
        }}
        onEnded={() => setPlaying(false)}
      />
    </div>
  )
}
