/**
 * Emails transactionnels via Resend (https://resend.com).
 * Si RESEND_API_KEY absent : log only (dev / soft launch).
 */

function fromAddress() {
  return process.env.EMAIL_FROM || 'BAARO-MARKET <noreply@baaro.market>';
}

export async function sendEmail({ to, subject, html, text }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.info('[email:dry-run]', { to, subject });
    return { ok: true, dryRun: true };
  }
  if (!to) return { ok: false, error: 'no recipient' };

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromAddress(),
      to: [to],
      subject,
      html: html || undefined,
      text: text || undefined,
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('[email] failed', r.status, data);
    return { ok: false, error: data };
  }
  return { ok: true, id: data.id };
}

export async function emailBuyerOrderPaid({ to, orderId, total, currency }) {
  return sendEmail({
    to,
    subject: `Commande confirmée — ${String(orderId).slice(0, 8)}`,
    text: `Votre paiement de ${total} ${currency} a été accepté.\nCommande : ${orderId}\nMerci pour votre achat sur BAARO-MARKET.`,
    html: `<p>Votre paiement de <strong>${total} ${currency}</strong> a été accepté.</p>
<p>Commande : <code>${orderId}</code></p>
<p>Merci pour votre achat sur BAARO-MARKET.</p>`,
  });
}

export async function emailSellerNewSale({ to, orderId, total, currency, shopName }) {
  return sendEmail({
    to,
    subject: `Nouvelle vente — ${shopName || 'votre boutique'}`,
    text: `Une commande de ${total} ${currency} a été payée.\nCommande : ${orderId}`,
    html: `<p>Une commande de <strong>${total} ${currency}</strong> a été payée pour <strong>${shopName || 'votre boutique'}</strong>.</p>
<p>Commande : <code>${orderId}</code></p>`,
  });
}

/**
 * Notifie acheteur + vendeur après paiement.
 * `db` = adminClient() (service_role, auth.admin disponible).
 */
export async function notifyOrderPaid(db, order) {
  let buyerEmail = null;
  let sellerEmail = null;
  let shopName = null;

  try {
    const { data: bu, error } = await db.auth.admin.getUserById(order.buyer_id);
    if (!error) buyerEmail = bu?.user?.email || null;
  } catch (e) {
    console.warn('[email] buyer lookup', e?.message || e);
  }

  try {
    const { data: shop } = await db.from('shops').select('name,owner_id').eq('id', order.shop_id).maybeSingle();
    shopName = shop?.name;
    if (shop?.owner_id) {
      const { data: su, error } = await db.auth.admin.getUserById(shop.owner_id);
      if (!error) sellerEmail = su?.user?.email || null;
    }
  } catch (e) {
    console.warn('[email] seller lookup', e?.message || e);
  }

  const total = order.total ?? order.subtotal;
  const currency = order.currency;
  const results = [];
  if (buyerEmail) {
    results.push(await emailBuyerOrderPaid({ to: buyerEmail, orderId: order.id, total, currency }));
  }
  if (sellerEmail) {
    results.push(await emailSellerNewSale({ to: sellerEmail, orderId: order.id, total, currency, shopName }));
  }
  return results;
}
