// Labels are presentation only. Options must always come from the live provider catalog.
export function isAnswerModel(id: string): boolean {
  return !/(?:embedding|\bembed\b|whisper|parakeet|\basr\b|\btts\b|moderation|dall-e|image-generation)/i.test(id)
}

export function modelGroup(id: string): string {
  if (['vibe-daily', 'gemini/gemini-3.7-flash', 'gemini/gemini-3.5-flash-lite'].includes(id)) return 'Gợi ý cho hội thoại'
  if (/review/i.test(id)) return 'Coding / review chuyên dụng'
  if (/(?:gpt|codex|^cx\/)/i.test(id)) return 'GPT / Codex'
  if (/gemini|gemma/i.test(id)) return 'Gemini'
  return 'Model khác'
}

export function modelLabel(id: string): string {
  const names: Record<string, string> = {
    'vibe-daily': 'Vibe Daily', 'vibe-brain': 'Vibe Brain', 'vibe-vision': 'Vibe Vision',
    'gemini/gemini-3.7-flash': 'Gemini 3.7 Flash',
    'gemini/gemini-3.5-flash-lite': 'Gemini 3.5 Flash Lite'
  }
  return names[id] ? `${names[id]} · ${id}` : id
}

export function groupedModels(models: string[]): Array<[string, string[]]> {
  const valid = [...new Set(models)].filter(isAnswerModel)
  const order = ['Gợi ý cho hội thoại', 'Gemini', 'GPT / Codex', 'Model khác', 'Coding / review chuyên dụng']
  return order.map((group): [string, string[]] => [group, valid.filter((id) => modelGroup(id) === group).sort()]).filter(([, ids]) => ids.length)
}

export function preferredModel(models: string[], saved?: string | null, configured?: string): string {
  const valid = models.filter(isAnswerModel)
  const general = valid.filter((id) => !/review/i.test(id))
  return [saved, configured, 'vibe-daily', 'gemini/gemini-3.7-flash', ...general, ...valid].find((id) => !!id && valid.includes(id)) ?? ''
}
