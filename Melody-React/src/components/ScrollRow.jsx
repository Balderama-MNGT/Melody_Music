import { useEffect, useRef } from 'react'
import { Icon } from './Icons.jsx'

/**
 * Horizontally scrolling strip with Previous / Next arrows - the old
 * enhanceRow() behaviour. The grid itself becomes the scroll-strip, so the
 * existing stylesheet applies.
 */
export default function ScrollRow({ children, gridClassName = 'song-grid' }) {
  const stripRef = useRef(null)
  const prevRef = useRef(null)
  const nextRef = useRef(null)

  useEffect(() => {
    const strip = stripRef.current
    const prev = prevRef.current
    const next = nextRef.current
    if (!strip || !prev || !next) return undefined

    function update() {
      const max = strip.scrollWidth - strip.clientWidth
      prev.hidden = strip.scrollLeft <= 4
      next.hidden = max <= 4 || strip.scrollLeft >= max - 4
    }

    function arrow(dir) {
      const step = Math.max(160, Math.round(strip.clientWidth * 0.85)) * dir
      if (strip.scrollBy) strip.scrollBy({ left: step, behavior: 'smooth' })
      else strip.scrollLeft += step
    }

    const onPrev = () => arrow(-1)
    const onNext = () => arrow(1)
    const onResize = () => update()

    prev.addEventListener('click', onPrev)
    next.addEventListener('click', onNext)
    strip.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', onResize)

    update()
    const settle = setTimeout(update, 250) // images/fonts settle after first paint

    return () => {
      clearTimeout(settle)
      prev.removeEventListener('click', onPrev)
      next.removeEventListener('click', onNext)
      strip.removeEventListener('scroll', update)
      window.removeEventListener('resize', onResize)
    }
  }, [children])

  return (
    <div className="scroll-row">
      <div className={`${gridClassName} scroll-strip`} ref={stripRef}>
        {children}
      </div>
      <button ref={prevRef} type="button" className="scroll-btn scroll-prev" aria-label="Scroll left">
        <Icon name="chevron-left" size={20} />
      </button>
      <button ref={nextRef} type="button" className="scroll-btn scroll-next" aria-label="Scroll right">
        <Icon name="chevron-right" size={20} />
      </button>
    </div>
  )
}
