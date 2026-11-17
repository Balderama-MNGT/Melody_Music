/**
 * Legal disclosures required for clients of YouTube API Services.
 * Keep this page linked from the app navigation (see Layout).
 */
export default function Privacy() {
  return (
    <section className="page">
      <h1 className="page-title">Privacy &amp; Terms</h1>
      <div className="legal-copy">
        <p>
          Melody uses YouTube API Services. The YouTube Data API v3 provides
          music search and recommendations, and the YouTube IFrame Player API
          displays and plays videos inside the app. By using Melody you agree
          to the{' '}
          <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener">
            YouTube Terms of Service
          </a>
          .
        </p>
        <p>
          <strong>What we store.</strong> Account details (email and user ID),
          your liked songs, playlists, listening history and preferences are
          stored in Supabase, our database provider. A play record contains the
          video ID, title, artist, artwork, duration, play time and a unique
          session ID. Search text is sent to our own API, which forwards the
          query to YouTube; the API key is never exposed to the browser.
        </p>
        <p>
          <strong>Who receives data.</strong> Search queries and video IDs are
          sent to YouTube. The embedded YouTube player is operated by YouTube
          and may display YouTube branding, links and advertisements. We do not
          sell your personal data.
        </p>
        <p>
          <strong>Device storage.</strong> We use browser storage (localStorage)
          for your session, player preferences and cached music lists so the
          app can work without repeating requests.
        </p>
        <p>
          <strong>Your controls.</strong> You can remove songs from playlists
          and clear your listening history in the app. If you have connected a
          Google account, you can also review or revoke permissions at{' '}
          <a href="https://security.google.com/settings/security/permissions" target="_blank" rel="noopener">
            Google Security settings
          </a>
          . To request deletion of remaining account data, contact the operator
          of this deployment.
        </p>
        <p>
          See also the{' '}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">
            Google Privacy Policy
          </a>
          .
        </p>
      </div>
    </section>
  )
}
