import { Icon } from '../components/Icons.jsx'
import { EmptyState } from '../components/States.jsx'

/**
 * Albums - pages/albums.php.
 * Melody's albums lived in the local MySQL library; the Supabase schema keeps
 * playlists, favorites and listening history, so there are no albums yet and
 * the page shows the same empty state the PHP app showed for an empty library.
 */
export default function Albums() {
  return (
    <section className="page">
      <h1 className="page-title">
        <Icon name="disc-3" size={24} /> <span>Albums</span>
      </h1>

      <EmptyState
        icon={<Icon name="disc-3" size={22} />}
        title="No albums yet"
        text="Albums you add to your collection will appear here."
      />
    </section>
  )
}
