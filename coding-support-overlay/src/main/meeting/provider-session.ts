import type { MeetingModelSelection } from '../../shared/meeting-prompt'

async function bridgeRequest(path: string, input?: unknown): Promise<any> {
  const response = await fetch(`http://127.0.0.1:3799/meeting/${path}`, {
    method: input === undefined ? 'GET' : 'POST',
    headers: input === undefined ? {} : { 'Content-Type': 'application/json' },
    body: input === undefined ? undefined : JSON.stringify(input),
    signal: AbortSignal.timeout(25000)
  })
  if (!response.ok) throw new Error(`Bridge chưa hỗ trợ chuẩn bị phiên (${response.status}). Cài Bridge 1.0.8 và reload Cursor.`)
  const data = await response.json() as { ok: boolean; error?: string }
  if (!data.ok) throw new Error(data.error || 'Không xác minh được kết nối AI.')
  return data
}

export async function meetingModels() {
  try { return await bridgeRequest('models') }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Không tải được model.' } }
}

export async function testMeetingModel(model: unknown) {
  if (typeof model !== 'string' || !model.trim() || model.length > 256) return { ok: false, error: 'Chọn model hợp lệ trước.' }
  try { return await bridgeRequest('test', { model }) }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Test Connection thất bại.' } }
}

export interface MeetingModelTarget {
  accepting: boolean
  closed: boolean
  modelSelection: MeetingModelSelection | null
}
const modelChanges = new WeakMap<MeetingModelTarget, number>()

// Validate first; a failed/stale switch must never replace the working model.
export async function switchMeetingModel(
  state: MeetingModelTarget, value: unknown, isCurrent: () => boolean, onCommit: () => void
): Promise<MeetingModelSelection> {
  if (!state.accepting || state.closed || !isCurrent()) throw new Error('Phiên Meeting đã dừng hoặc thay đổi.')
  const revision = (modelChanges.get(state) ?? 0) + 1
  modelChanges.set(state, revision)
  const selection = await requireMeetingSelection(value)
  if (!state.accepting || state.closed || !isCurrent() || modelChanges.get(state) !== revision) {
    throw new Error('Phiên hoặc yêu cầu đổi model đã thay đổi. Vui lòng thử lại.')
  }
  if (state.modelSelection?.token === selection.token && state.modelSelection.model === selection.model) return selection
  state.modelSelection = selection
  onCommit()
  return selection
}

export async function requireMeetingSelection(value: unknown): Promise<MeetingModelSelection> {
  if (!value || typeof value !== 'object') throw new Error('Chọn model và Test Connection trước khi Start Meeting.')
  const { token, model } = value as Partial<MeetingModelSelection>
  if (typeof token !== 'string' || token.length !== 36 || typeof model !== 'string' || !model || model.length > 256) {
    throw new Error('Chọn model và Test Connection trước khi Start Meeting.')
  }
  const result = await bridgeRequest('validate', { token })
  if (result.model !== model) throw new Error('Model đã đổi. Vui lòng Test Connection lại.')
  return { token, model }
}
