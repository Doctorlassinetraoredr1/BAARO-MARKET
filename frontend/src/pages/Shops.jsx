import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { ProductCard } from '../components/ProductCard.jsx';

export function ShopsPage({ navigate, setError }) {
  const [shops, setShops] = useState([]);
  useEffect(() => {
    api('/api/market?action=shops')
      .then((d) => setShops(d.shops || []))
      .catch((e) => setError(e.message));
  }, [setError]);
  return (
    <section>
      <h2>Boutiques</h2>
      <div className="grid">
        {shops.map((s) => (
          <article key={s.id} className="card">
            <h3>
              <a
                href={`#/shop/${s.slug}`}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(`/shop/${s.slug}`);
                }}
              >
                {s.name}
              </a>
            </h3>
            <p className="muted">{s.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function ShopPage({ slug, onAdd, navigate, setError }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api(`/api/market?action=shop&slug=${encodeURIComponent(slug)}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [slug, setError]);
  if (!data) return <p className="muted">Chargement…</p>;
  return (
    <section>
      <div className="card">
        <h2>{data.shop.name}</h2>
        <p>{data.shop.description}</p>
      </div>
      <div className="grid">
        {(data.products || []).map((p) => (
          <ProductCard key={p.id} p={{ ...p, shop_id: data.shop.id }} onAdd={onAdd} navigate={navigate} />
        ))}
      </div>
    </section>
  );
}
