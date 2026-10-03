import React, { createContext, useContext, useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const sb = url && key ? createClient(url, key) : null;

const AuthCtx = createContext(null);
export function useAuth() {
  return useContext(AuthCtx);
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  useEffect(() => {
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  return <AuthCtx.Provider value={{ session, sb }}>{children}</AuthCtx.Provider>;
}

export function useHashRoute() {
  const [route, setRoute] = useState(() => window.location.hash.slice(1) || '/');
  useEffect(() => {
    const onHash = () => setRoute(window.location.hash.slice(1) || '/');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const navigate = (path) => {
    window.location.hash = path;
  };
  return [route, navigate];
}
