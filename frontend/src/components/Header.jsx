import { LanguageSelect } from '../i18n.js';
import React from 'react';
import { useAuth, sb } from '../auth.jsx';
import { useI18n } from '../i18n.js';

export function Header({ cartCount, navigate }) {
  const { session } = useAuth();
  const { t } = useI18n();
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <a
          href="#/"
          className="text-lg font-extrabold tracking-tight text-ink"
          onClick={(e) => {
            e.preventDefault();
            navigate('/');
          }}
        >
          BAARO<span className="text-brand-600">·</span>MARKET
        </a>
        <LanguageSelect />
      <nav className="flex flex-wrap items-center gap-1 sm:gap-3 text-sm font-medium">
          <a href="#/" className="rounded-lg px-2 py-1.5 text-muted hover:text-ink hover:bg-slate-100" onClick={(e) => { e.preventDefault(); navigate('/'); }}>{t('products')}</a>
          <a href="#/shops" className="rounded-lg px-2 py-1.5 text-muted hover:text-ink hover:bg-slate-100" onClick={(e) => { e.preventDefault(); navigate('/shops'); }}>{t('shops')}</a>
          <a href="#/cart" className="rounded-lg px-2 py-1.5 text-muted hover:text-ink hover:bg-slate-100 inline-flex items-center gap-1.5" onClick={(e) => { e.preventDefault(); navigate('/cart'); }}>
            {t('cart')}
            {cartCount > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 text-xs font-semibold text-white">
                {cartCount}
              </span>
            )}
          </a>
          {session && (
            <>
              <a href="#/orders" className="rounded-lg px-2 py-1.5 text-muted hover:text-ink hover:bg-slate-100" onClick={(e) => { e.preventDefault(); navigate('/orders'); }}>{t('orders')}</a>
              <a href="#/seller" className="rounded-lg px-2 py-1.5 text-muted hover:text-ink hover:bg-slate-100" onClick={(e) => { e.preventDefault(); navigate('/seller'); }}>{t('seller')}</a>
            </>
          )}
          {session ? (
            <button type="button" className="btn-ghost text-sm" onClick={() => sb?.auth.signOut()}>
              Déconnexion
            </button>
          ) : (
            <a href="#/login" className="btn-primary text-sm !py-1.5" onClick={(e) => { e.preventDefault(); navigate('/login'); }}>
              Connexion
            </a>
          )}
        </nav>
      </div>
    </header>
  );
}
