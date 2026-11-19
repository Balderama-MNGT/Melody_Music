import { Icon } from '../components/Icons.jsx'

/** Static, in-app help. No database, no API calls. */
const SECTIONS = [
  {
    icon: 'search',
    title: 'Finding music',
    items: [
      'Open Search from the sidebar (or the Search tab on mobile) and type a song, artist or album.',
      'Suggestions appear as you type; press Enter or tap Search to see full results.',
      'Trending and Discover on Home are YouTube popularity charts in different regions.',
    ],
  },
  {
    icon: 'play',
    title: 'Playing music',
    items: [
      'Tap a song or a card to start it. Use Play/Pause, Next and Previous in the bottom player.',
      'Tap the artwork or the player bar to open the full Now Playing screen.',
      'Shuffle and Repeat change the order of the current queue; playlists and recommendations stay separate.',
    ],
  },
  {
    icon: 'list-music',
    title: 'Playlists & favorites',
    items: [
      'Use the heart button to save a song to Favorites.',
      'The + list button on any song adds it to one of your playlists; songs already saved show a check.',
      'Open a playlist from the sidebar or Home and press Play all to hear it in saved order.',
    ],
  },
  {
    icon: 'settings',
    title: 'Troubleshooting',
    items: [
      'No search results? Check your connection and try different keywords. Quota or rate-limit messages are shown directly instead of a generic empty state.',
      'Video will not play? Some YouTube videos block embedding. Melody moves to the next playable track and explains why.',
      'Nothing in your library? Favorites, playlists and history are private to your account and load after sign-in.',
      'Playback blocked after refresh? Press Play manually - browsers require a user gesture before sound can start.',
    ],
  },
]

export default function Help() {
  return (
    <section className="page info-page">
      <header className="page-header">
        <h1 className="page-title">
          <Icon name="help-circle" size={24} /> <span>Help &amp; Support</span>
        </h1>
      </header>
      <p className="info-lead">A quick guide to the features in Melody.</p>
      <div className="info-grid">
        {SECTIONS.map((section) => (
          <section className="info-card" key={section.title}>
            <h2>
              <Icon name={section.icon} size={19} /> {section.title}
            </h2>
            <ul>
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  )
}
