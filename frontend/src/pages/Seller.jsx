import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

export function SellerPage({ setError, setMsg }) {
  const { session } = useAuth();
  const [me, setMe] = useState(null);
  const [shopOrders, setShopOrders] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [ordersShopId, setOrdersShopId] = useState('');
  const [shopForm, setShopForm] = useState({ name: '', slug: '', description: '', country: '' });
  const [prodForm, setProdForm] = useState({
    shop_id: '',
    name: '',
    slug: '',
    description: '',
    price: '',
    currency: 'EUR',
    stock: '10',
    tax_rate_bps: '2000',
    weight_grams: '0',
    image_url: '',
  });

  const refresh = useCallback(() => {
    if (!session) return;
    api('/api/market', { method: 'POST', token: session.access_token, body: { action: 'me' } })
      .then((d) => {
        setMe(d);
        setProdForm((f) => (f.shop_id || !d.shops?.length ? f : { ...f, shop_id: d.shops[0].id }));
        setOrdersShopId((id) => id || d.shops?.[0]?.id || '');
      })
      .catch((e) => setError(e.message));
  }, [session, setError]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const loadAnalytics = useCallback(() => {
    if (!session || !ordersShopId) return;
    api('/api/market', { method:'POST', token:session.access_token, body:{action:'shopAnalytics', shop_id:ordersShopId} }).then(d=>setAnalytics(d.analytics)).catch(e=>setError(e.message));
  }, [session, ordersShopId, setError]);

  const loadShopOrders = useCallback(() => {
    if (!session || !ordersShopId) return;
    api('/api/market', {
      method: 'POST',
      token: session.access_token,
      body: { action: 'shopOrders', shop_id: ordersShopId },
    })
      .then((d) => setShopOrders(d.orders || []))
      .catch((e) => setError(e.message));
  }, [session, ordersShopId, setError]);

  useEffect(() => { loadShopOrders(); loadAnalytics(); }, [loadShopOrders, loadAnalytics]);

  const [shipForm, setShipForm] = useState({ shop_id: '', line1: '', city: '', postal_code: '', country: '', phone: '' });

  async function saveShippingOrigin() {
    if (!session || !shipForm.shop_id) return;
    try {
      await api('/api/market', {
        method: 'POST',
        token: session.access_token,
        body: { action: 'updateShopShipping', ...shipForm },
      });
      setMsg('Adresse d\'expédition enregistrée (requise pour Shippo).');
      refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  async function buyLabel(orderId) {
    if (!session) return;
    try {
      const d = await api('/api/shipping-label', {
        method: 'POST',
        token: session.access_token,
        body: { order_id: orderId },
      });
      setMsg(d.tracking_number ? `Étiquette : ${d.tracking_number}` : 'Étiquette créée');
      if (d.label_url) window.open(d.label_url, '_blank');
    } catch (e) {
      setError(e.message);
    }
  }

  async function createShop() {
    try {
      const payload = { ...shopForm, slug: shopForm.slug.trim() || slugify(shopForm.name) };
      await api('/api/market', {
        method: 'POST',
        token: session.access_token,
        body: { action: 'createShop', ...payload },
      });
      setMsg('Boutique créée.');
      setShopForm({ name: '', slug: '', description: '', country: '' });
      refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  async function createProduct() {
    try {
      await api('/api/market', {
        method: 'POST',
        token: session.access_token,
        body: {
          action: 'createProduct',
          ...prodForm,
          slug: prodForm.slug.trim() || slugify(prodForm.name),
          price: Number(prodForm.price),
          stock: Number(prodForm.stock),
          tax_rate_bps: Number(prodForm.tax_rate_bps),
          weight_grams: Number(prodForm.weight_grams) || 0,
        },
      });
      setMsg('Produit créé.');
      setProdForm((f) => ({
        ...f,
        name: '',
        slug: '',
        description: '',
        price: '',
        stock: '10',
        image_url: '',
      }));
    } catch (e) {
      setError(e.message);
    }
  }

  async function acceptCgu(shopId) {
    try {
      await api('/api/market', {
        method: 'POST',
        token: session.access_token,
        body: { action: 'acceptCgu', shop_id: shopId },
      });
      setMsg('CGU acceptées.');
      refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  async function connectStripe(shopId) {
    try {
      const data = await api('/api/market', {
        method: 'POST',
        token: session.access_token,
        body: {
          action: 'connectStripe',
          shop_id: shopId,
          return_url: window.location.origin + '/#/seller',
          refresh_url: window.location.origin + '/#/seller',
        },
      });
      window.location.href = data.url;
    } catch (e) {
      setError(e.message);
    }
  }

  async function refreshConnect(shopId) {
    try {
      const data = await api('/api/market', {
        method: 'POST',
        token: session.access_token,
        body: { action: 'refreshConnectStatus', shop_id: shopId },
      });
      setMsg(data.charges_enabled ? 'Paiements activés.' : 'Onboarding incomplet.');
      refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  async function refundOrder(orderId) {
    if (!window.confirm('Rembourser intégralement cette commande ?')) return;
    try {
      await api('/api/refund', {
        method: 'POST',
        token: session.access_token,
        body: { order_id: orderId },
      });
      setMsg('Remboursement initié.');
      loadShopOrders();
    } catch (e) {
      setError(e.message);
    }
  }

  async function uploadImage(file) {
    if (!file || !session) return;
    try {
      const signed = await api('/api/upload', {
        method: 'POST',
        token: session.access_token,
        body: { content_type: file.type, size: file.size },
      });
      const put = await fetch(signed.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!put.ok) throw new Error('Upload R2 échoué');
      setProdForm((f) => ({ ...f, image_url: signed.public_url }));
      setMsg('Image uploadée.');
    } catch (e) {
      setError(e.message);
    }
  }

  if (!session) return <p>Connectez-vous.</p>;

  return (
    <section>
      {analytics && <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">{[['Chiffre d’affaires', `${analytics.revenue}`, 'success'],['Commandes',analytics.paid_orders],['Note moyenne',analytics.average_rating||'—'],['Avis à vérifier',analytics.flagged_reviews]].map(([l,v],i)=><div className="card" key={i}><div className="muted">{l}</div><div className="text-2xl font-bold">{v}</div></div>)}</div>}

      <h2>Espace vendeur</h2>
      <div className="card">
        <h3>Créer une boutique</h3>
        <input placeholder="Nom" value={shopForm.name} onChange={(e) => setShopForm({ ...shopForm, name: e.target.value })} />
        <input placeholder="Slug (ex: ma-boutique)" value={shopForm.slug} onChange={(e) => setShopForm({ ...shopForm, slug: e.target.value })} />
        <input placeholder="Description" value={shopForm.description} onChange={(e) => setShopForm({ ...shopForm, description: e.target.value })} />
        <input placeholder="Pays (FR, ML…)" value={shopForm.country} onChange={(e) => setShopForm({ ...shopForm, country: e.target.value })} maxLength={2} />
        <button type="button" onClick={createShop}>
          Créer
        </button>
      </div>

      {(me?.shops || []).map((s) => (
        <div key={s.id} className="card">
          <h3>{s.name}</h3>
          <p className="muted">slug: {s.slug}</p>
          <p className="muted">
            CGU : {s.cgu_accepted_at ? '✓ acceptées' : 'non acceptées'} · Connect :{' '}
            {s.stripe_charges_enabled ? '✓ activé' : s.stripe_account_id ? 'en cours' : 'non lié'}
          </p>
          <div className="row">
            {!s.cgu_accepted_at && (
              <button type="button" className="secondary" onClick={() => acceptCgu(s.id)}>
                Accepter les CGU
              </button>
            )}
            <button type="button" onClick={() => connectStripe(s.id)}>
              {s.stripe_account_id ? 'Continuer onboarding Stripe' : 'Lier Stripe Connect'}
            </button>
            {s.stripe_account_id && (
              <button type="button" className="secondary" onClick={() => refreshConnect(s.id)}>
                Rafraîchir statut
              </button>
            )}
          </div>
        </div>
      ))}

      <div className="card">
        <h3>Ajouter un produit</h3>
        <select value={prodForm.shop_id} onChange={(e) => setProdForm({ ...prodForm, shop_id: e.target.value })}>
          <option value="">Choisir une boutique</option>
          {(me?.shops || []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <input placeholder="Nom" value={prodForm.name} onChange={(e) => setProdForm({ ...prodForm, name: e.target.value })} />
        <input placeholder="Slug" value={prodForm.slug} onChange={(e) => setProdForm({ ...prodForm, slug: e.target.value })} />
        <input placeholder="Description" value={prodForm.description} onChange={(e) => setProdForm({ ...prodForm, description: e.target.value })} />
        <input placeholder="Prix" value={prodForm.price} onChange={(e) => setProdForm({ ...prodForm, price: e.target.value })} />
        <input placeholder="Devise" value={prodForm.currency} onChange={(e) => setProdForm({ ...prodForm, currency: e.target.value })} />
        <input placeholder="Stock" value={prodForm.stock} onChange={(e) => setProdForm({ ...prodForm, stock: e.target.value })} />
        <input placeholder="TVA (bps, 2000=20%)" value={prodForm.tax_rate_bps} onChange={(e) => setProdForm({ ...prodForm, tax_rate_bps: e.target.value })} />
        <input placeholder="Poids (grammes)" value={prodForm.weight_grams} onChange={(e) => setProdForm({ ...prodForm, weight_grams: e.target.value })} />
        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => uploadImage(e.target.files?.[0])} />
        {prodForm.image_url && <p className="muted">Image: {prodForm.image_url}</p>}
        <button type="button" onClick={createProduct}>
          Créer le produit
        </button>
      </div>

      <div className="card">
        <h3>Commandes de la boutique</h3>
        <select value={ordersShopId} onChange={(e) => setOrdersShopId(e.target.value)}>
          <option value="">Choisir une boutique</option>
          {(me?.shops || []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button type="button" className="secondary" onClick={loadShopOrders} style={{ marginTop: 8 }}>
          Rafraîchir
        </button>
        {shopOrders.length === 0 && <p className="muted">Aucune commande.</p>}
        <ul className="orders-list">
          {shopOrders.map((o) => (
            <li key={o.id}>
              <code>{o.id.slice(0, 8)}</code>
              <span className={`badge status-${o.status}`}>{o.status}</span>
              <span>
                {o.total ?? o.subtotal} {o.currency}
              </span>
              <span className="muted">{new Date(o.created_at).toLocaleString()}</span>
              {['paid', 'partially_refunded'].includes(o.status) && (
                <>
                  <button type="button" className="secondary" onClick={() => buyLabel(o.id)}>
                    Étiquette
                  </button>
                  <button type="button" className="danger" onClick={() => refundOrder(o.id)}>
                    Rembourser
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h3>Adresse d&apos;expédition (transporteurs réels)</h3>
        <p className="muted">
          Requise pour obtenir des tarifs Shippo et imprimer des étiquettes. Sans adresse, les grilles BAARO
          s&apos;appliquent.
        </p>
        <select
          value={shipForm.shop_id}
          onChange={(e) => setShipForm({ ...shipForm, shop_id: e.target.value })}
        >
          <option value="">Choisir une boutique</option>
          {(me?.shops || []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <input
          placeholder="Adresse"
          value={shipForm.line1}
          onChange={(e) => setShipForm({ ...shipForm, line1: e.target.value })}
        />
        <input
          placeholder="Ville"
          value={shipForm.city}
          onChange={(e) => setShipForm({ ...shipForm, city: e.target.value })}
        />
        <input
          placeholder="Code postal"
          value={shipForm.postal_code}
          onChange={(e) => setShipForm({ ...shipForm, postal_code: e.target.value })}
        />
        <input
          placeholder="Pays ISO2"
          value={shipForm.country}
          maxLength={2}
          onChange={(e) => setShipForm({ ...shipForm, country: e.target.value.toUpperCase() })}
        />
        <input
          placeholder="Téléphone"
          value={shipForm.phone}
          onChange={(e) => setShipForm({ ...shipForm, phone: e.target.value })}
        />
        <button type="button" onClick={saveShippingOrigin}>
          Enregistrer l&apos;adresse d&apos;expédition
        </button>
      </div>

      <div className="card">
        <h3>CGU / Modération</h3>
        <p className="muted">
          Les produits sont soumis à modération (<code>moderation_status</code>). Les CGU doivent être acceptées avant
          la première mise en vente.
        </p>
      </div>
    </section>
  );
}
