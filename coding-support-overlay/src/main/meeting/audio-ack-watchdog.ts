// Detect a half-open transport even if capture stops producing enough data to hit byte limits.
export function createAudioAckWatchdog(onStale: () => void) {
  let pending = false
  let lastProgress = Date.now()
  const timer = setInterval(() => {
    if (pending && Date.now() - lastProgress >= 20000) {
      clearInterval(timer)
      onStale()
    }
  }, 1000)
  timer.unref?.()
  return {
    sent: () => { if (!pending) lastProgress = Date.now(); pending = true },
    acknowledged: (hasPending: boolean) => { pending = hasPending; lastProgress = Date.now() },
    stop: () => clearInterval(timer)
  }
}
