import { useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { BrandMark, Icon } from '../components/Icons.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { isSupabaseConfigured } from '../lib/supabase.js'

/**
 * Log in - login.php ported to Supabase Auth.
 * Generic failure message (no user enumeration) and, after registering,
 * the same "Your account was created successfully" notice (?registered=1).
 */
export default function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const registered = params.get('registered') === '1'
  const from = location.state?.from || '/app'

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    setError('')
    setBusy(true)
    const { error: err } = await signIn({ email, password })
    setBusy(false)
    if (err) {
      setError(err)
      return
    }
    navigate(from, { replace: true })
  }

  return (
    <div className="auth-shell">
      {/* Decorative visual panel (desktop only, pure CSS) */}
      <aside className="auth-visual" aria-hidden="true">
        <div className="auth-visual-glow" />
        <div className="auth-visual-disc">
          <span className="auth-visual-hole" />
        </div>
        <div className="auth-visual-eq">
          <i /><i /><i /><i /><i /><i /><i /><i />
        </div>
        <p className="auth-visual-tag">YOUR MUSIC. YOUR MOMENT.</p>
      </aside>

      <main id="main" className="auth-panel">
        <Link className="brand auth-brand" to="/" aria-label="Melody home">
          <BrandMark size={26} />
          <span className="brand-name">Melody</span>
        </Link>

        <div className="auth-card">
          <h1>Welcome back</h1>
          <p className="auth-sub">Your music is waiting for you.</p>

          {registered && (
            <p className="alert alert-success" role="status">
              Your account was created successfully. Please log in with your new credentials.
            </p>
          )}

          {!isSupabaseConfigured && (
            <p className="alert alert-error" role="alert">
              Supabase is not configured yet. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in
              your environment, then reload this page.
            </p>
          )}

          {error && (
            <p className="alert alert-error" role="alert">
              {error}
            </p>
          )}

          <form className="auth-form" noValidate onSubmit={submit}>
            <div className="field">
              <label htmlFor="email">Email address</label>
              <input
                type="email"
                id="email"
                name="email"
                autoComplete="email"
                maxLength={255}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="field">
              <label htmlFor="password">Password</label>
              <div className="pw-wrap">
                <input
                  type={showPw ? 'text' : 'password'}
                  id="password"
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="pw-toggle"
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                  aria-pressed={showPw}
                  onClick={() => setShowPw((v) => !v)}
                >
                  <Icon name="eye" size={18} />
                  <Icon name="eye-off" size={18} />
                </button>
              </div>
            </div>

            <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy}>
              {busy ? 'Logging in...' : 'Log In'}
            </button>
          </form>

          <p className="auth-switch">
            New to Melody? <Link to="/register">Create an account</Link>
          </p>
          <p className="auth-back">
            <Link to="/">&larr; Back to home</Link>
          </p>
        </div>
      </main>
    </div>
  )
}
