/** Small formatting helpers - ported from the PHP helpers used across the app. */

/** seconds -> "0:00" / "3:45" */
export function fmtDuration(sec) {
  const n = Number(sec) || 0
  if (!isFinite(n) || n <= 0) return '0:00'
  const m = Math.floor(n / 60)
  const s = Math.floor(n % 60)
  return m + ':' + (s < 10 ? '0' : '') + s
}

/** Same as above but returns '' when there is nothing to show (cards/rows). */
export function fmtDurationShort(sec) {
  const n = Number(sec) || 0
  if (!n) return ''
  return fmtDuration(n)
}

/** 1234 -> "1.2K", 4500000 -> "4.5M" */
export function fmtCount(n) {
  const v = Number(n) || 0
  if (v < 1000) return String(v)
  if (v < 1000000) return (v / 1000).toFixed(v < 10000 ? 1 : 0).replace(/\.0$/, '') + 'K'
  return (v / 1000000).toFixed(1).replace(/\.0$/, '') + 'M'
}

/** "just now" / "12 min ago" / "yesterday" / "Oct 24" (history.php's history_ago). */
export function timeAgo(iso) {
  if (!iso) return ''
  const ts = new Date(iso).getTime()
  if (!isFinite(ts)) return ''
  const secs = Math.floor((Date.now() - ts) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return Math.floor(secs / 60) + ' min ago'
  if (secs < 86400) return Math.floor(secs / 3600) + ' hr ago'
  if (secs < 172800) return 'yesterday'
  if (secs < 604800) return Math.floor(secs / 86400) + ' days ago'
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** "Oct 24, 2026" */
export function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d)) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** "Oct 24" */
export function formatDateShort(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d)) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** "14:05" */
export function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d)) return ''
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

/** "2026-11-02" in the viewer's local day (for Today / Yesterday buckets). */
export function localDay(iso) {
  const d = new Date(iso)
  if (isNaN(d)) return ''
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Time-of-day greeting used on the home hero. */
export function greeting() {
  const h = new Date().getHours()
  if (h < 5) return 'Good night'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  if (h < 22) return 'Good evening'
  return 'Good night'
}

/** "1 song" / "3 songs" */
export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`
}
