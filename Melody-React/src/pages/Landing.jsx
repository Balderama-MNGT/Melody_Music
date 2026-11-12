import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { BrandMark } from '../components/Icons.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { usePlayer } from '../context/PlayerContext.jsx'

const YEAR = new Date().getFullYear()

const CHECK_ICON = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
)

const ALERT_ICON = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
)

/** URL flags the notices key off (?logged_out=1, ...) - one-shot: stripped from the URL once shown. */
const ONE_SHOT_FLAGS = ['logged_out', 'registered', 'welcome', 'denied']

/**
 * Public landing page - index.php's public view: hero, feature cards, footer,
 * and the popup notice for "logged out" / "account created".
 */
export default function Landing() {
  const { isAuthenticated, signOut } = useAuth()
  const { playing } = usePlayer()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [notice, setNotice] = useState(() => pickNotice(params, isAuthenticated))
  const [leaving, setLeaving] = useState(false)
  const [confirmingLogout, setConfirmingLogout] = useState(false)
  const noticeRef = useRef(null)

  const dismiss = useCallback(() => {
    setLeaving(true)
    setTimeout(() => setNotice(null), 300)
  }, [])

  /* The URL notices index.php showed (?logged_out=1, ?registered=1, ...) -
     also reacting when the params change while this page is mounted. */
  useEffect(() => {
    const found = pickNotice(params, isAuthenticated)
    if (found) {
      setNotice(found)
      setLeaving(false)
    }
    // One-shot flags are dropped from the URL so a refresh doesn't re-show
    // the popup (dialogs.js did the same).
    if (ONE_SHOT_FLAGS.some((key) => params.has(key))) {
      const next = new URLSearchParams(params)
      ONE_SHOT_FLAGS.forEach((key) => next.delete(key))
      setParams(next, { replace: true })
    }
  }, [params, isAuthenticated, setParams])

  /* The popup closes itself after 6.5s - the timer pauses while you hover
     or focus it, exactly like the PHP notice. */
  useEffect(() => {
    if (!notice) return undefined
    let timer = setTimeout(dismiss, 6500)
    const el = noticeRef.current
    const pause = () => clearTimeout(timer)
    const resume = () => {
      clearTimeout(timer)
      timer = setTimeout(dismiss, 6500)
    }
    el?.addEventListener('mouseenter', pause)
    el?.addEventListener('mouseleave', resume)
    el?.addEventListener('focusin', pause)
    el?.addEventListener('focusout', resume)
    return () => {
      clearTimeout(timer)
      el?.removeEventListener('mouseenter', pause)
      el?.removeEventListener('mouseleave', resume)
      el?.removeEventListener('focusin', pause)
      el?.removeEventListener('focusout', resume)
    }
  }, [notice, dismiss])

  async function logout() {
    setConfirmingLogout(false)
    // Land first (?logged_out=1 drives the popup), then drop the session.
    navigate('/?logged_out=1')
    await signOut()
  }

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>

      <header className="site-nav">
        <div className="site-nav-inner">
          <Link className="brand" to="/" aria-label="Melody home">
            <BrandMark size={26} />
            <span className="brand-name">Melody</span>
          </Link>
          <nav className="site-nav-actions" aria-label="Account">
            {isAuthenticated ? (
              <>
                <Link className="btn btn-ghost" to="/app">
                  Continue to Melody
                </Link>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setConfirmingLogout(true)}
                >
                  Log out
                </button>
              </>
            ) : (
              <>
                <Link className="btn btn-ghost" to="/login">
                  Log In
                </Link>
                <Link className="btn btn-primary" to="/register">
                  Get Started
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main id="main">
        {notice && (
          <div
            ref={noticeRef}
            className={`popup-notice ${notice.error ? 'popup-error' : 'popup-success'}${leaving ? ' is-leaving' : ''}`}
            role={notice.error ? 'alert' : 'status'}
            aria-live="polite"
          >
            <span className="popup-icon" aria-hidden="true">
              {notice.error ? ALERT_ICON : CHECK_ICON}
            </span>
            <div className="popup-body">
              <p className="popup-title">{notice.title}</p>
              <p className="popup-text">{notice.text}</p>
            </div>
            <button type="button" className="popup-close" aria-label="Dismiss notification" onClick={dismiss}>
              &times;
            </button>
          </div>
        )}

        {/* Hero */}
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">YOUR MUSIC. YOUR MOMENT.</p>
            <h1 id="hero-title">
              Your Soundtrack.
              <br />
              Your World.
            </h1>
            <p className="hero-lead">
              Discover your next favorite song, create playlists that match your mood, and keep the
              music going.
            </p>
            <div className="hero-actions">
              {isAuthenticated ? (
                <Link className="btn btn-primary btn-lg" to="/app">
                  Continue to Melody
                </Link>
              ) : (
                <>
                  <Link className="btn btn-primary btn-lg" to="/register">
                    Start Listening
                  </Link>
                  <Link className="btn btn-ghost btn-lg" to="/login">
                    Already have an account? Log in
                  </Link>
                </>
              )}
            </div>
          </div>

          {/* Decorative music art built entirely with CSS (no image assets). */}
          <div className="hero-art" aria-hidden="true">
            <div className="art-glow" />
            <div className="art-disc">
              <div className="art-disc-ring" />
              <div className="art-disc-hole" />
            </div>
            <div className="art-cover art-cover-1">
              <span />
            </div>
            <div className="art-cover art-cover-2">
              <span />
            </div>
            <div className="art-eq">
              <i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i />
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="features" aria-labelledby="features-title">
          <h2 id="features-title" className="visually-hidden">
            What Melody offers
          </h2>
          <div className="feature-grid">
            <article className="feature-card">
              <span className="feature-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
              </span>
              <h3>Discover Music</h3>
              <p>Explore a growing collection of music and find songs that match your taste.</p>
            </article>
            <article className="feature-card">
              <span className="feature-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15V6l-7 2v9" />
                  <circle cx="7" cy="18" r="3" />
                  <path d="M3 6h8M3 10h6" />
                </svg>
              </span>
              <h3>Your Personal Playlists</h3>
              <p>Organize your favorite tracks into playlists for every mood and moment.</p>
            </article>
            <article className="feature-card">
              <span className="feature-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4" />
                </svg>
              </span>
              <h3>Music That Moves You</h3>
              <p>Enjoy a smooth listening experience with your music always within reach.</p>
            </article>
          </div>
          <p className="feature-note">Some features are rolled out gradually as Melody grows.</p>
        </section>
      </main>

      <footer className="site-footer">
        <div className="site-footer-inner">
          <Link className="brand" to="/" aria-label="Melody home">
            <BrandMark size={26} />
            <span className="brand-name">Melody</span>
          </Link>
          <p className="footer-note">Made for the love of music.</p>
          <p className="footer-copy">&copy; {YEAR} Melody. All rights reserved.</p>
        </div>
      </footer>

      {confirmingLogout && (
        <ConfirmDialog
          title="Log out of Melody?"
          message={
            playing
              ? 'Your music will stop playing and you will be signed out on this device.'
              : 'You will be signed out on this device. You can log back in anytime.'
          }
          confirmText="Log out"
          cancelText="Stay logged in"
          onConfirm={logout}
          onCancel={() => setConfirmingLogout(false)}
        />
      )}
    </>
  )
}

/** The same notices index.php showed in the URL (?logged_out=1, ?registered=1, ...). */
function pickNotice(params, authenticated) {
  if (params.get('logged_out') === '1') {
    return { title: 'Logged out', text: "You've been logged out. Come back anytime.", error: false }
  }
  if (params.get('registered') === '1') {
    return { title: 'Account created', text: 'Your account was created. Welcome to Melody!', error: false }
  }
  if (params.get('welcome') === '1' && authenticated) {
    return { title: 'Welcome', text: 'Welcome! Your account is ready.', error: false }
  }
  if (params.get('denied') === '1') {
    return { title: 'Please log in', text: 'Please log in to continue.', error: true }
  }
  return null
}
