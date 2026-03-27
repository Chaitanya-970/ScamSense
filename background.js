// ─────────────────────────────────────────────
//  ScamSense — background.js
//  Gemini 2.0 Flash gateway with exponential backoff
// ─────────────────────────────────────────────

const GEMINI_API_KEY = 'YOUR_GEMINI_API_KEY_HERE'; // 🔑 Replace with your key
const GEMINI_MODEL   = 'gemini-2.0-flash';
const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

const MAX_RETRIES       = 4;
const BASE_DELAY_MS     = 2000;  // starts at 2s, doubles each retry
const MIN_CALL_GAP_MS   = 5000;  // enforce at least 5s between Gemini calls (free tier: 15 RPM)

// ── Global API serializer ─────────────────────
// Ensures only ONE Gemini call runs at a time, with a minimum gap between calls.
// This prevents the "3 simultaneous calls all 429ing" pattern seen in logs.
let apiQueue        = Promise.resolve(); // chain all calls onto this
let lastCallTime    = 0;

function enqueueApiCall(fn) {
  apiQueue = apiQueue.then(async () => {
    const now     = Date.now();
    const elapsed = now - lastCallTime;
    if (elapsed < MIN_CALL_GAP_MS) {
      await sleep(MIN_CALL_GAP_MS - elapsed);
    }
    lastCallTime = Date.now();
    return fn();
  });
  return apiQueue;
}

// ── Persistent stats (survive service-worker restarts) ──
async function getStats() {
  const result = await chrome.storage.local.get(['threatsCount', 'securityLevel']);
  return {
    threatsCount:  result.threatsCount  ?? 0,
    securityLevel: result.securityLevel ?? 100  // 0-100, starts at "safe"
  };
}

async function saveStats(stats) {
  await chrome.storage.local.set(stats);
}

// ── Gemini call with exponential backoff ──────
async function callGemini(text, retries = 0) {
  if (retries === 0) console.log('[ScamSense] Firing Gemini API call...');
  const prompt = `
You are ScamSense, an AI fraud-detection assistant specialized in Indian digital scams.
Analyze the following message for scam/fraud indicators.

Message:
"""
${text}
"""

Respond ONLY in this exact JSON format (no markdown, no extra text):
{
  "flagged": true | false,
  "confidence": 0-100,
  "reason": "short explanation (max 15 words)",
  "scamType": "phishing | vishing | lottery | impersonation | other | none"
}
`.trim();

  let delay = BASE_DELAY_MS * Math.pow(2, retries); // exponential backoff

  try {
    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 200 }
      })
    });

    // ── 429 Rate Limit: backoff and retry ─────
    if (response.status === 429) {
      if (retries >= MAX_RETRIES) {
        console.error('[ScamSense] Max retries reached after 429 errors.');
        return { flagged: false, reason: 'Rate limit exceeded — try again later.', confidence: 0 };
      }

      const retryAfter = response.headers.get('Retry-After');
      const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : delay;

      console.warn(`[ScamSense] 429 received. Retrying in ${waitMs}ms (attempt ${retries + 1}/${MAX_RETRIES})...`);
      await sleep(waitMs);
      return callGemini(text, retries + 1);
    }

    if (!response.ok) {
      const errBody = await response.text();
      console.error('[ScamSense] Gemini API error:', response.status, errBody);
      return { flagged: false, reason: `API error ${response.status}`, confidence: 0 };
    }

    const data = await response.json();
    const raw  = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';

    // Clean any accidental markdown fences
    const cleaned = raw.replace(/```json|```/gi, '').trim();
    const parsed  = JSON.parse(cleaned);

    return {
      flagged:    parsed.flagged    ?? false,
      confidence: parsed.confidence ?? 0,
      reason:     parsed.reason     ?? '',
      scamType:   parsed.scamType   ?? 'none'
    };

  } catch (err) {
    console.error('[ScamSense] Fetch error:', err);
    return { flagged: false, reason: 'Network error', confidence: 0 };
  }
}

// ── Utility ───────────────────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Message handler ───────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.type === 'ANALYZE_MESSAGE') {
    (async () => {
      console.log('[ScamSense] Queuing API call from', msg.payload.source);

      // Serialize through global queue — no concurrent Gemini calls
      const result = await enqueueApiCall(() => callGemini(msg.payload.text));

      // Always increment scan counter
      const stats = await getStats();
      stats.scansCount = (stats.scansCount ?? 0) + 1;

      if (result.flagged) {
        stats.threatsCount += 1;
        const penalty = Math.round((result.confidence / 100) * 15);
        stats.securityLevel = Math.max(0, stats.securityLevel - penalty);
        chrome.action.setBadgeText({ text: String(stats.threatsCount) });
        chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' });
      }

      await saveStats(stats);

      sendResponse(result);
    })();

    return true; // keep channel open for async response
  }

  if (msg.type === 'INCREMENT_SCANS') {
    // Bumps the "messages scanned" counter shown in the popup dashboard
    (async () => {
      const stats = await getStats();
      stats.scansCount = (stats.scansCount ?? 0) + 1;
      await saveStats(stats);
    })();
  }

  if (msg.type === 'GET_STATS') {
    (async () => {
      const stats = await getStats();
      sendResponse(stats);
    })();
    return true;
  }

  if (msg.type === 'RESET_STATS') {
    (async () => {
      await saveStats({ threatsCount: 0, securityLevel: 100, scansCount: 0 });
      chrome.action.setBadgeText({ text: '' });
      sendResponse({ ok: true });
    })();
    return true;
  }
});

console.log('[ScamSense] Background service worker ready.');