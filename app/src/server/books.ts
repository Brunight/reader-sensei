import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { BookSummary, SeriesSummary, SyncData } from '#/lib/types'
import { canSeeSeries } from './auth/user'
import type { AppUser } from './auth/user'
import { imageSize } from './imageSize'
import { readAllProgress } from './progress'

export const BOOKS_DIR = path.resolve(process.env.BOOKS_DIR ?? path.join(process.cwd(), '../books'))

/** Books are laid out as books/<series>/<volume>/{*.pdf, audio/*.m4b, .sync/}. */
interface BookFiles {
  /** "<series>/<volume>" */
  id: string
  series: string
  volume: string
  dir: string
  pdf: string
  audio: string
  cover: string | null
  sync: string
  words: string
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).sort()
  } catch {
    return []
  }
}

/** Visible sub-folders; also what URL segments are validated against, so no traversal is possible. */
async function listSubdirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    const names: string[] = []
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      // Follow symlinks (e.g. volumes stored on another disk).
      const isDir = e.isDirectory() || (e.isSymbolicLink() && (await stat(path.join(dir, e.name)).catch(() => null))?.isDirectory())
      if (isDir) names.push(e.name)
    }
    return names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  } catch {
    return []
  }
}

async function scanBook(series: string, volume: string): Promise<BookFiles | null> {
  const dir = path.join(BOOKS_DIR, series, volume)
  const pdf = (await listDir(dir)).find((f) => f.toLowerCase().endsWith('.pdf'))
  const audioFiles = await listDir(path.join(dir, 'audio'))
  const audio = audioFiles.find((f) => f.toLowerCase().endsWith('.m4b'))
  if (!pdf || !audio) return null
  // audio/cover*.* (added by hand) or .sync/cover.* (extracted by prep from the PDF / m4b).
  const isCover = (f: string) => /^cover.*\.(jpe?g|png|webp)$/i.test(f)
  const cover = await pickCover([
    ...audioFiles.filter(isCover).map((f) => path.join(dir, 'audio', f)),
    ...(await listDir(path.join(dir, '.sync'))).filter(isCover).map((f) => path.join(dir, '.sync', f)),
  ])
  return {
    id: `${series}/${volume}`,
    series,
    volume,
    dir,
    pdf: path.join(dir, pdf),
    audio: path.join(dir, 'audio', audio),
    cover,
    sync: path.join(dir, '.sync', 'sync.json'),
    words: path.join(dir, '.sync', 'words.json'),
  }
}

const A4_RATIO = 210 / 297

/** Of several cover images, the one closest to the A4 shape of the library cards (least cropping). */
async function pickCover(files: string[]): Promise<string | null> {
  if (files.length <= 1) return files[0] ?? null
  let best: string | null = null
  let bestDiff = Infinity
  for (const f of files) {
    const size = await imageSize(f).catch(() => null)
    const diff = size ? Math.abs(Math.log(size.width / size.height / A4_RATIO)) : Infinity
    if (best === null || diff < bestDiff) {
      best = f
      bestDiff = diff
    }
  }
  return best
}

/** Resolves URL segments to a volume's files; null for unknown names (and any traversal attempt). */
export async function getBook(series: string, volume: string): Promise<BookFiles | null> {
  if (!(await listSubdirs(BOOKS_DIR)).includes(series)) return null
  if (!(await listSubdirs(path.join(BOOKS_DIR, series))).includes(volume)) return null
  return scanBook(series, volume)
}

/** Like getBook, but null for series the user isn't allowed to see. */
export async function getBookFor(user: AppUser, series: string, volume: string): Promise<BookFiles | null> {
  return canSeeSeries(user, series) ? getBook(series, volume) : null
}

/** Every series folder name (for the admin's access picker). */
export function listSeries(): Promise<string[]> {
  return listSubdirs(BOOKS_DIR)
}

/** "mushoku_tensei" → "Mushoku Tensei" */
export function displayName(folder: string): string {
  return folder
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\p{Ll}/gu, (c) => c.toUpperCase())
}

export async function readSync(book: BookFiles): Promise<SyncData | null> {
  const file = Bun.file(book.sync)
  return (await file.exists()) ? ((await file.json()) as SyncData) : null
}

export async function listBooks(user: AppUser): Promise<SeriesSummary[]> {
  const progress = await readAllProgress(user.id)
  const result: SeriesSummary[] = []
  for (const series of await listSubdirs(BOOKS_DIR)) {
    if (!canSeeSeries(user, series)) continue
    const volumes: BookSummary[] = []
    for (const volume of await listSubdirs(path.join(BOOKS_DIR, series))) {
      const book = await scanBook(series, volume)
      if (!book) continue
      volumes.push(await summarize(book, progress[book.id]?.time, progress[book.id]?.updatedAt))
    }
    if (volumes.length) result.push({ id: series, name: displayName(series), volumes })
  }
  return result
}

export async function summarize(
  book: BookFiles,
  time: number | undefined,
  lastReadAt?: string,
): Promise<BookSummary> {
  const sync = await readSync(book).catch(() => null)
  return {
    id: book.id,
    series: book.series,
    volume: book.volume,
    title: sync?.title ?? displayName(book.volume),
    ready: sync !== null,
    duration: sync?.duration ?? null,
    hasCover: book.cover !== null,
    progress: sync && time != null ? Math.min(1, time / sync.duration) : null,
    lastReadAt: lastReadAt ?? null,
  }
}
