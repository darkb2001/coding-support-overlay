export function storedText(key: string, fallback = ''): string {
  try { return window.localStorage.getItem(key) ?? fallback } catch { return fallback }
}

export function saveText(key: string, value: string): boolean {
  try { window.localStorage.setItem(key, value); return true } catch { return false }
}

export function readOpacity(): number {
  const raw = storedText('coding-support.opacity.v1')
  const value = raw ? Number(raw) : 0.86
  return Number.isFinite(value) ? Math.max(0.35, Math.min(1, value)) : 0.86
}
