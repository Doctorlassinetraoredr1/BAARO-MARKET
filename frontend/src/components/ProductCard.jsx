import React from 'react';
import { Button } from '../ui/Button.jsx';

function stars(avg) {
  const n = Math.round(Number(avg) || 0);
  return '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));
}

export function ProductCard({ p, onAdd, navigate }) {
  const outOfStock = p.track_inventory !== false && Number(p.stock) <= 0;
  return (
    <article className="card flex flex-col overflow-hidden !p-0 transition hover:shadow-md">
      {p.image_url ? (
        <img src={p.image_url} alt="" loading="lazy" className="h-48 w-full object-cover bg-slate-100" />
      ) : (
        <div className="flex h-48 items-center justify-center bg-gradient-to-br from-slate-100 to-slate-50 text-slate-300 text-sm">
          Pas d&apos;image
        </div>
      )}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="font-semibold leading-snug">
          <a
            href={`#/product/${p.id}`}
            className="hover:text-brand-600"
            onClick={(e) => {
              e.preventDefault();
              navigate(`/product/${p.id}`);
            }}
          >
            {p.name}
          </a>
        </h3>
        {p.rating_count > 0 && (
          <p className="text-amber-500 text-sm tracking-wide" title={`${p.rating_avg}/5`}>
            {stars(p.rating_avg)} <span className="text-muted text-xs">({p.rating_count})</span>
          </p>
        )}
        <p className="text-sm text-muted line-clamp-2">{p.description?.slice(0, 100)}</p>
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <strong className="text-base">
            {p.price} <span className="text-sm font-medium text-muted">{p.currency}</span>
          </strong>
          {p.stock != null && <span className="text-xs text-muted">Stock {p.stock}</span>}
        </div>
        <Button variant="ink" className="w-full mt-1" onClick={() => onAdd(p)} disabled={outOfStock}>
          {outOfStock ? 'Rupture' : 'Ajouter au panier'}
        </Button>
      </div>
    </article>
  );
}
