import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BrandMark, Icon } from '../components/Icons.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { isSupabaseConfigured } from '../lib/supabase.js'

/**
 * Create an account - register.php ported to Supabase Auth.
 *
 * The flow is the same as the PHP app: validate, create the account, then go
 * straight to the login page (?registered=1). The new account is NEVER signed
 * in here - the user logs in like everyone else.
 */
export default function Register() {
  const { signUp } = useAuth()
  const navigate = useNavigate()

  const [values, setValues] = useState({ username: '', email: '', password: '', confirm: '' })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const [shown, setShown] = useState({ password: false, confirm: false })

  function setField(name) {
    return (e) => {
      setValues((v) => ({ ...v, [name]: e.target.value }))
      setErrors((err) => (err[name] ? { ...err, [name]: '' } : err))
    }
  }

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    setFormError('')
    setBusy(true)

    const { error } = await signUp(values)
    setBusy(false)

    if (error) {
      setFormError(error)
      return
    }

    navigate('/login?registered=1', { replace: true })
  }

  const err = (name) => errors[name] || ''

  return (
    <main id="main" className="auth-compact">
      <Link className="brand auth-brand" to="/" aria-label="Melody home">
        <BrandMark size={26} />
        <span className="brand-name">Melody</span>
      </Link>

      <div className="auth-card">
        <h1>Create your account</h1>
        <p className="auth-sub">Start building your personal music experience.</p>

        {!isSupabaseConfigured && (
          <p className="alert alert-error" role="alert">
            Supabase is not configured yet. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in
            your environment, then reload this page.
          </p>
        )}

        {formError && (
          <p className="alert alert-error" role="alert">
            {formError}
          </p>
        )}
        {errors.form && (
          <p className="alert alert-error" role="alert">
            {errors.form}
          </p>
        )}

        <form className="auth-form" noValidate onSubmit={submit}>
          <div className="field">
            <label htmlFor="username">Username</label>
            <input
              type="text"
              id="username"
              name="username"
              autoComplete="username"
              maxLength={50}
              placeholder="Choose a username"
              value={values.username}
              onChange={setField('username')}
              aria-invalid={err('username') ? 'true' : undefined}
              aria-describedby={err('username') ? 'username-error' : undefined}
            />
            {err('username') && (
              <p className="field-error" id="username-error" role="alert">
                {err('username')}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="email">Gmail / Email Address</label>
            <input
              type="email"
              id="email"
              name="email"
              autoComplete="email"
              maxLength={255}
              placeholder="Enter your email address"
              value={values.email}
              onChange={setField('email')}
              aria-invalid={err('email') ? 'true' : undefined}
              aria-describedby={err('email') ? 'email-error' : undefined}
            />
            {err('email') && (
              <p className="field-error" id="email-error" role="alert">
                {err('email')}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <div className="pw-wrap">
              <input
                type={shown.password ? 'text' : 'password'}
                id="password"
                name="password"
                autoComplete="new-password"
                placeholder="Create a password"
                value={values.password}
                onChange={setField('password')}
                aria-invalid={err('password') ? 'true' : undefined}
                aria-describedby={err('password') ? 'password-error password-hint' : 'password-hint'}
              />
              <button
                type="button"
                className="pw-toggle"
                aria-label={shown.password ? 'Hide password' : 'Show password'}
                aria-pressed={shown.password}
                onClick={() => setShown((s) => ({ ...s, password: !s.password }))}
              >
                <Icon name="eye" size={18} />
                <Icon name="eye-off" size={18} />
              </button>
            </div>
            <p className="field-hint" id="password-hint">
              At least 8 characters.
            </p>
            {err('password') && (
              <p className="field-error" id="password-error" role="alert">
                {err('password')}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="confirm">Confirm Password</label>
            <div className="pw-wrap">
              <input
                type={shown.confirm ? 'text' : 'password'}
                id="confirm"
                name="confirm"
                autoComplete="new-password"
                placeholder="Re-enter your password"
                value={values.confirm}
                onChange={setField('confirm')}
                aria-invalid={err('confirm') ? 'true' : undefined}
                aria-describedby={err('confirm') ? 'confirm-error' : undefined}
              />
              <button
                type="button"
                className="pw-toggle"
                aria-label={shown.confirm ? 'Hide password confirmation' : 'Show password confirmation'}
                aria-pressed={shown.confirm}
                onClick={() => setShown((s) => ({ ...s, confirm: !s.confirm }))}
              >
                <Icon name="eye" size={18} />
                <Icon name="eye-off" size={18} />
              </button>
            </div>
            {err('confirm') && (
              <p className="field-error" id="confirm-error" role="alert">
                {err('confirm')}
              </p>
            )}
          </div>

          <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy}>
            {busy ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <p className="auth-switch">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </div>
    </main>
  )
}
