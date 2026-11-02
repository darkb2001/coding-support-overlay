import { app } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import { existsSync } from 'fs'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  hasScreenshot?: boolean
}

export interface Session {
  id: string
  title: string
  createdAt: number
  lastActive: number
  messages: Message[]
  metadata?: {
    totalQuestions: number
    totalScreenshots: number
  }
}

const SESSIONS_DIR = path.join(app.getPath('userData'), 'sessions')
const ACTIVE_SESSION_FILE = path.join(app.getPath('userData'), 'active-session.txt')

// Ensure sessions directory exists
async function ensureSessionsDir() {
  if (!existsSync(SESSIONS_DIR)) {
    await fs.mkdir(SESSIONS_DIR, { recursive: true })
  }
}

// Generate session title from first message
function generateSessionTitle(messages: Message[]): string {
  if (messages.length === 0) return 'New Session'
  
  const firstUserMsg = messages.find(m => m.role === 'user')
  if (!firstUserMsg) return 'New Session'
  
  // Extract first 40 chars
  const preview = firstUserMsg.content.slice(0, 40).trim()
  return preview.length < firstUserMsg.content.length ? `${preview}...` : preview
}

// Save session to disk
export async function saveSession(session: Session): Promise<void> {
  await ensureSessionsDir()
  
  const sessionPath = path.join(SESSIONS_DIR, `${session.id}.json`)
  await fs.writeFile(sessionPath, JSON.stringify(session, null, 2), 'utf-8')
  
  // Update active session
  await fs.writeFile(ACTIVE_SESSION_FILE, session.id, 'utf-8')
}

// Load session by ID
export async function loadSession(sessionId: string): Promise<Session | null> {
  const sessionPath = path.join(SESSIONS_DIR, `${sessionId}.json`)
  
  try {
    const data = await fs.readFile(sessionPath, 'utf-8')
    return JSON.parse(data) as Session
  } catch (error) {
    console.error(`Failed to load session ${sessionId}:`, error)
    return null
  }
}

// Get all sessions (sorted by lastActive, descending)
export async function getAllSessions(): Promise<Session[]> {
  await ensureSessionsDir()
  
  try {
    const files = await fs.readdir(SESSIONS_DIR)
    const sessionFiles = files.filter(f => f.endsWith('.json'))
    
    const sessions: Session[] = []
    for (const file of sessionFiles) {
      const sessionPath = path.join(SESSIONS_DIR, file)
      try {
        const data = await fs.readFile(sessionPath, 'utf-8')
        sessions.push(JSON.parse(data))
      } catch (error) {
        console.error(`Failed to load session file ${file}:`, error)
      }
    }
    
    // Sort by lastActive (most recent first)
    return sessions.sort((a, b) => b.lastActive - a.lastActive)
  } catch (error) {
    console.error('Failed to get all sessions:', error)
    return []
  }
}

// Get active session ID
export async function getActiveSessionId(): Promise<string | null> {
  try {
    if (existsSync(ACTIVE_SESSION_FILE)) {
      const sessionId = await fs.readFile(ACTIVE_SESSION_FILE, 'utf-8')
      
      // Verify session file exists
      const sessionPath = path.join(SESSIONS_DIR, `${sessionId}.json`)
      if (!existsSync(sessionPath)) {
        console.warn(`Active session ${sessionId} does not exist, clearing active session`)
        await fs.unlink(ACTIVE_SESSION_FILE).catch(() => {})
        return null
      }
      
      return sessionId
    }
  } catch (error) {
    console.error('Failed to read active session:', error)
  }
  return null
}

// Create new session
export async function createNewSession(): Promise<Session> {
  const session: Session = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2),
    title: 'New Session',
    createdAt: Date.now(),
    lastActive: Date.now(),
    messages: [],
    metadata: {
      totalQuestions: 0,
      totalScreenshots: 0
    }
  }
  
  await saveSession(session)
  return session
}

// Update session (add message, update title, etc.)
export async function updateSession(
  sessionId: string,
  updates: {
    messages?: Message[]
    addMessage?: Message
    title?: string
  }
): Promise<Session | null> {
  const session = await loadSession(sessionId)
  if (!session) return null
  
  // Add new message
  if (updates.addMessage) {
    session.messages.push(updates.addMessage)
    
    // Update metadata
    if (updates.addMessage.role === 'user') {
      session.metadata!.totalQuestions++
      if (updates.addMessage.hasScreenshot) {
        session.metadata!.totalScreenshots++
      }
    }
    
    // Auto-generate title from first message
    if (session.messages.length === 2 && !updates.title) {
      session.title = generateSessionTitle(session.messages)
    }
  }
  
  // Override messages
  if (updates.messages) {
    session.messages = updates.messages
  }
  
  // Update title
  if (updates.title) {
    session.title = updates.title
  }
  
  // Update lastActive
  session.lastActive = Date.now()
  
  await saveSession(session)
  return session
}

// Delete session
export async function deleteSession(sessionId: string): Promise<boolean> {
  const sessionPath = path.join(SESSIONS_DIR, `${sessionId}.json`)
  
  try {
    await fs.unlink(sessionPath)
    
    // If this was active session, clear it
    const activeId = await getActiveSessionId()
    if (activeId === sessionId) {
      try {
        await fs.unlink(ACTIVE_SESSION_FILE)
      } catch {
        // Ignore
      }
    }
    
    return true
  } catch (error) {
    console.error(`Failed to delete session ${sessionId}:`, error)
    return false
  }
}

// Clear all sessions
export async function clearAllSessions(): Promise<void> {
  await ensureSessionsDir()
  
  try {
    const files = await fs.readdir(SESSIONS_DIR)
    for (const file of files) {
      if (file.endsWith('.json')) {
        await fs.unlink(path.join(SESSIONS_DIR, file))
      }
    }
    
    // Clear active session
    try {
      await fs.unlink(ACTIVE_SESSION_FILE)
    } catch {
      // Ignore
    }
  } catch (error) {
    console.error('Failed to clear all sessions:', error)
  }
}

// Export session as JSON
export async function exportSession(sessionId: string): Promise<string | null> {
  const session = await loadSession(sessionId)
  if (!session) return null
  
  return JSON.stringify(session, null, 2)
}
