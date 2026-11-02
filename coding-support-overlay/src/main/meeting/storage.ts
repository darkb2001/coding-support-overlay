import { app } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import { existsSync } from 'fs'
import type { Utterance } from './suggester'

export interface MeetingMeta {
  id: string
  title: string
  createdAt: number
  jsonlPath: string
}

function meetingsDir(): string {
  return path.join(app.getPath('userData'), 'meetings')
}

async function ensureDir(): Promise<void> {
  const dir = meetingsDir()
  if (!existsSync(dir)) {
    await fs.mkdir(dir, { recursive: true })
  }
}

export async function createMeeting(): Promise<MeetingMeta> {
  await ensureDir()
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  const jsonlPath = path.join(meetingsDir(), `${id}.jsonl`)
  const meta: MeetingMeta = {
    id,
    title: `Meeting ${new Date().toLocaleString()}`,
    createdAt: Date.now(),
    jsonlPath
  }
  // Header line so the file is self-describing
  await fs.writeFile(jsonlPath, JSON.stringify({ type: 'meta', ...meta }) + '\n', 'utf-8')
  return meta
}

export async function appendUtterance(meta: MeetingMeta, u: Utterance): Promise<void> {
  const line = JSON.stringify({ type: 'utterance', ...u }) + '\n'
  await fs.appendFile(meta.jsonlPath, line, 'utf-8')
}

/**
 * Export the meeting log as readable Markdown next to the .jsonl file.
 * Returns the path to the generated .md file.
 */
export async function exportMarkdown(meta: MeetingMeta): Promise<string> {
  let raw = ''
  try {
    raw = await fs.readFile(meta.jsonlPath, 'utf-8')
  } catch {
    raw = ''
  }

  const lines = raw.split('\n').filter(Boolean)
  const utterances: Utterance[] = []
  for (const line of lines) {
    try {
      const obj = JSON.parse(line)
      if (obj.type === 'utterance') {
        utterances.push({ speaker: obj.speaker, text: obj.text, ts: obj.ts })
      }
    } catch {
      // skip malformed line
    }
  }

  const body = utterances
    .sort((a, b) => a.ts - b.ts)
    .map((u) => {
      const time = new Date(u.ts).toLocaleTimeString()
      return `- **[${time}] ${u.speaker}:** ${u.text}`
    })
    .join('\n')

  const md =
    `# ${meta.title}\n\n` +
    `Created: ${new Date(meta.createdAt).toLocaleString()}\n\n` +
    `## Transcript\n\n${body || '_(empty)_'}\n`

  const mdPath = meta.jsonlPath.replace(/\.jsonl$/, '.md')
  await fs.writeFile(mdPath, md, 'utf-8')
  return mdPath
}

export interface MeetingSummary {
  id: string
  title: string
  createdAt: number
  utterances: number
  hasMarkdown: boolean
}

// List stored meetings newest-first, reading only the header line of each log.
export async function listMeetings(): Promise<MeetingSummary[]> {
  await ensureDir()
  const entries = await fs.readdir(meetingsDir()).catch(() => [] as string[])
  const meetings: MeetingSummary[] = []
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue
    const jsonlPath = path.join(meetingsDir(), name)
    try {
      const raw = await fs.readFile(jsonlPath, 'utf-8')
      const lines = raw.split('\n').filter(Boolean)
      let meta: Partial<MeetingMeta> = {}
      let utterances = 0
      for (const line of lines) {
        try {
          const obj = JSON.parse(line)
          if (obj.type === 'meta') meta = obj
          else if (obj.type === 'utterance') utterances++
        } catch {
          // skip malformed line
        }
      }
      const createdAt = meta.createdAt ?? 0
      meetings.push({
        id: meta.id ?? name.replace(/\.jsonl$/, ''),
        title: meta.title ?? name.replace(/\.jsonl$/, ''),
        createdAt,
        utterances,
        hasMarkdown: existsSync(jsonlPath.replace(/\.jsonl$/, '.md'))
      })
    } catch {
      // unreadable file: skip
    }
  }
  return meetings.sort((a, b) => b.createdAt - a.createdAt)
}

// Read one stored meeting back as an ordered transcript.
export async function readMeeting(id: string): Promise<{ meta: MeetingMeta; utterances: Utterance[] } | null> {
  if (!/^[a-z0-9]+$/i.test(id)) return null
  const jsonlPath = path.join(meetingsDir(), `${id}.jsonl`)
  let raw = ''
  try {
    raw = await fs.readFile(jsonlPath, 'utf-8')
  } catch {
    return null
  }
  let meta: MeetingMeta | null = null
  const utterances: Utterance[] = []
  for (const line of raw.split('\n').filter(Boolean)) {
    try {
      const obj = JSON.parse(line)
      if (obj.type === 'meta') meta = obj
      else if (obj.type === 'utterance') utterances.push({ speaker: obj.speaker, text: obj.text, ts: obj.ts })
    } catch {
      // skip malformed line
    }
  }
  if (!meta) return null
  utterances.sort((a, b) => a.ts - b.ts)
  return { meta, utterances }
}

export async function deleteMeeting(id: string): Promise<boolean> {
  if (!/^[a-z0-9]+$/i.test(id)) return false
  try {
    await fs.rm(path.join(meetingsDir(), `${id}.jsonl`), { force: true })
    await fs.rm(path.join(meetingsDir(), `${id}.md`), { force: true })
    return true
  } catch {
    return false
  }
}
