import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

/**
 * ONE theme system for the whole app. The preference ('light' | 'dark' |
 * 'system') lives in localStorage; the resolved theme is written to
 * <html data-theme> so plain CSS can restyle every component.
 * No per-page theme state, no database writes.
 */
const ThemeContext = createContext(null)
export const THEME_KEY = 'melody:theme'
const TYPES = ['light', 'dark', 'system']

export const inlineThemeScript = `
(function(){
  try {
    var p = localStorage.getItem(${JSON.stringify(THEME_KEY)});
    if (${JSON.stringify(TYPES)}.indexOf(p) < 0) p = 'system';
    var dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = p === 'system' ? (dark ? 'dark' : 'light') : p;
  } catch (e) {
    document.documentElement.dataset.theme = 'dark';
  }
})();`

function readPreference() {
  try {
    const value = localStorage.getItem(THEME_KEY)
    return TYPES.includes(value) ? value : 'system'
  } catch {
    return 'system'
  }
}

function systemDark() {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return true
  }
}

export function ThemeProvider({ children }) {
  const [preference, setPreferenceState] = useState(readPreference)
  const [systemIsDark, setSystemIsDark] = useState(systemDark)

  const resolved = preference === 'system' ? (systemIsDark ? 'dark' : 'light') : preference

  useEffect(() => {
    document.documentElement.dataset.theme = resolved
  }, [resolved])

  useEffect(() => {
    if (preference !== 'system') return undefined
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e) => setSystemIsDark(e.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [preference])

  const setPreference = useCallback((value) => {
    if (!TYPES.includes(value)) return
    setPreferenceState(value)
    try {
      localStorage.setItem(THEME_KEY, value)
    } catch {
      /* private mode: the in-memory choice still applies */
    }
  }, [])

  const value = useMemo(
    () => ({ preference, resolvedTheme: resolved, setPreference }),
    [preference, resolved, setPreference]
  )
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>')
  return ctx
}
