/** Loading / error / empty views shared by the Audius sections and pages. */

/** Spinner + label (the non-row layout used on Search and dialogs). */
export function LoadingState({ label = 'Loading…' }) {
  return (
    <div className="audius-state" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

/** Shimmering placeholders for the home rows (no layout jump when data lands). */
export function SkeletonRow({ artists = false, label = 'Loading…' }) {
  return (
    <div className="skeleton-row" role="status">
      <span className="visually-hidden">{label}</span>
      {Array.from({ length: 7 }, (_, i) => (
        <div className={artists ? 'skeleton-artist' : 'skeleton-card'} key={i} aria-hidden="true">
          <span className="skeleton-block" />
          <span className="skeleton-line" />
          <span className="skeleton-line short" />
        </div>
      ))}
    </div>
  )
}

/** Alert with an optional "Try again" button and local-only technical detail. */
export function ErrorState({ message, onRetry, debug = null }) {
  return (
    <div className="alert alert-error audius-error" role="alert">
      <div className="audius-error-row">
        <span>{message}</span>
        {onRetry && (
          <button type="button" className="btn btn-outline" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
      {debug != null && (
        <details className="audius-debug">
          <summary>Technical details (local debugging)</summary>
          <pre>{typeof debug === 'string' ? debug : JSON.stringify(debug, null, 2)}</pre>
        </details>
      )}
    </div>
  )
}

/** Centered empty state with an optional call to action. */
export function EmptyState({ icon, title, text, children }) {
  return (
    <div className="empty-state">
      {icon && (
        <span className="empty-state-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <p className="empty-state-title">{title}</p>
      <p className="empty-state-text">{text}</p>
      {children}
    </div>
  )
}
