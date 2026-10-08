/** Shape of books/<book>/.sync/sync.json, written by prep/prep.py. */
export interface Rect {
  page: number
  x0: number
  y0: number
  x1: number
  y1: number
  /** When narration reaches this page segment (sync.json v2+). */
  start?: number
}

export interface Paragraph {
  id: number
  start: number
  end: number
  match: number
  rects: Rect[]
}

export interface Chapter {
  title: string
  start: number
  end: number
  firstParagraphId: number | null
  match: number | null
  words: number
}

export interface SyncData {
  version: number
  id: string
  title: string
  duration: number
  /** [width, height] in PDF points, per page. */
  pages: [number, number][]
  chapters: Chapter[]
  paragraphs: Paragraph[]
}

export interface BookSummary {
  /** "<series>/<volume>" — the folder path under books/. */
  id: string
  series: string
  volume: string
  title: string
  ready: boolean
  duration: number | null
  hasCover: boolean
  progress: number | null
  /** When this user's position was last saved (ISO). */
  lastReadAt: string | null
}

export interface SeriesSummary {
  /** Folder name under books/. */
  id: string
  /** Display name derived from the folder name. */
  name: string
  volumes: BookSummary[]
}

export interface Progress {
  time: number
  updatedAt: string
}
