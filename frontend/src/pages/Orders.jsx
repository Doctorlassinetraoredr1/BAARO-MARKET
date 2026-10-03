import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

export function OrdersPage({ setError, setMsg }) {
  const { session } = useAuth();
  const [orders, setOrders] = useState([]);
  useEffect(() => {
    if (!session) return;
    api('/api/market', { method: 'POST', token: session.access_token, body: { action: 'myOrders' } })
      .then((d) => setOrders(d.orders || []))
      .catch((e) => setError(e.message));
  }, [session, setError]);
  return (
    <section className="card">
      <h2>Mes commandes</h2>
      {orders.length === 0 && <p className="muted">Aucune commande.</p>}
      <ul className="orders-list">
        {orders.map((o) => (
          <li key={o.id}>
            <code>{o.id.slice(0, 8)}</code>
            <span className={`badge status-${o.status}`}>{o.status}</span>
            <span>
              {o.total ?? o.subtotal} {o.currency}
            </span>
            <span className="muted">{new Date(o.created_at).toLocaleString()}</span>
            {o.shops && <span>{o.shops.name}</span>}
            <a
              href={`#/order-confirm?order_id=${o.id}`}
              onClick={(e) => {
                e.preventDefault();
                window.location.hash = `/order-confirm?order_id=${o.id}`;
              }}
            >
              Détail
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function OrderConfirmPage({ setError, setMsg }) {
  const { session } = useAuth();
  const [order, setOrder] = useState(null);
  const [disputeReason, setDisputeReason] = useState('not_received');
  const [disputeDesc, setDisputeDesc] = useState('');
  const [disputeLoading, setDisputeLoading] = useState(false);
  const [pendingNext, setPendingNext] = useState(null);
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const search = new URLSearchParams(window.location.search);
  const orderId = params.get('order_id') || search.get('order_id') || '';

  useEffect(() => {
    if (!orderId || !session) return;
    api('/api/market', {
      method: 'POST',
      token: session.access_token,
      body: { action: 'orderDetail', id: orderId },
    })
      .then((d) => setOrder(d.order))
      .catch((e) => setError(e.message));
  }, [orderId, session, setError]);

  // Multi-checkout : proposer le paiement suivant (manuel + auto)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('baaro_pending_checkouts');
      if (!raw) return;
      const list = JSON.parse(raw);
      if (!Array.isArray(list) || !list.length) {
        sessionStorage.removeItem('baaro_pending_checkouts');
        return;
      }
      if (order?.status === 'paid' && list[0]?.checkout_url) {
        setPendingNext(list[0]);
        const next = list[0];
        sessionStorage.setItem('baaro_pending_checkouts', JSON.stringify(list.slice(1)));
        setMsg?.(`Prochain paiement : ${next.shop_name || 'boutique'} — redirection dans 4 s…`);
        const t = setTimeout(() => {
          window.location.href = next.checkout_url;
        }, 4000);
        return () => clearTimeout(t);
      }
    } catch {
      /* ignore */
    }
  }, [order, setMsg]);

  async function openDispute(e) {
    e.preventDefault();
    if (!session || !order) return;
    setDisputeLoading(true);
    try {
      await api('/api/market', {
        method: 'POST',
        token: session.access_token,
        body: {
          action: 'openDispute',
          order_id: order.id,
          reason: disputeReason,
          description: disputeDesc,
        },
      });
      setMsg?.('Litige ouvert. Le vendeur et le support seront notifiés.');
      setDisputeDesc('');
    } catch (err) {
      setError(err.message);
    } finally {
      setDisputeLoading(false);
    }
  }

  if (!orderId) return <section className="card"><p>Aucune commande indiquée.</p></section>;
  if (!session) return <section className="card"><p>Connectez-vous pour voir la confirmation.</p></section>;
  if (!order) return <p className="muted">Chargement de la commande…</p>;

  return (
    <section className="card">
      <h2>Confirmation</h2>
      <p>
        Commande <code>{order.id}</code>
      </p>
      <p>
        Statut : <span className={`badge status-${order.status}`}>{order.status}</span>
      </p>
      <p>
        Total : <strong>{order.total ?? order.subtotal} {order.currency}</strong>
      </p>
      {Number(order.shipping_total) > 0 && (
        <p className="muted">Livraison : {order.shipping_total} {order.currency}</p>
      )}
      {order.status === 'pending' && (
        <p className="muted">Paiement en cours de confirmation. Rafraîchissez dans quelques secondes.</p>
      )}
      {order.status === 'paid' && <p>Merci ! Votre paiement a été accepté.</p>}
      {['failed', 'cancelled'].includes(order.status) && (
        <p>Le paiement n&apos;a pas abouti. Vous pouvez réessayer depuis le panier.</p>
      )}

      {pendingNext && (
        <div className="card" style={{ background: '#eff6ff', borderColor: '#93c5fd' }}>
          <p>
            <strong>Paiement multi-boutiques</strong> — prochaine boutique : {pendingNext.shop_name || '…'}
          </p>
          <button
            type="button"
            className="primary"
            onClick={() => {
              window.location.href = pendingNext.checkout_url;
            }}
          >
            Payer maintenant ({pendingNext.total} {pendingNext.currency})
          </button>
        </div>
      )}

      {order.status === 'paid' && (
        <form onSubmit={openDispute} style={{ marginTop: 24 }}>
          <h3>Ouvrir un litige</h3>
          <p className="muted">En cas de problème (non reçu, non conforme, endommagé).</p>
          <select value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)}>
            <option value="not_received">Non reçu</option>
            <option value="not_as_described">Non conforme</option>
            <option value="damaged">Endommagé</option>
            <option value="other">Autre</option>
          </select>
          <textarea
            placeholder="Décrivez le problème"
            value={disputeDesc}
            onChange={(e) => setDisputeDesc(e.target.value)}
            required
            minLength={10}
            maxLength={2000}
            rows={3}
            style={{ width: '100%' }}
          />
          <button type="submit" className="secondary" disabled={disputeLoading}>
            {disputeLoading ? 'Envoi…' : 'Ouvrir un litige'}
          </button>
        </form>
      )}
    </section>
  );
}

export function CguPage() {
  return (
    <section className="card">
      <h2>Conditions générales d&apos;utilisation</h2>
      <p>
        BAARO-MARKET est une marketplace. Les vendeurs sont responsables de leurs annonces, de la conformité légale
        (TVA, douanes) et de l&apos;expédition. La plateforme prélève une commission (paramètre{' '}
        <code>platform_fee_bps</code>). Les paiements sont traités par Stripe / PayPal / Adyen. Les litiges sont
        gérés via le module intégré et le support.
      </p>
      <p className="muted">Document placeholder — à faire valider par un juriste.</p>
    </section>
  );
}
