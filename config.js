// config.js — placeholders are replaced by build.js at deploy time.
// In development: edit these values directly or set them in your shell before `npm run build`.
// The script tags in index.html load the Supabase JS SDK from a CDN; supabaseClient.js
// reads these constants to create a single shared client used everywhere in the app.

const SUPABASE_URL      = '__SUPABASE_URL__'
const SUPABASE_ANON_KEY = '__SUPABASE_ANON_KEY__'

export { SUPABASE_URL, SUPABASE_ANON_KEY }
