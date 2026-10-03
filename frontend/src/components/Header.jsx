import React from 'react';
import { LanguageSelect, useI18n } from '../i18n.jsx';
import { useAuth, sb } from '../auth.jsx';

export function Header({ cartCount, navigate }) {
  const { session } = useAuth();
  const { t } = useI18n();
  const go = (path) => (e) => {
    e.preventDefault();
    navigate(path);
  };
  return (
    <header className="topbar">
      <div className="topbar-brand">
        <a href="#/" className="logo" onClick={go('/')}>
          BAARO<span style={{ color: 'var(--primary)' }}>·</span>MARKET
        </a>
        <LanguageSelect />
      </div>
      <nav>
        <a href="#/" onClick={go('/')}>{t('products')}</a>
        <a href="#/shops" onClick={go('/shops')}>{t('shops')}</a>
        <a href="#/cart" onClick={go('/cart')}>
          {t('cart')}
          {cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
        </a>
        {session && <a href="#/orders" onClick={go('/orders')}>{t('orders')}</a>}
        {session && <a href="#/seller" onClick={go('/seller')}>{t('seller')}</a>}
        {session ? (
          <button type="button" className="secondary" onClick={() => sb?.auth.signOut()}>
            Déconnexion
          </button>
        ) : (
          <button type="button" className="primary" onClick={go('/login')}>
            Connexion
          </button>
        )}
      </nav>
    </header>
  );
}
