import { publicClient, userClient, requireUser, adminClient, env } from './_supabase.js';
import { HttpError, json, method, sendError } from '../lib/http.js';
import { validateShop, validateProduct, validateProductPatch, escapeLike, UUID_RE } from '../lib/validate.js';
import { analyzeReview, summarizeProductReviews } from '../lib/review-ai.js';
import { rateLimitAsync as rateLimit } from '../lib/ratelimit.js';

function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    try { body = JSON.parse(String(body) || '{}'); } catch { throw new HttpError(400, 'Invalid JSON body'); }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Invalid body');
  return body;
}

export default async function handler(req, res) {
  try {
    method(req, ['GET', 'POST']);

    // --- Lectures publiques ---
    if (req.method === 'GET') {
      const action = String(req.query?.action || 'products');
      if (action === 'health') return json(res, 200, { ok: true, service: 'BAARO-MARKET API', version: '2.0.0', timestamp: new Date().toISOString() });
      const q = String(req.query?.q || '').trim().slice(0, 100);

      if (action === 'products') {
        const currency = String(req.query?.currency || '').trim().toUpperCase().slice(0, 3);
        const minPrice = req.query?.min_price != null ? Number(req.query.min_price) : null;
        const maxPrice = req.query?.max_price != null ? Number(req.query.max_price) : null;
        const sort = String(req.query?.sort || 'newest');
        const pageSize = Math.min(50, Math.max(1, Number(req.query?.limit || 24)) || 24);
        const cursor = String(req.query?.cursor || '').trim();
        let cursorCreatedAt = null;
        let cursorId = null;
        if (cursor && sort === 'newest') {
          try {
            const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
            if (decoded?.created_at && UUID_RE.test(String(decoded?.id || ''))) {
              cursorCreatedAt = String(decoded.created_at);
              cursorId = String(decoded.id);
            }
          } catch { throw new HttpError(400, 'Invalid cursor'); }
        }
        let query = publicClient()
          .from('products')
          .select('id,name,slug,description,price,currency,image_url,shop_id,stock,track_inventory,tax_rate_bps,weight_grams,rating_avg,rating_count,created_at')
          .eq('is_active', true)
          .eq('moderation_status', 'approved')
          .limit(pageSize + 1);
        if (q) query = query.or(`name.ilike.%${escapeLike(q)}%,description.ilike.%${escapeLike(q)}%`);
        const shopId = req.query?.shop_id;
        if (shopId && UUID_RE.test(String(shopId))) query = query.eq('shop_id', shopId);
        if (currency && currency.length === 3) query = query.eq('currency', currency);
        if (minPrice != null && Number.isFinite(minPrice)) query = query.gte('price', minPrice);
        if (maxPrice != null && Number.isFinite(maxPrice)) query = query.lte('price', maxPrice);
        if (sort === 'price_asc') query = query.order('price', { ascending: true }).order('id', { ascending: true });
        else if (sort === 'price_desc') query = query.order('price', { ascending: false }).order('id', { ascending: true });
        else if (sort === 'rating') query = query.order('rating_avg', { ascending: false }).order('id', { ascending: true });
        else {
          query = query.order('created_at', { ascending: false }).order('id', { ascending: false });
          if (cursorCreatedAt && cursorId) query = query.or(`created_at.lt.${cursorCreatedAt},and(created_at.eq.${cursorCreatedAt},id.lt.${cursorId})`);
        }
        const { data: rows, error } = await query;
        if (error) throw error;
        const data = rows || [];
        const hasMore = data.length > pageSize;
        const products = data.slice(0, pageSize);
        const last = products[products.length - 1];
        const next_cursor = hasMore && last
          ? Buffer.from(JSON.stringify({ created_at: last.created_at, id: last.id })).toString('base64url')
          : null;
        return json(res, 200, { ok: true, products, pagination: { limit: pageSize, has_more: hasMore, next_cursor } });
      }

      if (action === 'product') {
        const id = String(req.query?.id || '');
        if (!UUID_RE.test(id)) throw new HttpError(400, 'Invalid id');
        const { data, error } = await publicClient()
          .from('products')
          .select('id,name,slug,description,price,currency,image_url,shop_id,stock,track_inventory,tax_rate_bps,weight_grams,rating_avg,rating_count,created_at,shops(id,name,slug,rating_avg,rating_count,kyc_status)')
          .eq('id', id)
          .eq('is_active', true)
          .eq('moderation_status', 'approved')
          .maybeSingle();
        if (error) throw error;
        if (!data) throw new HttpError(404, 'Not found');
        return json(res, 200, { ok: true, product: data });
      }

      if (action === 'reviews') {
        const productId = String(req.query?.product_id || '');
        if (!UUID_RE.test(productId)) throw new HttpError(400, 'Invalid product_id');
        const { data, error } = await publicClient()
          .from('reviews')
          .select('id,rating,title,body,created_at,sentiment,sentiment_score,themes,toxicity,ai_summary,language,trust_status,trust_score')
          .eq('product_id', productId)
          .order('created_at', { ascending: false })
          .limit(50);
        if (error) throw error;
        return json(res, 200, { ok: true, reviews: data || [] });
      }

      if (action === 'productInsights') {
        const productId = String(req.query?.product_id || '');
        const rl = await rateLimit(`public-product-insights:${productId}:${req.headers['x-forwarded-for'] || 'anon'}`, { limit: 5, windowMs: 60_000 });
        if (!rl.ok) throw new HttpError(429, `Too many requests. Retry in ${rl.retryAfter}s`);
        if (!UUID_RE.test(productId)) throw new HttpError(400, 'Invalid product_id');
        const { data: product, error } = await publicClient()
          .from('products')
          .select('id,ai_insights,ai_insights_at')
          .eq('id', productId)
          .maybeSingle();
        if (error) throw error;
        if (!product) throw new HttpError(404, 'Not found');
        // Si pas de cache, générer côté serveur (admin) — lecture publique du cache seulement
        if (product.ai_insights) {
          return json(res, 200, { ok: true, insights: product.ai_insights, cached: true });
        }
        // Génération lazy
        const admin = adminClient();
        const { data: reviews } = await admin
          .from('reviews')
          .select('rating,title,body,sentiment,themes')
          .eq('product_id', productId)
          .order('created_at', { ascending: false })
          .limit(40);
        if (!(reviews || []).length) {
          return json(res, 200, { ok: true, insights: null, cached: false, review_count: 0 });
        }
        const insights = await summarizeProductReviews(reviews || []);
        insights.generated_at = new Date().toISOString();
        insights.review_count = (reviews || []).length;
        await admin
          .from('products')
          .update({ ai_insights: insights, ai_insights_at: insights.generated_at })
          .eq('id', productId);
        return json(res, 200, { ok: true, insights, cached: false });
      }

      if (action === 'shops') {
        let query = publicClient()
          .from('shops')
          .select('id,name,slug,description,country,created_at')
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(50);
        if (q) query = query.or(`name.ilike.%${escapeLike(q)}%,description.ilike.%${escapeLike(q)}%`);
        const { data, error } = await query;
        if (error) throw error;
        return json(res, 200, { ok: true, shops: data || [] });
      }

      if (action === 'shop') {
        const slug = String(req.query?.slug || '').trim();
        if (!slug) throw new HttpError(400, 'slug required');
        const { data: shop, error } = await publicClient()
          .from('shops')
          .select('id,name,slug,description,country,created_at')
          .eq('slug', slug)
          .eq('is_active', true)
          .maybeSingle();
        if (error) throw error;
        if (!shop) throw new HttpError(404, 'Not found');
        const { data: products } = await publicClient()
          .from('products')
          .select('id,name,slug,description,price,currency,image_url,stock,track_inventory,tax_rate_bps,weight_grams')
          .eq('shop_id', shop.id)
          .eq('is_active', true)
          .eq('moderation_status', 'approved')
          .limit(50);
        return json(res, 200, { ok: true, shop, products: products || [] });
      }

      throw new HttpError(400, 'Unknown action');
    }

    // --- Écritures authentifiées ---
    const { user, token } = await requireUser(req);
    const db = userClient(token); // lecture sous RLS
    const admin = adminClient();   // écritures : toujours filtrées par owner_id
    const body = parseBody(req);

    if (body.action === 'me') {
      const { data: profile } = await db.from('profiles').select('id,display_name,handle,country,avatar_url,role').eq('id', user.id).maybeSingle();
      const { data: shops } = await admin.from('shops').select('id,name,slug,description,is_active,stripe_account_id,stripe_charges_enabled,platform_fee_bps,cgu_accepted_at,country,shipping_line1,shipping_city,shipping_postal,shipping_phone').eq('owner_id', user.id);
      return json(res, 200, { ok: true, user: { id: user.id, email: user.email }, profile, shops: shops || [] });
    }

    if (body.action === 'createShop') {
      const input = validateShop(body);
      const { data, error } = await admin
        .from('shops')
        .insert({ ...input, owner_id: user.id, is_active: true, country: body.country ? String(body.country).toUpperCase().slice(0, 2) : null })
        .select()
        .single();
      if (error) throw error;
      return json(res, 201, { ok: true, shop: data });
    }

    if (body.action === 'createProduct') {
      const input = validateProduct(body);
      // Production : Connect actif + CGU acceptées obligatoires avant mise en vente
      const { data: shopRow, error: shopErr } = await admin
        .from('shops')
        .select('id,owner_id,stripe_charges_enabled,cgu_accepted_at')
        .eq('id', input.shop_id)
        .eq('owner_id', user.id)
        .maybeSingle();
      if (shopErr) throw shopErr;
      if (!shopRow) throw new HttpError(403, 'Shop not found or not owned');
      if (!shopRow.cgu_accepted_at) {
        throw new HttpError(403, 'Accept CGU before listing products (action: acceptCgu)');
      }
      if (process.env.REQUIRE_STRIPE_CONNECT !== 'false' && !shopRow.stripe_charges_enabled) {
        throw new HttpError(403, 'Complete Stripe Connect onboarding before listing products');
      }
      const stock = body.stock !== undefined ? Number(body.stock) : 0;
      if (!Number.isInteger(stock) || stock < 0 || stock > 1_000_000) throw new HttpError(400, 'Invalid stock');
      const taxBps = body.tax_rate_bps !== undefined ? Number(body.tax_rate_bps) : 0;
      if (!Number.isInteger(taxBps) || taxBps < 0 || taxBps > 3000) throw new HttpError(400, 'Invalid tax_rate_bps');
      let weightGrams = null;
      if (body.weight_grams !== undefined && body.weight_grams !== null && body.weight_grams !== '') {
        weightGrams = Number(body.weight_grams);
        if (!Number.isInteger(weightGrams) || weightGrams < 0 || weightGrams > 1_000_000) {
          throw new HttpError(400, 'Invalid weight_grams');
        }
      }
      const { data, error } = await admin
        .from('products')
        .insert({
          ...input,
          is_active: true,
          stock,
          track_inventory: body.track_inventory !== false,
          tax_rate_bps: taxBps,
          weight_grams: weightGrams,
          // Toute nouvelle annonce passe par la modération avant publication.
          moderation_status: 'pending',
        })
        .select()
        .single();
      if (error) throw error;
      return json(res, 201, { ok: true, product: data });
    }

    if (body.action === 'updateProduct') {
      if (!UUID_RE.test(String(body.id || ''))) throw new HttpError(400, 'Invalid id');
      const { data: cur, error: cErr } = await admin.from('products').select('id,currency,shops!inner(owner_id)').eq('id', body.id).maybeSingle();
      if (cErr) throw cErr;
      if (!cur || cur.shops.owner_id !== user.id) throw new HttpError(404, 'Not found');
      const patch = validateProductPatch(body, cur.currency);
      if (!Object.keys(patch).length) throw new HttpError(400, 'Nothing to update');
      const { data, error } = await admin.from('products').update(patch).eq('id', body.id).select().single();
      if (error) throw error;
      return json(res, 200, { ok: true, product: data });
    }

    if (body.action === 'myOrders') {
      const { data, error } = await db
        .from('orders')
        .select('id,status,currency,subtotal,tax_total,shipping_total,total,created_at,shop_id,shops(name,slug)')
        .eq('buyer_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return json(res, 200, { ok: true, orders: data || [] });
    }

    if (body.action === 'orderDetail') {
      if (!UUID_RE.test(String(body.id || ''))) throw new HttpError(400, 'Invalid id');
      const { data: order, error } = await db
        .from('orders')
        .select('*,order_items(*)')
        .eq('id', body.id)
        .eq('buyer_id', user.id)
        .maybeSingle();
      if (error) throw error;
      if (!order) throw new HttpError(404, 'Not found');
      return json(res, 200, { ok: true, order });
    }

    // Stripe Connect Express onboarding pour le vendeur
    if (body.action === 'connectStripe') {
      if (!UUID_RE.test(String(body.shop_id || ''))) throw new HttpError(400, 'Invalid shop_id');
      const { data: shop, error } = await admin.from('shops').select('*').eq('id', body.shop_id).eq('owner_id', user.id).single();
      if (error) throw error;

      const secret = env('STRIPE_SECRET_KEY');
      let accountId = shop.stripe_account_id;

      if (!accountId) {
        const createParams = new URLSearchParams({
          type: 'express',
          'capabilities[card_payments][requested]': 'true',
          'capabilities[transfers][requested]': 'true',
          'metadata[shop_id]': shop.id,
          'metadata[owner_id]': user.id,
        });
        if (shop.country) createParams.set('country', shop.country);
        const cr = await fetch('https://api.stripe.com/v1/accounts', {
          method: 'POST',
          headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: createParams.toString(),
        });
        const acc = await cr.json();
        if (!cr.ok) throw new HttpError(502, acc.error?.message || 'Stripe account creation failed');
        accountId = acc.id;
        await adminClient().from('shops').update({ stripe_account_id: accountId }).eq('id', shop.id);
      }

      const returnUrl = body.return_url || env('PAYMENT_SUCCESS_URL');
      const refreshUrl = body.refresh_url || returnUrl;
      const linkParams = new URLSearchParams({
        account: accountId,
        type: 'account_onboarding',
        return_url: returnUrl,
        refresh_url: refreshUrl,
      });
      const lr = await fetch('https://api.stripe.com/v1/account_links', {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: linkParams.toString(),
      });
      const link = await lr.json();
      if (!lr.ok) throw new HttpError(502, link.error?.message || 'Stripe account link failed');
      return json(res, 200, { ok: true, url: link.url, account_id: accountId });
    }

    if (body.action === 'refreshConnectStatus') {
      if (!UUID_RE.test(String(body.shop_id || ''))) throw new HttpError(400, 'Invalid shop_id');
      const { data: shop, error } = await admin.from('shops').select('*').eq('id', body.shop_id).eq('owner_id', user.id).single();
      if (error) throw error;
      if (!shop.stripe_account_id) return json(res, 200, { ok: true, charges_enabled: false });
      const secret = env('STRIPE_SECRET_KEY');
      const ar = await fetch(`https://api.stripe.com/v1/accounts/${shop.stripe_account_id}`, {
        headers: { Authorization: `Bearer ${secret}` },
      });
      const acc = await ar.json();
      if (!ar.ok) throw new HttpError(502, acc.error?.message || 'Stripe account fetch failed');
      const enabled = Boolean(acc.charges_enabled);
      await adminClient().from('shops').update({ stripe_charges_enabled: enabled }).eq('id', shop.id);
      return json(res, 200, { ok: true, charges_enabled: enabled, details_submitted: acc.details_submitted });
    }

    if (body.action === 'shopOrders') {
      if (!UUID_RE.test(String(body.shop_id || ''))) throw new HttpError(400, 'Invalid shop_id');
      const { data: shop, error: sErr } = await admin
        .from('shops')
        .select('id')
        .eq('id', body.shop_id)
        .eq('owner_id', user.id)
        .maybeSingle();
      if (sErr) throw sErr;
      if (!shop) throw new HttpError(403, 'Shop not found or not owned');
      const { data, error } = await admin
        .from('orders')
        .select('id,status,currency,subtotal,tax_total,shipping_total,total,refunded_amount,created_at,paid_at,buyer_id')
        .eq('shop_id', shop.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return json(res, 200, { ok: true, orders: data || [] });
    }


    if (body.action === 'shopAnalytics') {
      if (!UUID_RE.test(String(body.shop_id || ''))) throw new HttpError(400, 'Invalid shop_id');
      const { data: shop } = await admin.from('shops').select('id,name,owner_id').eq('id', body.shop_id).eq('owner_id', user.id).maybeSingle();
      if (!shop) throw new HttpError(403, 'Shop not found or not owned');
      const [{ data: products }, { data: orders }, { data: reviews }] = await Promise.all([
        admin.from('products').select('id,name,stock,track_inventory,is_active,moderation_status').eq('shop_id', shop.id),
        admin.from('orders').select('id,status,total,currency,created_at,refunded_amount').eq('shop_id', shop.id).order('created_at', { ascending: false }).limit(500),
        admin.from('reviews').select('id,rating,sentiment,trust_status,created_at').eq('shop_id', shop.id).order('created_at', { ascending: false }).limit(500),
      ]);
      const os = orders || [];
      const paid = os.filter(o => ['paid','partially_refunded','refunded'].includes(o.status));
      const revenue = paid.reduce((n,o) => n + Number(o.total || 0), 0);
      const refunded = paid.reduce((n,o) => n + Number(o.refunded_amount || 0), 0);
      const avgRating = (reviews || []).length ? (reviews.reduce((n,r) => n + Number(r.rating || 0),0)/(reviews.length)).toFixed(2) : null;
      return json(res, 200, { ok:true, analytics:{ shop, products_count:(products||[]).length, active_products:(products||[]).filter(p=>p.is_active && p.moderation_status==='approved').length, pending_products:(products||[]).filter(p=>p.moderation_status==='pending').length, low_stock:(products||[]).filter(p=>p.track_inventory && Number(p.stock)<=5).length, orders_count:os.length, paid_orders:paid.length, revenue:Math.round(revenue*100)/100, refunded:Math.round(refunded*100)/100, currencies:[...new Set(paid.map(o=>o.currency))], reviews_count:(reviews||[]).length, average_rating:avgRating, flagged_reviews:(reviews||[]).filter(r=>r.trust_status && r.trust_status!=='normal').length }});
    }

    if (body.action === 'adminDashboard') {
      const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
      if (profile?.role !== 'admin') throw new HttpError(403, 'Admin only');
      const [{ count: shops }, { count: products }, { count: orders }, { count: disputes }, { count: flagged }] = await Promise.all([
        admin.from('shops').select('*', { count:'exact', head:true }),
        admin.from('products').select('*', { count:'exact', head:true }).eq('moderation_status','pending'),
        admin.from('orders').select('*', { count:'exact', head:true }),
        admin.from('disputes').select('*', { count:'exact', head:true }).in('status',['open','investigating']),
        admin.from('reviews').select('*', { count:'exact', head:true }).neq('trust_status','normal'),
      ]);
      return json(res,200,{ok:true,stats:{shops:shops||0,pending_products:products||0,orders:orders||0,open_disputes:disputes||0,flagged_reviews:flagged||0}});
    }

    if (body.action === 'moderateReview') {
      if (!UUID_RE.test(String(body.review_id || ''))) throw new HttpError(400, 'Invalid review_id');
      const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
      if (profile?.role !== 'admin') throw new HttpError(403, 'Admin only');
      const status = String(body.status || 'normal');
      if (!['normal','review','blocked'].includes(status)) throw new HttpError(400, 'Invalid trust status');
      const { data, error } = await admin.from('reviews').update({trust_status:status,trust_reason:body.reason?String(body.reason).slice(0,500):null}).eq('id',body.review_id).select('id,trust_status,trust_reason').single();
      if (error) throw error;
      await admin.from('audit_events').insert({actor_id:user.id,event_type:'review.moderated',entity_type:'review',entity_id:body.review_id,metadata:{status}});
      return json(res,200,{ok:true,review:data});
    }

    if (body.action === 'createReview') {
      if (!UUID_RE.test(String(body.product_id || ''))) throw new HttpError(400, 'Invalid product_id');
      if (!UUID_RE.test(String(body.order_id || ''))) throw new HttpError(400, 'Invalid order_id');
      const rating = Number(body.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400, 'rating must be 1-5');
      const title = body.title != null ? String(body.title).trim().slice(0, 120) : null;
      const reviewBody = body.body != null ? String(body.body).trim().slice(0, 2000) : null;
      const { data: order, error: oErr } = await admin
        .from('orders')
        .select('id,buyer_id,shop_id,status')
        .eq('id', body.order_id)
        .eq('buyer_id', user.id)
        .maybeSingle();
      if (oErr) throw oErr;
      if (!order) throw new HttpError(404, 'Order not found');
      if (order.status !== 'paid' && order.status !== 'partially_refunded') {
        throw new HttpError(403, 'Only paid orders can be reviewed');
      }
      const { data: item, error: iErr } = await admin
        .from('order_items')
        .select('id,product_id')
        .eq('order_id', order.id)
        .eq('product_id', body.product_id)
        .maybeSingle();
      if (iErr) throw iErr;
      if (!item) throw new HttpError(400, 'Product not in this order');
      const { data: prod } = await admin.from('products').select('id,shop_id').eq('id', body.product_id).maybeSingle();
      if (!prod) throw new HttpError(404, 'Product not found');
      const { data: review, error: rErr } = await admin
        .from('reviews')
        .insert({
          product_id: body.product_id,
          shop_id: prod.shop_id,
          order_id: order.id,
          buyer_id: user.id,
          rating,
          title,
          body: reviewBody,
        })
        .select()
        .single();
      if (rErr) {
        if (String(rErr.message || '').includes('duplicate') || rErr.code === '23505') {
          throw new HttpError(409, 'Already reviewed this product for this order');
        }
        throw rErr;
      }
      try { await admin.rpc('refresh_product_rating', { p_product: body.product_id }); } catch (e) {
        console.error('[review] refresh rating', e?.message || e);
      }

      // Analyse IA (non bloquant si lente : on attend pour renvoyer le résultat)
      let analysis = null;
      try {
        analysis = await analyzeReview({ rating, title, body: reviewBody });
        const { data: updated } = await admin
          .from('reviews')
          .update({
            sentiment: analysis.sentiment,
            sentiment_score: analysis.sentiment_score,
            themes: analysis.themes,
            language: analysis.language,
            toxicity: analysis.toxicity,
            ai_summary: analysis.summary,
            ai_provider: analysis.provider,
            ai_analyzed_at: new Date().toISOString(),
          })
          .eq('id', review.id)
          .select()
          .single();
        if (updated) Object.assign(review, updated);
        // Invalider le cache synthèse produit
        await admin.from('products').update({ ai_insights: null, ai_insights_at: null }).eq('id', body.product_id);
      } catch (e) {
        console.error('[review] AI analyze', e?.message || e);
      }

      return json(res, 201, { ok: true, review, analysis });
    }

    if (body.action === 'productInsights') {
      if (!UUID_RE.test(String(body.product_id || ''))) throw new HttpError(400, 'Invalid product_id');
      const force = Boolean(body.force);
      const { data: product, error: pErr } = await admin
        .from('products')
        .select('id,name,ai_insights,ai_insights_at')
        .eq('id', body.product_id)
        .maybeSingle();
      if (pErr) throw pErr;
      if (!product) throw new HttpError(404, 'Product not found');

      const cacheAgeMs = product.ai_insights_at
        ? Date.now() - new Date(product.ai_insights_at).getTime()
        : Infinity;
      if (!force && product.ai_insights && cacheAgeMs < 6 * 60 * 60 * 1000) {
        return json(res, 200, { ok: true, insights: product.ai_insights, cached: true });
      }

      const { data: reviews, error: rErr } = await admin
        .from('reviews')
        .select('rating,title,body,sentiment,themes')
        .eq('product_id', body.product_id)
        .order('created_at', { ascending: false })
        .limit(40);
      if (rErr) throw rErr;

      const insights = await summarizeProductReviews(reviews || []);
      insights.generated_at = new Date().toISOString();
      insights.review_count = (reviews || []).length;

      await admin
        .from('products')
        .update({ ai_insights: insights, ai_insights_at: insights.generated_at })
        .eq('id', body.product_id);

      return json(res, 200, { ok: true, insights, cached: false });
    }

    if (body.action === 'openDispute') {
      if (!UUID_RE.test(String(body.order_id || ''))) throw new HttpError(400, 'Invalid order_id');
      const reason = String(body.reason || '');
      if (!['not_received','not_as_described','damaged','other'].includes(reason)) {
        throw new HttpError(400, 'Invalid reason');
      }
      const description = String(body.description || '').trim();
      if (description.length < 10 || description.length > 2000) throw new HttpError(400, 'description 10-2000 chars');
      const { data: order, error: oErr } = await admin
        .from('orders')
        .select('id,buyer_id,shop_id,status')
        .eq('id', body.order_id)
        .eq('buyer_id', user.id)
        .maybeSingle();
      if (oErr) throw oErr;
      if (!order) throw new HttpError(404, 'Order not found');
      if (order.status !== 'paid' && order.status !== 'partially_refunded') {
        throw new HttpError(403, 'Disputes only for paid orders');
      }
      const { data: dispute, error: dErr } = await admin
        .from('disputes')
        .insert({
          order_id: order.id,
          opened_by: user.id,
          shop_id: order.shop_id,
          reason,
          description,
        })
        .select()
        .single();
      if (dErr) {
        if (String(dErr.message || '').includes('duplicate') || dErr.code === '23505') {
          throw new HttpError(409, 'Dispute already open for this order');
        }
        throw dErr;
      }
      return json(res, 201, { ok: true, dispute });
    }

    if (body.action === 'startConversation') {
      if (!UUID_RE.test(String(body.shop_id || ''))) throw new HttpError(400, 'Invalid shop_id');
      const subject = body.subject != null ? String(body.subject).trim().slice(0, 200) : null;
      const orderId = body.order_id && UUID_RE.test(String(body.order_id)) ? body.order_id : null;
      if (orderId) {
        const { data: linkedOrder, error: linkedErr } = await admin
          .from('orders')
          .select('id,shop_id,buyer_id')
          .eq('id', orderId)
          .eq('buyer_id', user.id)
          .maybeSingle();
        if (linkedErr) throw linkedErr;
        if (!linkedOrder || linkedOrder.shop_id !== body.shop_id) {
          throw new HttpError(403, 'Order does not belong to this shop or buyer');
        }
      }
      const { data: conv, error } = await admin
        .from('conversations')
        .upsert(
          { shop_id: body.shop_id, buyer_id: user.id, order_id: orderId, subject, updated_at: new Date().toISOString() },
          { onConflict: 'shop_id,buyer_id,order_id' }
        )
        .select()
        .single();
      if (error) throw error;
      if (body.message) {
        const msgBody = String(body.message).trim().slice(0, 4000);
        if (msgBody) {
          await admin.from('messages').insert({ conversation_id: conv.id, sender_id: user.id, body: msgBody });
        }
      }
      return json(res, 201, { ok: true, conversation: conv });
    }

    if (body.action === 'sendMessage') {
      if (!UUID_RE.test(String(body.conversation_id || ''))) throw new HttpError(400, 'Invalid conversation_id');
      const msgBody = String(body.message || body.body || '').trim();
      if (msgBody.length < 1 || msgBody.length > 4000) throw new HttpError(400, 'message required');
      const { data: conv, error: cErr } = await admin
        .from('conversations')
        .select('id,shop_id,buyer_id')
        .eq('id', body.conversation_id)
        .maybeSingle();
      if (cErr) throw cErr;
      if (!conv) throw new HttpError(404, 'Conversation not found');
      const { data: shop } = await admin.from('shops').select('owner_id').eq('id', conv.shop_id).maybeSingle();
      if (conv.buyer_id !== user.id && shop?.owner_id !== user.id) throw new HttpError(403, 'Not a participant');
      const { data: msg, error } = await admin
        .from('messages')
        .insert({ conversation_id: conv.id, sender_id: user.id, body: msgBody })
        .select()
        .single();
      if (error) throw error;
      await admin.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conv.id);
      return json(res, 201, { ok: true, message: msg });
    }


    if (body.action === 'updateShopShipping') {
      if (!UUID_RE.test(String(body.shop_id || ''))) throw new HttpError(400, 'Invalid shop_id');
      const patch = {
        shipping_line1: body.line1 != null ? String(body.line1).trim().slice(0, 200) : null,
        shipping_line2: body.line2 != null ? String(body.line2).trim().slice(0, 200) : null,
        shipping_city: body.city != null ? String(body.city).trim().slice(0, 100) : null,
        shipping_state: body.state != null ? String(body.state).trim().slice(0, 100) : null,
        shipping_postal: body.postal_code != null ? String(body.postal_code).trim().slice(0, 20) : null,
        shipping_phone: body.phone != null ? String(body.phone).trim().slice(0, 40) : null,
      };
      if (body.country) {
        patch.country = String(body.country).toUpperCase().slice(0, 2);
      }
      const { data, error } = await admin
        .from('shops')
        .update(patch)
        .eq('id', body.shop_id)
        .eq('owner_id', user.id)
        .select('id,name,country,shipping_line1,shipping_city,shipping_postal')
        .single();
      if (error) throw error;
      return json(res, 200, { ok: true, shop: data });
    }

    if (body.action === 'buyShippingLabel') {
      if (!UUID_RE.test(String(body.order_id || ''))) throw new HttpError(400, 'Invalid order_id');
      // Délègue la logique à l'endpoint dédié côté client ; garde-fou ici
      throw new HttpError(400, 'Use POST /api/shipping-label');
    }

    if (body.action === 'acceptCgu') {

      if (!UUID_RE.test(String(body.shop_id || ''))) throw new HttpError(400, 'Invalid shop_id');
      const { data, error } = await admin
        .from('shops')
        .update({ cgu_accepted_at: new Date().toISOString() })
        .eq('id', body.shop_id)
        .eq('owner_id', user.id)
        .select('id,cgu_accepted_at')
        .single();
      if (error) throw error;
      return json(res, 200, { ok: true, shop: data });
    }

    throw new HttpError(400, 'Unknown action');
  } catch (e) {
    return sendError(res, e);
  }
}
