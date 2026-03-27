// ─────────────────────────────────────────────
//  ScamSense — background.js
//  Local ML model gateway via Flask API
// ─────────────────────────────────────────────

const API_URL = 'http://localhost:5000/analyze';

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

// ── Local model call ──────────────────────────
async function callLocalModel(text) {
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    if (!response.ok) {
      return { flagged: false, reason: `Server error ${response.status}`, confidence: 0 };
    }
    return await response.json();
  } catch (err) {
    console.error('[ScamSense] Local model error:', err);
    return { flagged: false, reason: 'ScamSense server not running. Start it with: python server/app.py', confidence: 0 };
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
      console.log('[ScamSense] Analyzing message from', msg.payload.source);

      const result = await callLocalModel(msg.payload.text);

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
