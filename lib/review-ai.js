/**
 * Analyse IA des avis clients.
 * - Sentiment, thèmes, toxicité, langue
 * - Synthèse produit / boutique
 * Fallback heuristique si AI_API_KEY absent.
 */

import { chatJson, isAiConfigured, parseModelJson } from './ai.js';

const SENTIMENTS = new Set(['positive', 'neutral', 'negative', 'mixed']);

/** Heuristique locale (sans LLM) */
export function heuristicAnalyzeReview({ rating, title, body }) {
  const text = `${title || ''} ${body || ''}`.toLowerCase();
  const negativeWords = [
    'mauvais', 'nul', 'arnaque', 'cassé', 'déçu', 'deçu', 'jamais', 'lent', 'horrible',
    'scam', 'fake', 'poor', 'bad', 'broken', 'worst', 'refund', 'rembours',
  ];
  const positiveWords = [
    'excellent', 'parfait', 'super', 'génial', 'merci', 'recommande', 'rapide',
    'great', 'love', 'amazing', 'perfect', 'good', 'quality', 'fast',
  ];
  let score = (Number(rating) || 3) - 3; // -2..+2
  for (const w of negativeWords) if (text.includes(w)) score -= 1;
  for (const w of positiveWords) if (text.includes(w)) score += 1;

  let sentiment = 'neutral';
  if (score >= 1.5 || rating >= 5) sentiment = 'positive';
  else if (score <= -1 || rating <= 2) sentiment = 'negative';
  else if (rating === 3) sentiment = 'mixed';
  else if (rating >= 4) sentiment = 'positive';
  else if (rating <= 2) sentiment = 'negative';

  const toxic =
    /arnaque|scam|imbécile|idiot|fuck|shit|connard|salop/.test(text);

  const themes = [];
  if (/livr|ship|délai|delay|poste|colis/.test(text)) themes.push('livraison');
  if (/qualité|quality|matériau|solid|cass/.test(text)) themes.push('qualité');
  if (/prix|price|cher|afford|rapport/.test(text)) themes.push('prix');
  if (/service|vendeur|seller|réponse|support/.test(text)) themes.push('service');
  if (/emballage|packaging|carton/.test(text)) themes.push('emballage');

  return {
    sentiment,
    sentiment_score: Math.max(-1, Math.min(1, score / 3)),
    themes,
    language: /[àâäéèêëïîôùûüç]/.test(text) ? 'fr' : 'en',
    toxicity: toxic ? 'high' : 'none',
    summary: (body || title || '').slice(0, 160) || null,
    provider: 'heuristic',
  };
}

/**
 * Analyse un avis unique via LLM (ou heuristique).
 */
export async function analyzeReview({ rating, title, body }) {
  if (!isAiConfigured() || (!title && !body)) {
    return heuristicAnalyzeReview({ rating, title, body });
  }

  try {
    const { text } = await chatJson({
      system: `Tu analyses des avis e-commerce pour une marketplace africaine et internationale (BAARO-MARKET).
Réponds UNIQUEMENT en JSON valide avec les clés :
{
  "sentiment": "positive"|"neutral"|"negative"|"mixed",
  "sentiment_score": number between -1 and 1,
  "themes": string[] (ex: livraison, qualité, prix, service, emballage),
  "language": "fr"|"en"|"other",
  "toxicity": "none"|"low"|"high",
  "summary": string (1 phrase, max 160 chars, même langue que l'avis)
}
Sois factuel. toxicity=high uniquement pour insultes graves ou menaces.`,
      user: JSON.stringify({ rating, title: title || null, body: body || null }),
      temperature: 0.1,
      maxTokens: 400,
    });

    const parsed = parseModelJson(text);
    if (!parsed || !SENTIMENTS.has(parsed.sentiment)) {
      return heuristicAnalyzeReview({ rating, title, body });
    }

    return {
      sentiment: parsed.sentiment,
      sentiment_score: Number(parsed.sentiment_score) || 0,
      themes: Array.isArray(parsed.themes) ? parsed.themes.slice(0, 8).map(String) : [],
      language: parsed.language || 'fr',
      toxicity: ['none', 'low', 'high'].includes(parsed.toxicity) ? parsed.toxicity : 'none',
      summary: parsed.summary ? String(parsed.summary).slice(0, 200) : null,
      provider: 'llm',
    };
  } catch (e) {
    console.error('[review-ai] analyzeReview fallback:', e?.message || e);
    return heuristicAnalyzeReview({ rating, title, body });
  }
}

