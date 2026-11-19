import { Icon } from '../components/Icons.jsx'

const VERSION = import.meta.env.VITE_APP_VERSION || ''

export default function About() {
  return (
    <section className="page info-page">
      <header className="page-header">
        <h1 className="page-title">
          <Icon name="info" size={24} /> <span>About Melody</span>
        </h1>
      </header>
      <div className="about-panel">
        <strong className="about-name">Melody</strong>
        <p>Your music, all in one place.</p>
        <p className="about-meta">Version {VERSION || 'not available'}</p>
      </div>
      <div className="info-grid">
        <section className="info-card">
          <h2>Built with</h2>
          <ul>
            <li>React and Vite for the interface.</li>
            <li>Supabase for accounts, playlists, favorites and listening history.</li>
            <li>YouTube Data API v3 for music discovery and the IFrame Player API for playback.</li>
          </ul>
        </section>
        <section className="info-card">
          <h2>Acknowledgments</h2>
          <ul>
            <li>Music data and video playback are provided by YouTube.</li>
            <li>Artwork and video metadata belong to their respective creators and channels.</li>
          </ul>
        </section>
      </div>
      <p className="about-links">
        <a href="/privacy">Privacy &amp; Terms</a>
        {' · '}
        <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener">
          YouTube Terms of Service
        </a>
      </p>
    </section>
  )
}
