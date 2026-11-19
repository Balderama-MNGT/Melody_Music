import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Icon } from '../components/Icons.jsx'
import { useTheme } from '../context/ThemeContext.jsx'
import { usePlayer } from '../context/PlayerContext.jsx'

/** Real, app version from package.json (injected by Vite as a constant). */
const VERSION = import.meta.env.VITE_APP_VERSION || ''

const APPEARANCE = [
  { value: 'light', label: 'Light Mode', icon: 'sun', hint: 'Bright background, dark text.' },
  { value: 'dark', label: 'Dark Mode', icon: 'moon', hint: 'The classic Melody look.' },
  { value: 'system', label: 'System Default', icon: 'monitor', hint: 'Follow your device setting automatically.' },
]

/**
 * Settings uses only existing state: the centralized theme context and the
 * player's own shuffle/repeat controls. Nothing here writes to Supabase.
 */
export default function Settings() {
  const { preference, setPreference } = useTheme()
  const { shuffle, toggleShuffle, repeat, cycleRepeat } = usePlayer()
  const { hash } = useLocation()

  useEffect(() => {
    if (!hash) return
    const target = document.getElementById(hash.slice(1))
    if (target) target.scrollIntoView({ block: 'start' })
  }, [hash])

  return (
    <section className="page settings-page">
      <header className="page-header">
        <h1 className="page-title">
          <Icon name="settings" size={24} /> <span>Settings</span>
        </h1>
      </header>

      <div className="settings-grid">
        {/* ------------------------------ Appearance ------------------------- */}
        <section className="settings-section" id="appearance">
          <h2 className="settings-heading">Appearance</h2>
          <p className="settings-note">
            Choose how Melody looks. Your choice is saved on this device.
          </p>
          <div className="settings-options">
            {APPEARANCE.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`settings-option${preference === option.value ? ' selected' : ''}`}
                aria-pressed={preference === option.value}
                onClick={() => setPreference(option.value)}
              >
                <Icon name={option.icon} size={20} />
                <span className="settings-option-text">
                  <strong>{option.label}</strong>
                  <small>{option.hint}</small>
                </span>
                <span className="settings-option-check" aria-hidden="true">
                  {preference === option.value && <Icon name="check" size={16} />}
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* ------------------------- Playback preferences -------------------- */}
        <section className="settings-section" id="playback">
          <h2 className="settings-heading">Playback Preferences</h2>
          <p className="settings-note">
            These control the player you already use; changes take effect immediately.
          </p>
          <div className="settings-options">
            <button
              type="button"
              className={`settings-option${shuffle ? ' selected' : ''}`}
              aria-pressed={shuffle}
              onClick={toggleShuffle}
            >
              <Icon name="shuffle" size={20} />
              <span className="settings-option-text">
                <strong>Shuffle</strong>
                <small>Play the active queue in a randomized order.</small>
              </span>
              <span className={`settings-switch${shuffle ? ' on' : ''}`} aria-hidden="true" />
            </button>
            <button type="button" className="settings-option" onClick={cycleRepeat}>
              <Icon name={repeat === 'one' ? 'repeat-1' : 'repeat'} size={20} />
              <span className="settings-option-text">
                <strong>Repeat</strong>
                <small>Currently: {repeat === 'off' ? 'Off' : repeat === 'all' ? 'All' : 'One'}. Tap to change.</small>
              </span>
              <span className="settings-pill">{repeat === 'off' ? 'Off' : repeat === 'all' ? 'All' : 'One'}</span>
            </button>
          </div>
        </section>

        {/* --------------------------- Privacy & legal ----------------------- */}
        <section className="settings-section">
          <h2 className="settings-heading">Privacy &amp; Legal</h2>
          <div className="settings-options">
            <Link className="settings-option" to="/privacy">
              <Icon name="check" size={20} />
              <span className="settings-option-text">
                <strong>Privacy Policy</strong>
                <small>How Melody handles your data.</small>
              </span>
              <Icon name="chevron-right" size={16} className="settings-chevron" />
            </Link>
            <Link className="settings-option" to="/privacy">
              <Icon name="check" size={20} />
              <span className="settings-option-text">
                <strong>Terms of Service</strong>
                <small>Read the in-app terms.</small>
              </span>
              <Icon name="chevron-right" size={16} className="settings-chevron" />
            </Link>
            <a
              className="settings-option"
              href="https://www.youtube.com/t/terms"
              target="_blank"
              rel="noopener"
            >
              <Icon name="external-link" size={20} />
              <span className="settings-option-text">
                <strong>YouTube Terms of Service</strong>
                <small>Opens on YouTube.com.</small>
              </span>
              <Icon name="chevron-right" size={16} className="settings-chevron" />
            </a>
          </div>
        </section>

        {/* ------------------------------- About ----------------------------- */}
        <section className="settings-section">
          <h2 className="settings-heading">About Melody</h2>
          <div className="about-card">
            <strong>Melody</strong>
            <p>Your music, all in one place.</p>
            <p className="about-meta">
              Version {VERSION || 'not available'}
              {' · '}Music data and playback powered by YouTube.
            </p>
          </div>
        </section>
      </div>
    </section>
  )
}
