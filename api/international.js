import { adminClient, requireUser } from './_supabase.js';
import { HttpError, json, method, sendError } from '../lib/http.js';
import { fetchFxRates, convertMoney, countryCurrency, normalizeCountry, supportedPaymentMethods, taxQuote } from '../lib/international.js';
import { chatJson } from '../lib/ai.js';
import { rateLimitAsync } from '../lib/ratelimit.js';

function body(req){ if(!req.body) return {}; if(typeof req.body==='string') return JSON.parse(req.body); return req.body; }
function isAdmin(user){ return user?.app_metadata?.role==='admin' || user?.user_metadata?.role==='admin'; }

export default async function handler(req,res){
  try {
    if (method(req)!=='GET' && method(req)!=='POST') throw new HttpError(405,'Method not allowed');
    const action = req.query?.action || (body(req).action);
    if (action==='rates') {
      await rateLimitAsync(req,'fx',30,60);
      const b=String(req.query?.base||'EUR').toUpperCase(); const q=String(req.query?.quotes||'USD,GBP,XOF').split(',');
      return json(res,200,{ok:true,...await fetchFxRates(b,q)});
    }
    const {user}=await requireUser(req);
    await rateLimitAsync(req,`intl:${user.id}`,30,60);
    const b=body(req);
    if(action==='convert') return json(res,200,{ok:true,result:convertMoney(b.amount,b.from,b.to,b.rate)});
    if(action==='countryConfig') {
      const country=normalizeCountry(b.country); const currency=countryCurrency(country,b.currency); return json(res,200,{ok:true,country,currency,payment_methods:supportedPaymentMethods(country,currency)});
    }
    if(action==='taxQuote') return json(res,200,{ok:true,...taxQuote(b)});
    if(action==='translate') {
      if(!process.env.AI_API_KEY) throw new HttpError(503,'AI translation is not configured');
      const text=String(b.text||'').slice(0,8000); const target=String(b.target_language||'en').slice(0,10);
      if(!text) throw new HttpError(400,'text required');
      const out=await chatJson({system:`Translate marketplace product content into ${target}. Preserve measurements, SKU-like strings, HTML-free formatting, and do not invent facts. Return JSON: {translation:string}.`,user:text,maxTokens:1000});
      let parsed; try{parsed=JSON.parse(out.text)}catch{parsed=null};
      return json(res,200,{ok:true,translation:parsed?.translation||out.text,model:process.env.AI_MODEL||'default'});
    }
    if(action==='adminAnalytics') {
      if(!isAdmin(user)) throw new HttpError(403,'Admin required');
      const db=adminClient();
      const [shops,products,orders,reviews,disputes]=await Promise.all([
        db.from('shops').select('id',{count:'exact',head:true}),
        db.from('products').select('id',{count:'exact',head:true}),
        db.from('orders').select('id,total,currency,status,created_at').order('created_at',{ascending:false}).limit(1000),
        db.from('reviews').select('id,trust_status,rating,created_at').order('created_at',{ascending:false}).limit(1000),
        db.from('disputes').select('id,status').limit(1000),
      ]);
      const paid=(orders.data||[]).filter(x=>['paid','processing','shipped','delivered'].includes(x.status));
      const revenueByCurrency={}; for(const o of paid) revenueByCurrency[o.currency]=(revenueByCurrency[o.currency]||0)+Number(o.total||0);
      return json(res,200,{ok:true,shops:shops.count||0,products:products.count||0,orders:orders.data?.length||0,paid_orders:paid.length,revenue_by_currency:revenueByCurrency,reviews:reviews.data?.length||0,reviews_to_review:(reviews.data||[]).filter(x=>x.trust_status==='review').length,open_disputes:(disputes.data||[]).filter(x=>x.status==='open').length});
    }
    throw new HttpError(400,'Unknown action');
  } catch(e){ return sendError(res,e); }
}
