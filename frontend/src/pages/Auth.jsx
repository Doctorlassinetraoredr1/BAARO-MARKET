import React, { useState } from 'react';
import { sb } from '../auth.jsx';

export function LoginPage({ setError, setMsg }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  async function auth(mode) {
    if (!sb) return setError('Configurez Supabase (variables Vercel).');
    const r =
      mode === 'in'
        ? await sb.auth.signInWithPassword({ email, password })
        : await sb.auth.signUp({ email, password });
    if (r.error) setError(r.error.message);
    else setMsg(mode === 'in' ? 'Connecté.' : 'Compte créé. Vérifiez votre email si nécessaire.');
  }
  return (
    <section className="card narrow">
      <h2>Connexion</h2>
      <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input
        placeholder="Mot de passe"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <div className="row">
        <button type="button" onClick={() => auth('in')}>
          Se connecter
        </button>
        <button type="button" className="secondary" onClick={() => auth('up')}>
          Créer un compte
        </button>
      </div>
    </section>
  );
}
