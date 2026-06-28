const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

admin.initializeApp();

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');

function cleanSecret(value) {
  return String(value || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/\s+/g, '');
}

exports.ai = onRequest(
  {
    region: 'us-central1',
    cors: [
      'https://impulseguard.dev',
      'https://www.impulseguard.dev',
      'https://fatima565.github.io'
    ],
    secrets: [GEMINI_API_KEY],
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
      // Only signed-in ImpulseGuard users may call the AI backend.
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

      // Base64 is larger than the original image; keep requests well below Gemini's inline limit.
      if (imageData && imageData.length > 10_000_000) {
        return res.status(413).json({
          error: 'Receipt image is too large. Please use an image under about 7 MB.'
        });
      }

      const apiKey = cleanSecret(GEMINI_API_KEY.value());

      if (apiKey.length < 30) {
        console.error('Gemini secret is malformed', { length: apiKey.length });
        return res.status(500).json({
          error: 'The saved Gemini API key is malformed. Please save it again.'
        });
      }

      const parts = [{ text: prompt }];

      if (imageData && mimeType) {
        parts.push({
          inline_data: {
            mime_type: mimeType,
            data: imageData
          }
        });
      }

      const wantsJson =
        /exact json|only in json|respond only in json|raw json/i.test(prompt);

      const geminiResponse = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
          },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts
              }
            ],
            generationConfig: {
              maxOutputTokens: 1000,
              temperature: imageData ? 0.2 : wantsJson ? 0.3 : 0.8,
              ...(wantsJson
                ? { responseMimeType: 'application/json' }
                : {})
            }
          })
        }
      );

      const raw = await geminiResponse.text();
      let data = {};

      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = { error: { message: raw || 'Invalid Gemini response' } };
      }

      if (!geminiResponse.ok) {
        const message =
          data?.error?.message ||
          `Gemini request failed (${geminiResponse.status})`;

        console.error('Gemini API error', {
          status: geminiResponse.status,
          message
        });

        return res.status(geminiResponse.status).json({ error: message });
      }

      const text = (data?.candidates?.[0]?.content?.parts || [])
        .map((part) => part?.text || '')
        .join('')
        .trim();

      if (!text) {
        const blockReason = data?.promptFeedback?.blockReason;
        return res.status(502).json({
          error: blockReason
            ? `Gemini blocked the request: ${blockReason}`
            : 'The AI returned an empty response.'
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
