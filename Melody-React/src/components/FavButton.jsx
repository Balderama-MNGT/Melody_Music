import { Icon, HeartFilled } from './Icons.jsx'
import { useFavorites } from '../context/FavoritesContext.jsx'

/**
 * The heart button used on cards, rows and the player bar.
 * Both hearts live in the DOM and the stylesheet shows the filled one when
 * the button is favourited (same markup as melody_fav_button() in PHP).
 */
export default function FavButton({ track, className = 'btn btn-icon btn-fav' }) {
  const { isFav, toggleFavorite } = useFavorites()

  if (!track || !track.external_id) return null

  const fav = isFav(track.external_id)
  const label = fav ? 'Remove from favorites' : 'Add to favorites'

  return (
    <button
      type="button"
      className={`${className}${fav ? ' is-fav' : ''}`}
      aria-pressed={fav}
      aria-label={label}
      title={label}
      onClick={() => toggleFavorite(track)}
    >
      <Icon name="heart" size={18} className="icon-heart-outline" />
      <HeartFilled size={18} />
    </button>
  )
}
