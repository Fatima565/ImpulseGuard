const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

admin.initializeApp();

const OPENROUTER_API_KEY = defineSecret('OPENROUTER_API_KEY');

function cleanApiKey(value) {
  let key = String(value || '');

  // Remove accidental line breaks, spaces, zero-width chars, and wrapping quotes.
  key = key
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/\s+/g, '');

  return key;
}

exports.ai = onRequest(
  {
    region: 'us-central1',
    cors: [
      'https://impulseguard.dev',
      'https://www.impulseguard.dev',
      'https://fatima565.github.io'
    ],
    secrets: [OPENROUTER_API_KEY],
    timeoutSeconds: 60,
    memory: '256MiB',
    maxInstances: 2
  },
  async (req, res) => {
    res.set('Cache-Control', 'no-store');

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
      const authHeader = req.get('authorization') || '';
      if (!authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Please log in again.' });
      }

      const idToken = authHeader.slice('Bearer '.length).trim();
      await admin.auth().verifyIdToken(idToken);

      const { prompt, imageData = null, mimeType = null } = req.body || {};

      if (typeof prompt !== 'string' || !prompt.trim()) {
        return res.status(400).json({ error: 'A prompt is required.' });
      }

      if (prompt.length > 15000) {
        return res.status(400).json({ error: 'Prompt is too long.' });
      }

      if (imageData && typeof imageData !== 'string') {
        return res.status(400).json({ error: 'Invalid receipt image.' });
      }

      if (imageData && imageData.length > 10_000_000) {
        return res.status(413).json({
          error: 'Receipt image is too large. Use an image under about 7 MB.'
        });
      }

      const apiKey = cleanApiKey(OPENROUTER_API_KEY.value());

      if (!apiKey.startsWith('sk-or-') || apiKey.length < 40) {
        console.error('OpenRouter secret is malformed', {
          length: apiKey.length,
          startsCorrectly: apiKey.startsWith('sk-or-')
        });

        return res.status(500).json({
          error: 'The saved OpenRouter key is malformed. Please save it again.'
        });
      }

      const content = imageData && mimeType
        ? [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${imageData}`
              }
            }
          ]
        : prompt;

      const openRouterResponse = await fetch(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'HTTP-Referer': 'https://impulseguard.dev',
            'X-Title': 'ImpulseGuard'
          },
          body: JSON.stringify({
            model: 'openrouter/free',
            messages: [{ role: 'user', content }],
            max_tokens: 800,
            temperature: imageData ? 0.2 : 0.8
          })
        }
      );

      const raw = await openRouterResponse.text();
      let data = {};

      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = {
          error: {
            message: raw || 'Invalid OpenRouter response'
          }
        };
      }

      if (!openRouterResponse.ok) {
        console.error('OpenRouter error', {
          status: openRouterResponse.status,
          message: data?.error?.message,
          keyLength: apiKey.length,
          keyLast4: apiKey.slice(-4)
        });

        return res.status(openRouterResponse.status).json({
          error:
            data?.error?.message ||
            `OpenRouter request failed (${openRouterResponse.status})`
        });
      }

      const text = data?.choices?.[0]?.message?.content;

      if (!text) {
        return res.status(502).json({
          error: 'The AI returned an empty response.'
        });
      }

      return res.status(200).json({ text });
    } catch (error) {
      console.error('AI function error', error);

      const authError = String(error?.code || '').startsWith('auth/');

      return res.status(authError ? 401 : 500).json({
        error: authError
          ? 'Your login expired. Please sign in again.'
          : 'Could not contact the AI service.'
      });
    }
  }
);
