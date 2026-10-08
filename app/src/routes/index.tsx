import { Link, createFileRoute } from '@tanstack/react-router'
import { GitHubLink } from '#/components/GitHubLink'
import { SettingsLink } from '#/components/SettingsLink'
import { UserMenu } from '#/components/UserMenu'
import { formatAgo, formatDuration } from '#/lib/format'
import type { BookSummary, SeriesSummary } from '#/lib/types'
import { fetchBooks, fetchMe } from '#/server/fns'

export const Route = createFileRoute('/')({
  loader: async () => {
    const [series, me] = await Promise.all([fetchBooks(), fetchMe()])
    return { series, me }
  },
  component: Library,
})

function Library() {
  const { series, me } = Route.useLoaderData()
  const resume = lastRead(series)
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
        <div className="flex items-center gap-2">
          <GitHubLink />
          <SettingsLink />
          <UserMenu me={me} />
        </div>
      </div>
      {resume && <ContinueCard book={resume} />}
      {series.length === 0 ? (
        <p className="mt-6 text-zinc-400">
          No books found. Add volumes as <code className="text-zinc-300">books/&lt;book&gt;/&lt;volume&gt;/</code> with
          a PDF and an <code className="text-zinc-300">audio/*.m4b</code>.
        </p>
      ) : (
        series.map((s) => (
          <section key={s.id} className="mt-10 first-of-type:mt-8">
            <h2 className="text-lg font-semibold text-zinc-200">
              {s.name}
              <span className="ml-2 text-sm font-normal text-zinc-500">
                {s.volumes.length} {s.volumes.length === 1 ? 'volume' : 'volumes'}
              </span>
            </h2>
            <ul className="mt-4 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
              {s.volumes.map((b) => (
                <li key={b.id}>
                  {b.ready ? (
                    <Link
                      to="/books/$series/$volume"
                      params={{ series: b.series, volume: b.volume }}
                      className="group block"
                    >
                      <VolumeCard book={b} />
                    </Link>
                  ) : (
                    <div className="opacity-60">
                      <VolumeCard book={b} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </main>
  )
}

/** The most recently read volume that isn't finished yet. */
function lastRead(series: SeriesSummary[]): BookSummary | null {
  let best: BookSummary | null = null
  for (const b of series.flatMap((s) => s.volumes)) {
    if (!b.ready || !b.lastReadAt || (b.progress ?? 0) >= 0.99) continue
    if (!best || b.lastReadAt > best.lastReadAt!) best = b
  }
  return best
}

function ContinueCard({ book: b }: { book: BookSummary }) {
  const remaining = b.duration != null && b.progress != null ? b.duration * (1 - b.progress) : null
  return (
    <Link
      to="/books/$series/$volume"
      params={{ series: b.series, volume: b.volume }}
      className="group mt-8 flex items-center gap-4 rounded-xl bg-zinc-900 p-3 ring-1 ring-white/10 transition hover:bg-zinc-800/80 sm:gap-5 sm:p-4"
    >
      <div className="aspect-[210/297] w-16 shrink-0 overflow-hidden rounded-md bg-zinc-800 ring-1 ring-white/10 sm:w-20">
        {b.hasCover && (
          <img
            src={`/api/books/${encodeURIComponent(b.series)}/${encodeURIComponent(b.volume)}/cover`}
            alt=""
            className="h-full w-full object-cover"
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium tracking-wide text-amber-400 uppercase">Continue reading</p>
        <p className="mt-1 line-clamp-2 font-medium">{b.title}</p>
        <p className="mt-0.5 text-xs text-zinc-500">
          {b.progress != null && `${Math.round(b.progress * 100)}%`}
          {remaining != null && ` · ${formatDuration(remaining)} left`}
          {b.lastReadAt && ` · ${formatAgo(b.lastReadAt)}`}
        </p>
        {b.progress != null && (
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-zinc-800">
            <div className="h-full bg-amber-400" style={{ width: `${b.progress * 100}%` }} />
          </div>
        )}
      </div>
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-amber-400 text-zinc-950 transition group-hover:scale-105">
        <svg viewBox="0 0 24 24" className="ml-0.5 size-5" fill="currentColor" aria-hidden>
          <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11.04-6.86a1 1 0 0 0 0-1.72L9.5 4.28A1 1 0 0 0 8 5.14Z" />
        </svg>
        <span className="sr-only">Resume</span>
      </span>
    </Link>
  )
}

function VolumeCard({ book: b }: { book: BookSummary }) {
  return (
    <>
      <div className="relative aspect-[210/297] overflow-hidden rounded-lg bg-zinc-900 ring-1 ring-white/10">
        {b.hasCover ? (
          <img
            src={`/api/books/${encodeURIComponent(b.series)}/${encodeURIComponent(b.volume)}/cover`}
            alt=""
            className="h-full w-full object-cover transition group-hover:scale-[1.02]"
          />
        ) : (
          <div className="grid h-full place-items-center p-4 text-center text-sm text-zinc-500">{b.title}</div>
        )}
        {b.progress != null && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/60">
            <div className="h-full bg-amber-400" style={{ width: `${b.progress * 100}%` }} />
          </div>
        )}
        {!b.ready && (
          <div className="absolute inset-0 grid place-items-center bg-black/70 text-xs font-medium tracking-wide text-zinc-300 uppercase">
            Not prepared
          </div>
        )}
      </div>
      <p className="mt-2 line-clamp-2 text-sm font-medium">{b.title}</p>
      <p className="text-xs text-zinc-500">
        {b.duration != null && formatDuration(b.duration)}
        {b.progress != null && ` · ${Math.round(b.progress * 100)}%`}
        {!b.ready && 'Run prep/prep.py to sync'}
      </p>
    </>
  )
}
