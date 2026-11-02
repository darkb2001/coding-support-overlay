// Bound graceful cleanup so a stuck STT/provider request cannot trap the app open.
export async function finishShutdown(
  graceful: () => Promise<unknown>, forceCleanup: () => void, timeoutMs = 5000
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      Promise.resolve().then(graceful),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs) })
    ])
  } finally {
    clearTimeout(timer)
    forceCleanup()
  }
}
