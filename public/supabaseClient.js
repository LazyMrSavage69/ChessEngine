// supabaseClient.js — single shared Supabase client.
// The Supabase JS SDK is loaded via CDN <script> tag in index.html / admin.html,
// which exposes a global `supabase` namespace (with `.createClient`). We create
// the client ONCE here using the env-injected values from config.js and re-export
// it so every other file imports the same instance.
//
// IMPORTANT: never re-initialize. Always import { supabase } from '/supabaseClient.js'.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '/config.js'

const sdk = (typeof window !== 'undefined' && window.supabase)
  || (typeof self !== 'undefined' && self.supabase)

/**
 * Render a big, helpful error banner into the page when config.js is still
 * holding the build-time placeholders. Without this, the user just sees a
 * blank screen + a cryptic "Invalid supabaseUrl" in the console.
 */
function showConfigError(reason) {
  const msg = `
    <div style="position:fixed; inset:0; display:grid; place-items:center;
                background:#1a1a2e; color:#e8e8f0; font-family:system-ui,sans-serif;
                padding:24px; z-index:9999;">
      <div style="max-width:560px; background:#1e2a47; border:1px solid #f44336;
                  border-radius:12px; padding:28px;">
        <h1 style="margin-bottom:12px; color:#f44336">Supabase not configured</h1>
        <p style="margin-bottom:16px; color:#9ba3b5">${reason}</p>
        <p style="margin-bottom:8px"><strong>To fix this:</strong></p>
        <ol style="margin-left:18px; line-height:1.6; color:#9ba3b5">
          <li>Put your real Supabase URL + anon key in <code>.env</code> at the project root:
            <pre style="background:#0f1626; padding:8px; border-radius:6px; margin-top:6px; overflow-x:auto;">SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key</pre>
          </li>
          <li>Stop the dev server (Ctrl+C) and run <code>npm run dev</code> again — it rebuilds with the .env values into <code>dist/</code> and serves that.</li>
        </ol>
        <p style="margin-top:14px; color:#5c6478; font-size:0.85rem;">
          Alternative: edit <code>config.js</code> directly with your real values, then run <code>npm run dev:raw</code>.
        </p>
      </div>
    </div>`
  // Append (rather than replacing body) so we don't clobber the existing
  // markup if some of it is already mounted.
  document.body.insertAdjacentHTML('beforeend', msg)
}

/** Heuristic: did the build placeholder leak through to the browser? */
function looksLikePlaceholder(s) {
  return !s || s.startsWith('__') && s.endsWith('__')
}

let _supabase = null

if (!sdk || typeof sdk.createClient !== 'function') {
  const reason = 'Supabase SDK script tag failed to load (check your network connection).'
  console.error(reason)
  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => showConfigError(reason))
  }
} else if (looksLikePlaceholder(SUPABASE_URL) || looksLikePlaceholder(SUPABASE_ANON_KEY)) {
  const reason = `config.js still has the placeholder values (got URL="${SUPABASE_URL}"). The browser fetches config.js — it can\'t read .env directly.`
  console.error(reason)
  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => showConfigError(reason))
  }
} else {
  try {
    _supabase = sdk.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  } catch (err) {
    const reason = `Supabase client creation failed: ${err.message || err}`
    console.error(reason)
    if (typeof document !== 'undefined') {
      document.addEventListener('DOMContentLoaded', () => showConfigError(reason))
    }
  }
}

export const supabase = _supabase
