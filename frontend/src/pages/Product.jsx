import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Button } from '../ui/Button.jsx';
import { Input, Textarea } from '../ui/Input.jsx';
import { Card } from '../ui/Card.jsx';
import { Badge } from '../ui/Badge.jsx';

function stars(avg) {
  const n = Math.round(Number(avg) || 0);
  return '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));
}

const sentimentStyle = {
  positive: 'bg-green-100 text-green-800',
  neutral: 'bg-slate-100 text-slate-700',
  negative: 'bg-red-100 text-red-800',
  mixed: 'bg-amber-100 text-amber-800',
};

const sentimentLabel = {
  positive: 'Positif',
  neutral: 'Neutre',
  negative: 'Négatif',
  mixed: 'Mitigé',
};

export function ProductPage({ id, onAdd, navigate, setError }) {
  const { session } = useAuth();
  const [product, setProduct] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [insights, setInsights] = useState(null);
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [orderId, setOrderId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState('');
  const [loadingInsights, setLoadingInsights] = useState(false);

  useEffect(() => {
    api(`/api/market?action=product&id=${id}`)
      .then((d) => setProduct(d.product))
      .catch((e) => setError(e.message));
    api(`/api/market?action=reviews&product_id=${id}`)
      .then((d) => setReviews(d.reviews || []))
      .catch(() => {});
    setLoadingInsights(true);
    api(`/api/market?action=productInsights&product_id=${id}`)
      .then((d) => setInsights(d.insights))
      .catch(() => {})
      .finally(() => setLoadingInsights(false));
  }, [id, setError]);

  async function submitReview(e) {
    e.preventDefault();
    if (!session) {
      setError('Connectez-vous pour laisser un avis.');
      return;
    }
    setSubmitting(true);
    try {
      await api('/api/market', {
        method: 'POST',
        token: session.access_token,
        body: {
          action: 'createReview',
          product_id: id,
          order_id: orderId,
          rating,
          title,
          body,
        },
      });
      setMsg('Avis publié et analysé par l’IA.');
      setTitle('');
      setBody('');
      const d = await api(`/api/market?action=reviews&product_id=${id}`);
      setReviews(d.reviews || []);
      const p = await api(`/api/market?action=product&id=${id}`);
      setProduct(p.product);
      // Rafraîchir synthèse
      const ins = await api(`/api/market?action=productInsights&product_id=${id}`);
      setInsights(ins.insights);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!product) return <p className="text-muted">Chargement…</p>;
  const outOfStock = product.track_inventory !== false && Number(product.stock) <= 0;
  const dist = insights?.sentiment_distribution;

  return (
    <div className="space-y-4">
      <section className="card grid gap-6 md:grid-cols-2">
        {product.image_url ? (
          <img src={product.image_url} alt="" className="h-64 w-full rounded-xl object-cover bg-slate-100 md:h-full" />
        ) : (
          <div className="flex h-64 items-center justify-center rounded-xl bg-slate-100 text-slate-400">Pas d&apos;image</div>
        )}
        <div className="space-y-3">
          <h2 className="text-2xl font-bold">{product.name}</h2>
          {product.rating_count > 0 && (
            <p className="text-amber-500">
              {stars(product.rating_avg)}{' '}
              <span className="text-ink font-semibold">
                {product.rating_avg}/5
              </span>{' '}
              <span className="text-muted text-sm">({product.rating_count} avis)</span>
            </p>
          )}
          <p className="text-slate-700">{product.description}</p>
          <p>
            <strong className="text-xl">
              {product.price} {product.currency}
            </strong>
            {product.tax_rate_bps > 0 && (
              <span className="text-muted text-sm"> (TVA {(product.tax_rate_bps / 100).toFixed(1)} %)</span>
            )}
          </p>
          <p className="text-sm text-muted">Stock: {product.stock}</p>
          {product.shops && (
            <p className="text-sm">
              Boutique:{' '}
              <a
                href={`#/shop/${product.shops.slug}`}
                className="font-medium text-brand-600 hover:underline"
                onClick={(e) => {
                  e.preventDefault();
                  navigate(`/shop/${product.shops.slug}`);
                }}
              >
                {product.shops.name}
              </a>
            </p>
          )}
          <Button variant="primary" onClick={() => onAdd(product)} disabled={outOfStock}>
            {outOfStock ? 'Rupture de stock' : 'Ajouter au panier'}
          </Button>
        </div>
      </section>

      {/* Synthèse IA */}
      {(insights?.overview || loadingInsights) && (
        <Card className="border-brand-100 bg-brand-50/40">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-sm font-bold text-brand-700">Synthèse IA</span>
            {insights?.provider && (
              <span className="badge bg-white text-slate-600 border border-slate-200">
                {insights.provider === 'llm' ? 'LLM' : 'Heuristique'}
              </span>
            )}
          </div>
          {loadingInsights && !insights && <p className="text-sm text-muted">Analyse en cours…</p>}
          {insights?.overview && <p className="text-sm leading-relaxed text-slate-800">{insights.overview}</p>}
          {dist && (
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {Object.entries(dist).map(([k, v]) =>
                v > 0 ? (
                  <span key={k} className={`badge ${sentimentStyle[k] || ''}`}>
                    {sentimentLabel[k] || k}: {v}
                  </span>
                ) : null
              )}
            </div>
          )}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {insights?.pros?.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase text-green-700">Points forts</p>
                <ul className="mt-1 list-disc pl-4 text-sm text-slate-700">
                  {insights.pros.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
            {insights?.cons?.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase text-red-700">Points faibles</p>
                <ul className="mt-1 list-disc pl-4 text-sm text-slate-700">
                  {insights.cons.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {insights?.buyer_advice && (
            <p className="mt-3 text-sm italic text-slate-600">💡 {insights.buyer_advice}</p>
          )}
          {insights?.top_themes?.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {insights.top_themes.map((t) => (
                <span key={t.name} className="badge bg-slate-100 text-slate-600">
                  {t.name} ({t.count})
                </span>
              ))}
            </div>
          )}
        </Card>
      )}

      <Card>
        <h3 className="mb-3 text-lg font-semibold">Avis clients</h3>
        {reviews.length === 0 && <p className="text-muted">Aucun avis pour l&apos;instant.</p>}
        <ul className="divide-y divide-slate-100">
          {reviews.map((r) => (
            <li key={r.id} className="py-4">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="text-amber-500">{stars(r.rating)}</span>
                {r.title && <strong className="text-sm">{r.title}</strong>}
                {r.sentiment && (
                  <span className={`badge ${sentimentStyle[r.sentiment] || ''}`}>
                    {sentimentLabel[r.sentiment] || r.sentiment}
                  </span>
                )}
                {r.toxicity === 'high' && <span className="badge bg-red-200 text-red-900">Signalé</span>}
                <span className="text-xs text-muted">{new Date(r.created_at).toLocaleDateString()}</span>
              </div>
              {r.body && <p className="text-sm text-slate-700">{r.body}</p>}
              {r.ai_summary && r.ai_summary !== r.body && (
                <p className="mt-1 text-xs text-muted">IA : {r.ai_summary}</p>
              )}
              {r.themes?.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {r.themes.map((th) => (
                    <span key={th} className="badge bg-slate-50 text-slate-500 border border-slate-200">
                      {th}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>

        {session && (
          <form onSubmit={submitReview} className="mt-6 space-y-2 border-t border-slate-100 pt-4">
            <h4 className="font-semibold">Laisser un avis</h4>
            <p className="text-sm text-muted">Réservé aux acheteurs ayant une commande payée pour ce produit.</p>
            <Input
              placeholder="ID commande (uuid)"
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              required
            />
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`text-2xl ${n <= rating ? 'text-amber-400' : 'text-slate-300'}`}
                  onClick={() => setRating(n)}
                >
                  ★
                </button>
              ))}
            </div>
            <Input placeholder="Titre (optionnel)" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
            <Textarea
              placeholder="Votre avis"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              maxLength={2000}
            />
            <Button variant="primary" type="submit" disabled={submitting}>
              {submitting ? 'Analyse & publication…' : 'Publier'}
            </Button>
            {msg && <p className="text-sm text-muted">{msg}</p>}
          </form>
        )}
      </Card>
    </div>
  );
}
