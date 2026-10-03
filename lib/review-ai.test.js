import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { heuristicAnalyzeReview, summarizeProductReviews } from './review-ai.js';

describe('heuristicAnalyzeReview', () => {
  it('positive high rating', () => {
    const a = heuristicAnalyzeReview({ rating: 5, title: 'Parfait', body: 'Excellent produit super qualité' });
    assert.equal(a.sentiment, 'positive');
    assert.ok(a.themes.includes('qualité') || a.sentiment === 'positive');
  });

  it('negative low rating', () => {
    const a = heuristicAnalyzeReview({ rating: 1, title: 'Arnaque', body: 'Mauvais produit cassé' });
    assert.equal(a.sentiment, 'negative');
  });

  it('detects shipping theme', () => {
    const a = heuristicAnalyzeReview({ rating: 3, title: '', body: 'Livraison très lente' });
    assert.ok(a.themes.includes('livraison'));
  });
});

describe('summarizeProductReviews', () => {
  it('empty list', async () => {
    const s = await summarizeProductReviews([]);
    assert.equal(s.provider, 'none');
    assert.equal(s.overview, null);
  });

  it('heuristic summary', async () => {
    const s = await summarizeProductReviews([
      { rating: 5, title: 'Top', body: 'Super qualité', sentiment: 'positive', themes: ['qualité'] },
      { rating: 4, title: 'Bien', body: 'Livraison rapide', sentiment: 'positive', themes: ['livraison'] },
    ]);
    assert.ok(s.overview);
    assert.ok(s.sentiment_distribution.positive >= 2);
    assert.equal(s.provider, 'heuristic');
  });
});