/**
 * Synthèse des avis d'un produit.
 * @param {Array<{rating, title, body, sentiment?}>} reviews
 */
export async function summarizeProductReviews(reviews) {
  const list = Array.isArray(reviews) ? reviews.slice(0, 40) : [];
  if (list.length === 0) {
    return {
      overview: null,
      pros: [],
      cons: [],
      sentiment_distribution: { positive: 0, neutral: 0, negative: 0, mixed: 0 },
      top_themes: [],
      provider: 'none',
    };
  }

  const dist = { positive: 0, neutral: 0, negative: 0, mixed: 0 };
  const themeCount = {};
  for (const r of list) {
    const s = r.sentiment || heuristicAnalyzeReview(r).sentiment;
    if (dist[s] != null) dist[s] += 1;
    const themes = r.themes || heuristicAnalyzeReview(r).themes || [];
    for (const t of themes) themeCount[t] = (themeCount[t] || 0) + 1;
  }
  const top_themes = Object.entries(themeCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  if (!isAiConfigured()) {
    const avg = list.reduce((s, r) => s + (Number(r.rating) || 0), 0) / list.length;
    return {
      overview:
        avg >= 4
          ? `Avis globalement positifs (${list.length} avis, moyenne ${avg.toFixed(1)}/5).`
          : avg <= 2.5
            ? `Avis globalement négatifs (${list.length} avis, moyenne ${avg.toFixed(1)}/5).`
            : `Avis mitigés (${list.length} avis, moyenne ${avg.toFixed(1)}/5).`,
      pros: top_themes.slice(0, 2).map((t) => t.name),
      cons: [],
      sentiment_distribution: dist,
      top_themes,
      provider: 'heuristic',
    };
  }

  try {
    const payload = list.map((r) => ({
      rating: r.rating,
      title: r.title,
      body: (r.body || '').slice(0, 300),
      sentiment: r.sentiment,
    }));

    const { text } = await chatJson({
      system: `Tu synthétises des avis produit pour une marketplace.
Réponds UNIQUEMENT en JSON :
{
  "overview": string (2-3 phrases en français),
  "pros": string[] (points forts récurrents, max 5),
  "cons": string[] (points faibles récurrents, max 5),
  "buyer_advice": string (conseil court à l'acheteur)
}`,
      user: JSON.stringify({ reviews: payload, distribution: dist }),
      temperature: 0.3,
      maxTokens: 600,
    });

    const parsed = parseModelJson(text) || {};
    return {
      overview: parsed.overview ? String(parsed.overview).slice(0, 600) : null,
      pros: Array.isArray(parsed.pros) ? parsed.pros.slice(0, 5).map(String) : [],
      cons: Array.isArray(parsed.cons) ? parsed.cons.slice(0, 5).map(String) : [],
      buyer_advice: parsed.buyer_advice ? String(parsed.buyer_advice).slice(0, 300) : null,
      sentiment_distribution: dist,
      top_themes,
      provider: 'llm',
    };
  } catch (e) {
    console.error('[review-ai] summarize fallback:', e?.message || e);
    return {
      overview: `${list.length} avis analysés.`,
      pros: [],
      cons: [],
      sentiment_distribution: dist,
      top_themes,
      provider: 'heuristic',
    };
  }
}
