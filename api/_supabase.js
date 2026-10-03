import { createClient } from '@supabase/supabase-js';
import { HttpError } from '../lib/http.js';

// Ré-exports pour compatibilité.
export { json, method, HttpError } from '../lib/http.js';

// Lit la 1re variable définie parmi `name` puis ses alias (ex. VITE_*).
export function env(name, aliases = []) {
  for (const n of [name, ...aliases]) {
    const v = process.env[n];
    if (v) return v;
  }
  throw new Error(`Missing environment variable: ${name}`);
}

const AUTH = { autoRefreshToken: false, persistSession: false };
const supabaseUrl = () => env('SUPABASE_URL', ['VITE_SUPABASE_URL']);
const publishableKey = () => env('SUPABASE_PUBLISHABLE_KEY', ['VITE_SUPABASE_PUBLISHABLE_KEY']);

// Contourne RLS : réservé aux webhooks et tâches serveur, jamais pour agir au nom d'un utilisateur.
export function adminClient() {
  return createClient(supabaseUrl(), env('SUPABASE_SECRET_KEY'), { auth: AUTH });
}

// Lecture publique : RLS s'applique (rôle anon).
export function publicClient() {
  return createClient(supabaseUrl(), publishableKey(), { auth: AUTH });
}

// Client agissant AVEC le JWT de l'utilisateur : RLS s'applique avec auth.uid().
export function userClient(token) {
  return createClient(supabaseUrl(), publishableKey(), {
    auth: AUTH,
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

// Retourne { user, token }.
export async function requireUser(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!m) throw new HttpError(401, 'Authentication required');
  const token = m[1].trim();
  const { data, error } = await publicClient().auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, 'Invalid authentication token');
  return { user: data.user, token };
}
