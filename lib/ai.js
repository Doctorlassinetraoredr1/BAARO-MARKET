/**
 * Client LLM compatible OpenAI (OpenAI, xAI Grok, Groq, Azure, etc.).
 *
 * Variables :
 *   AI_API_KEY      — requis pour activer l'IA
 *   AI_BASE_URL     — défaut https://api.openai.com/v1 (xAI: https://api.x.ai/v1)
 *   AI_MODEL        — défaut gpt-4o-mini (xAI: grok-2-latest ou grok-3-mini)
 */

export function isAiConfigured() {
  return Boolean(process.env.AI_API_KEY);
}

export function aiConfig() {
  return {
    apiKey: process.env.AI_API_KEY || '',
    baseUrl: (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    model: process.env.AI_MODEL || 'gpt-4o-mini',
  };
}

/**
 * Chat completion JSON-oriented.
 * @param {object} opts
 * @param {string} opts.system
 * @param {string} opts.user
 * @param {number} [opts.temperature]
 * @param {number} [opts.maxTokens]
 * @returns {Promise<{ text: string, raw?: object }>}
 */
export async function chatJson({ system, user, temperature = 0.2, maxTokens = 800 }) {
  if (!isAiConfigured()) {
    const err = new Error('AI not configured');
    err.code = 'AI_NOT_CONFIGURED';
    throw err;
  }
  const { apiKey, baseUrl, model } = aiConfig();

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || `AI HTTP ${res.status}`;
    const err = new Error(msg);
    err.code = 'AI_HTTP_ERROR';
    err.status = res.status;
    throw err;
  }

  const text = data?.choices?.[0]?.message?.content || '';
  return { text, raw: data };
}

/**
 * Parse JSON from model output (tolerant).
 */
export function parseModelJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const m = String(text).match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}
