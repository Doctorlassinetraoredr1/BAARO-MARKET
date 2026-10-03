import React, { useMemo, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { saveCart, cartTotals, shopCount } from '../cart.js';
import { Button } from '../ui/Button.jsx';
import { Input, Select } from '../ui/Input.jsx';
import { Card } from '../ui/Card.jsx';

const EMPTY_ADDR = { name: '', line1: '', line2: '', city: '', state: '', postal_code: '', country: '', phone: '' };

export function CartPage({ cart, setCart, navigate, setError, setMsg }) {
  const { session } = useAuth();
  const [loading, setLoading] = useState(false);
  const [provider, setProvider] = useState('stripe');
  const [address, setAddress] = useState(EMPTY_ADDR);
  const [shippingQuote, setShippingQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [express, setExpress] = useState(false);
  const [selectedRates, setSelectedRates] = useState({});

  const totals = cartTotals(cart);
  const currencies = Object.keys(totals);
  const nShops = shopCount(cart);

  const byShop = useMemo(() => {
    const map = new Map();
    for (const i of cart) {
      const key = i.shop_id || 'unknown';
      if (!map.has(key)) map.set(key, { shop_id: key, name: i.shop_name || 'Boutique', items: [] });
      map.get(key).items.push(i);
    }
    return [...map.values()];
  }, [cart]);

  function updateQty(id, qty) {
    const next = cart
      .map((i) => (i.product_id === id ? { ...i, quantity: qty } : i))
      .filter((i) => i.quantity > 0);
    setCart(next);
    saveCart(next);
    setShippingQuote(null);
  }

  async function quoteShipping() {
    if (cart.length === 0) return;
    if (!address.line1 || !address.city || !address.country) {
      setError('Renseignez adresse, ville et pays pour le devis livraison.');
      return;
    }
    setQuoting(true);
    try {
      const data = await api('/api/shipping', {
        method: 'POST',
        token: session?.access_token,
        body: {
          items: cart.map((i) => ({ product_id: i.product_id, quantity: i.quantity })),
          shipping_address: address,
          express,
        },
      });
      setShippingQuote(data);
      setMsg(
        data.quotes?.some((q) => q.source === 'shippo')
          ? 'Tarifs transporteurs réels (Shippo) obtenus.'
          : `Livraison estimée (grilles) : ${data.total_shipping}`
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setQuoting(false);
    }
  }

  async function checkout() {
    if (!session) {
      setMsg('Connectez-vous pour payer.');
      navigate('/login');
      return;
    }
    if (cart.length === 0) return;
    if (!address.line1 || !address.city || !address.country) {
      setError('Renseignez adresse, ville et pays pour la livraison.');
      return;
    }
    if (currencies.length > 1) {
      setError('Le panier contient plusieurs devises. Payez boutique par boutique ou uniformisez.');
      return;
    }
    setLoading(true);
    try {
      const body = {
        provider,
        items: cart.map((i) => ({ product_id: i.product_id, quantity: i.quantity })),
        express,
        shipping_address: address,
      };
      const data = await api('/api/checkout', {
        method: 'POST',
        token: session.access_token,
        body,
      });

      saveCart([]);
      setCart([]);

      if (data.multi && data.checkouts?.length > 1) {
        sessionStorage.setItem('baaro_pending_checkouts', JSON.stringify(data.checkouts.slice(1)));
        setMsg(`${data.checkouts.length} paiements à enchaîner. Étape 1/${data.checkouts.length}…`);
      }

      if (data.checkout_url) {
        window.location.href = data.checkout_url;
      } else if (data.checkouts?.[0]?.checkout_url) {
        window.location.href = data.checkouts[0].checkout_url;
      } else if (data.checkouts?.[0]?.session_data) {
        setMsg(`Session Adyen créée.`);
        navigate(`/order-confirm?order_id=${data.order_id || data.checkouts[0].order_id}`);
      } else {
        setMsg(`Commande ${data.order_id} créée.`);
        navigate('/orders');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="space-y-4">
      <h2 className="text-xl font-bold">Panier</h2>
      {nShops > 1 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {byShop.map((g, idx) => (
            <div key={g.shop_id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <span className="font-semibold text-brand-600">Étape {idx + 1}</span>
              <div className="text-muted">{g.name || g.shop_id.slice(0, 8)}</div>
              <div className="text-xs text-muted">{g.items.length} article(s)</div>
            </div>
          ))}
        </div>
      )}
      {cart.length === 0 && <p className="text-muted">Votre panier est vide.</p>}

      {byShop.map((g) => (
        <div key={g.shop_id} className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
          <h4 className="mb-2 text-sm font-semibold text-muted">{g.name || `Boutique ${String(g.shop_id).slice(0, 8)}`}</h4>
          <ul className="divide-y divide-slate-200">
            {g.items.map((i) => (
              <li key={i.product_id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="flex-1 font-medium">{i.name}</span>
                <span className="text-sm">
                  {i.price} {i.currency}
                </span>
                <Input
                  type="number"
                  min={1}
                  max={99}
                  value={i.quantity}
                  onChange={(e) => updateQty(i.product_id, Number(e.target.value) || 1)}
                  className="!w-16"
                />
                <Button variant="danger" className="!py-1.5 !px-3 text-xs" onClick={() => updateQty(i.product_id, 0)}>
                  Retirer
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {cart.length > 0 && (
        <>
          <Card className="!bg-slate-50">
            <h3 className="mb-3 font-semibold">Adresse de livraison</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input placeholder="Destinataire" value={address.name} onChange={(e) => setAddress({ ...address, name: e.target.value })} />
              <Input placeholder="Téléphone" value={address.phone} onChange={(e) => setAddress({ ...address, phone: e.target.value })} />
              <Input className="sm:col-span-2" placeholder="Adresse" value={address.line1} onChange={(e) => setAddress({ ...address, line1: e.target.value })} />
              <Input className="sm:col-span-2" placeholder="Complément" value={address.line2} onChange={(e) => setAddress({ ...address, line2: e.target.value })} />
              <Input placeholder="Ville" value={address.city} onChange={(e) => setAddress({ ...address, city: e.target.value })} />
              <Input placeholder="Région" value={address.state} onChange={(e) => setAddress({ ...address, state: e.target.value })} />
              <Input placeholder="Code postal" value={address.postal_code} onChange={(e) => setAddress({ ...address, postal_code: e.target.value })} />
              <Input placeholder="Pays (ISO2)" value={address.country} maxLength={2} onChange={(e) => setAddress({ ...address, country: e.target.value.toUpperCase() })} />
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={express} onChange={(e) => { setExpress(e.target.checked); setShippingQuote(null); }} />
              Livraison express
            </label>
            <Button variant="secondary" className="mt-3" onClick={quoteShipping} disabled={quoting}>
              {quoting ? 'Calcul…' : 'Estimer la livraison'}
            </Button>
            {shippingQuote && (
              <div className="mt-3 space-y-2 text-sm">
                {shippingQuote.quotes?.map((q) => (
                  <div key={q.shop_id} className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong>{q.shop_name}</strong>
                      <span className="badge bg-slate-100 text-slate-700">
                        {q.source === 'shippo' ? 'Shippo' : 'Grille BAARO'}
                      </span>
                    </div>
                    <p className="text-muted">
                      {q.carrier} · {q.service} · {q.amount} {q.currency}
                      {q.estimated_days && ` · ~${q.estimated_days[0]}–${q.estimated_days[1]} j`}
                    </p>
                    {q.alternatives?.length > 1 && (
                      <Select
                        className="mt-2"
                        value={selectedRates[q.shop_id] || q.rate_id || ''}
                        onChange={(e) => setSelectedRates({ ...selectedRates, [q.shop_id]: e.target.value })}
                      >
                        {q.alternatives.map((alt) => (
                          <option key={alt.rate_id || alt.method} value={alt.rate_id || ''}>
                            {alt.carrier} {alt.service} — {alt.amount} {alt.currency}
                          </option>
                        ))}
                      </Select>
                    )}
                  </div>
                ))}
                <p className="font-semibold">Total livraison : {shippingQuote.total_shipping}</p>
              </div>
            )}
          </Card>

          <div className="flex flex-wrap items-center gap-3">
            {currencies.map((cur) => (
              <strong key={cur} className="text-lg">
                {totals[cur].total.toFixed(2)} {cur}
                {totals[cur].tax > 0 && (
                  <span className="ml-1 text-sm font-normal text-muted">(TVA ~{totals[cur].tax.toFixed(2)})</span>
                )}
              </strong>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Select value={provider} onChange={(e) => setProvider(e.target.value)} className="!w-auto">
              <option value="stripe">Stripe</option>
              <option value="paypal">PayPal</option>
              <option value="adyen">Adyen</option>
            </Select>
            <Button variant="primary" onClick={checkout} disabled={loading}>
              {loading
                ? 'Redirection…'
                : nShops > 1
                  ? `Payer (${nShops} boutiques)`
                  : `Payer avec ${provider}`}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
