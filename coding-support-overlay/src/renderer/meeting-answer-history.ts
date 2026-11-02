export interface AnswerPage { reply: string; model?: string; question?: string }
export interface AnswerHistory {
  pages: AnswerPage[]
  selected: number
  view: 'page' | 'live' | 'empty'
  preview: AnswerPage | null
  pending: boolean
}
export const initialAnswerHistory: AnswerHistory = { pages: [], selected: -1, view: 'empty', preview: null, pending: false }
export type AnswerHistoryAction =
  | { type: 'start' | 'cancel' | 'clear' | 'reset' }
  | { type: 'preview' | 'complete'; page: AnswerPage }
  | { type: 'navigate'; direction: -1 | 1 }

// UI-only session pages, never fed back into the model or persisted to localStorage.
export function answerHistoryReducer(state: AnswerHistory, action: AnswerHistoryAction): AnswerHistory {
  switch (action.type) {
    case 'reset': return initialAnswerHistory
    case 'start': return { ...state, pending: true, preview: null, view: 'live' }
    case 'preview': return { ...state, pending: true, preview: action.page,
      view: state.pending ? state.view : 'live' }
    case 'complete': {
      if (!action.page.reply.trim()) return answerHistoryReducer(state, { type: 'cancel' })
      const follow = !state.pending || state.view === 'live'
      return { ...state, pages: [...state.pages, { ...action.page }], pending: false, preview: null,
        selected: follow ? state.pages.length : state.selected, view: follow ? 'page' : state.view }
    }
    case 'cancel': return { ...state, pending: false, preview: null,
      view: state.view === 'live' ? (state.pages.length ? 'page' : 'empty') : state.view,
      selected: state.view === 'live' ? state.pages.length - 1 : state.selected }
    case 'clear': return { ...state, view: 'empty' }
    case 'navigate': {
      const total = state.pages.length + (state.pending ? 1 : 0)
      if (!total) return state
      const position = state.view === 'live' ? state.pages.length : state.selected
      const target = state.view === 'empty' ? (action.direction === -1 ? total - 1 : 0) : position + action.direction
      if (target < 0 || target >= total) return state
      return { ...state, selected: Math.min(target, state.pages.length - 1), view: target === state.pages.length ? 'live' : 'page' }
    }
  }
}

export function answerHistoryView(state: AnswerHistory) {
  const page = state.view === 'page' ? state.pages[state.selected] : state.view === 'live' ? state.preview : null
  const position = state.view === 'live' ? state.pages.length : state.selected
  return {
    answer: { reply: page?.reply ?? null, model: page?.model, question: page?.question },
    key: state.view === 'page' ? `page-${state.selected}` : state.view,
    label: state.view === 'live' && state.pending ? `Đang soạn · ${state.pages.length} đã lưu`
      : `${state.view === 'page' ? state.selected + 1 : 0} / ${state.pages.length}`,
    canPrevious: state.view === 'empty' ? state.pages.length > 0 : position > 0,
    canNext: state.view === 'page' && position + 1 < state.pages.length + (state.pending ? 1 : 0),
    isPreview: state.view === 'live' && state.pending
  }
}
