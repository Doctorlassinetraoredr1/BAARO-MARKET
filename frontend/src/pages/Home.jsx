import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { ProductCard } from '../components/ProductCard.jsx';
import { Button } from '../ui/Button.jsx';
import { Input, Select } from '../ui/Input.jsx';
import { Card } from '../ui/Card.jsx';

export function Home({ navigate, onAdd, setError }) {
  const [products, setProducts] = useState([]);
  const [q, setQ] = useState('');
  const [currency, setCurrency] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [sort, setSort] = useState('newest');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ action: 'products' });
      if (q.trim()) params.set('q', q.trim());
      if (currency) params.set('currency', currency);
      if (minPrice !== '') params.set('min_price', minPrice);
      if (maxPrice !== '') params.set('max_price', maxPrice);
      if (sort) params.set('sort', sort);
      const d = await api(`/api/market?${params}`);
      setProducts(d.products || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [q, currency, minPrice, maxPrice, sort, setError]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="space-y-4">
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            className="flex-1"
            placeholder="Rechercher un produit…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()}
            aria-label="Recherche"
          />
          <Button variant="primary" onClick={load}>
            Rechercher
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Select value={currency} onChange={(e) => setCurrency(e.target.value)} className="!w-auto min-w-[8rem]">
            <option value="">Toutes devises</option>
            {['XOF', 'XAF', 'EUR', 'USD', 'MAD', 'NGN', 'GHS'].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
          <Input type="number" placeholder="Prix min" min={0} value={minPrice} onChange={(e) => setMinPrice(e.target.value)} className="!w-28" />
          <Input type="number" placeholder="Prix max" min={0} value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} className="!w-28" />
          <Select value={sort} onChange={(e) => setSort(e.target.value)} className="!w-auto min-w-[9rem]">
            <option value="newest">Plus récents</option>
            <option value="price_asc">Prix ↑</option>
            <option value="price_desc">Prix ↓</option>
            <option value="rating">Mieux notés</option>
          </Select>
        </div>
      </Card>

      {loading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="card animate-pulse space-y-3">
              <div className="h-48 rounded-lg bg-slate-200" />
              <div className="h-4 w-3/4 rounded bg-slate-200" />
              <div className="h-4 w-1/2 rounded bg-slate-200" />
            </div>
          ))}
        </div>
      )}

      {!loading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {products.map((p) => (
            <ProductCard key={p.id} p={p} onAdd={onAdd} navigate={navigate} />
          ))}
        </div>
      )}
      {!loading && products.length === 0 && <p className="text-muted text-center py-12">Aucun produit trouvé.</p>}
    </section>
  );
}
