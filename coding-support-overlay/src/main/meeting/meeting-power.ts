import { powerSaveBlocker } from 'electron'

let blocker: number | null = null
// Prevent idle app suspension during long calls; never override lid-close or manual sleep.
export function keepMeetingAwake(): void {
  if (blocker === null) blocker = powerSaveBlocker.start('prevent-app-suspension')
}
export function releaseMeetingPower(): void {
  if (blocker !== null) powerSaveBlocker.stop(blocker)
  blocker = null
}
