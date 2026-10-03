import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { AuthProvider, useHashRoute } from './auth.jsx';
import { loadCart, saveCart, addToCart } from './cart.js';
import { Header } from './components/Header.jsx';
import { Toast } from './components/Toast.jsx';
import { Home } from './pages/Home.jsx';
import { ProductPage } from './pages/Product.jsx';
import { ShopsPage, ShopPage } from './pages/Shops.jsx';
import { CartPage } from './pages/Cart.jsx';
import { LoginPage } from './pages/Auth.jsx';
import { OrdersPage, OrderConfirmPage, CguPage } from './pages/Orders.jsx';
import { SellerPage } from './pages/Seller.jsx';
import { AdminPage } from './pages/Admin.jsx';
import { I18nProvider, useI18n } from './i18n.js';

function App() {
  const { dir } = useI18n();
  const [route, navigate] = useHashRoute();
  const [cart, setCart] = useState(loadCart);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  function onAdd(p) {
    const next = addToCart(cart, p);
    setCart(next);
    saveCart(next);
    setMsg(`« ${p.name} » ajouté au panier.`);
  }

  const cartCount = cart.reduce((s, i) => s + i.quantity, 0);
  const path = route.split('?')[0];

  let page;
  if (path === '/' || path === '') page = <Home navigate={navigate} onAdd={onAdd} setError={setError} />;
  else if (path.startsWith('/product/'))
    page = <ProductPage id={path.slice('/product/'.length)} onAdd={onAdd} navigate={navigate} setError={setError} />;
  else if (path === '/shops') page = <ShopsPage navigate={navigate} setError={setError} />;
  else if (path.startsWith('/shop/'))
    page = <ShopPage slug={path.slice('/shop/'.length)} onAdd={onAdd} navigate={navigate} setError={setError} />;
  else if (path === '/cart')
    page = <CartPage cart={cart} setCart={setCart} navigate={navigate} setError={setError} setMsg={setMsg} />;
  else if (path === '/login') page = <LoginPage setError={setError} setMsg={setMsg} />;
  else if (path === '/orders') page = <OrdersPage setError={setError} setMsg={setMsg} />;
  else if (path === '/seller') page = <SellerPage setError={setError} setMsg={setMsg} />;
  else if (path === '/admin') page = <AdminPage setError={setError} />;
  else if (path === '/order-confirm' || path.startsWith('/order-confirm'))
    page = <OrderConfirmPage setError={setError} setMsg={setMsg} />;
  else if (path === '/cgu') page = <CguPage />;
  else
    page = (
      <p>
        Page introuvable. <a href="#/">Retour</a>
      </p>
    );

  return (
    <div dir={dir}>
      <Header cartCount={cartCount} navigate={navigate} />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 pb-16">
        <Toast message={error} onClose={() => setError('')} />
        <Toast message={msg} onClose={() => setMsg('')} />
        {page}
        <footer className="footer">
          <a
            href="#/cgu"
            onClick={(e) => {
              e.preventDefault();
              navigate('/cgu');
            }}
          >
            CGU
          </a>
        </footer>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <I18nProvider><AuthProvider><App /></AuthProvider></I18nProvider>
);
