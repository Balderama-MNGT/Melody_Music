/**
 * "Play all" support for the home rows (the old data-play-all buttons).
 *
 * Every <MusicSection> publishes its state here while it is mounted, so the
 * hero button and each section's "Play all" can start the very same queue.
 * Pressing play while a row is still loading remembers the request and starts
 * as soon as the tracks arrive - exactly like the old pendingPlay helper.
 */
const sections = new Map() // mode -> { state, tracks, play }
let pending = null // mode whose "play all" was pressed too early

export function publishSection(mode, entry) {
  sections.set(mode, entry)
  if (pending !== mode) return
  if (entry.state === 'ready' && entry.tracks.length) {
    pending = null
    entry.play()
  } else if (entry.state === 'error') {
    pending = null
  }
}

export function unpublishSection(mode) {
  sections.delete(mode)
  if (pending === mode) pending = null // the row went away: forget the request
}

const NAMES = {
  trending: 'trending tracks',
  discover: 'discover picks',
  search: 'search results',
}

/** Start the queue of a published section (or queue up a "play when ready"). */
export function playSection(mode, toast) {
  const name = NAMES[mode] || 'tracks'
  const st = sections.get(mode)

  if (!st || st.state === 'loading') {
    pending = mode
    toast(`Loading ${name}… they will start playing in a moment.`)
    return
  }
  if (st.state === 'error' || !st.tracks.length) {
    toast(`There are no ${name} to play right now. Try again in a moment.`, true)
    return
  }
  st.play()
}
