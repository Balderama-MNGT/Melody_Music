import { useRef, useState } from 'react'
import { Icon } from './Icons.jsx'

/**
 * Artwork with mirror fallback (kept from the Audius days: a track may carry
 * extra mirror hosts, and if the first URL fails the host is swapped for each
 * mirror in turn before falling back to a placeholder). YouTube thumbnails
 * simply arrive as one URL, so `mirrors` is empty and the placeholder shows.
 *
 * className          - classes for the <img>           (e.g. "track-thumb")
 * placeholderClassName - classes when there is no image (e.g. "track-thumb placeholder-thumb")
 * placeholderSize    - icon size inside the placeholder
 */
export default function CoverArt({
  track,
  className = '',
  placeholderClassName = 'cover-placeholder',
  placeholderSize = 20,
}) {
  const [failed, setFailed] = useState(false)
  const triedRef = useRef(0)

  const url = track?.cover || ''
  const mirrors = Array.isArray(track?.mirrors) ? track.mirrors.filter(Boolean) : []

  if (!url || failed) {
    return (
      <span className={placeholderClassName} aria-hidden="true">
        <Icon name="music" size={placeholderSize} />
      </span>
    )
  }

  return (
    <img
      className={className || undefined}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      src={url}
      onError={(e) => {
        const img = e.currentTarget
        while (triedRef.current < mirrors.length) {
          const mirror = mirrors[triedRef.current++]
          try {
            const u = new URL(url, window.location.href)
            const m = new URL(mirror, window.location.href)
            if (m.host !== u.host) {
              u.host = m.host
              img.src = u.href
              return
            }
          } catch {
            /* skip a malformed mirror */
          }
        }
        setFailed(true)
      }}
    />
  )
}
