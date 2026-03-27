// ─────────────────────────────────────────────
//  ScamSense — content.js
//  Throttled message scanner with keyword filter
// ─────────────────────────────────────────────

const SUSPICIOUS_KEYWORDS = [
  'money', 'prize', 'lottery', 'police', 'cbi', 'aadhaar',
  'upi', 'link', 'pay', 'arrest', 'reward', 'winner',
  'account', 'otp', 'bank', 'fraud', 'verify', 'urgent'
];

const THROTTLE_INTERVAL_MS = 6000;
const MAX_QUEUE_SIZE = 20;

let messageQueue = [];
let isProcessing = false;

// ── Cooldown tracker ──────────────────────────
// Prevents the same flagged message from re-bannering within BANNER_COOLDOWN_MS.
// After the cooldown expires, the same message WILL alert again (genuinely new receipt).
const BANNER_COOLDOWN_MS = 20 * 1000; // 20 seconds

function loadMap(key) {
  try {
    const raw = sessionStorage.getItem(key);
    return new Map(raw ? JSON.parse(raw) : []);
  } catch { return new Map(); }
}

function saveMap(key, map) {
  try {
    sessionStorage.setItem(key, JSON.stringify([...map]));
  } catch { /* ignore quota errors */ }
}

// Messages already sent to the model (don't re-queue the same DOM element)
function loadSet(key) {
  try {
    const raw = sessionStorage.getItem(key);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}

function saveSet(key, set) {
  try {
    const arr = [...set];
    if (arr.length > 500) arr.splice(0, arr.length - 500);
    sessionStorage.setItem(key, JSON.stringify(arr));
  } catch { /* ignore quota errors */ }
}

const lastSeenMessages = loadSet('ss_seen');
// Map of messageText -> timestamp of last banner shown
const recentlyBannered = loadMap('ss_bannered');

// ── Keyword filter ────────────────────────────
function isSuspicious(text) {
  const lower = text.toLowerCase();
  return SUSPICIOUS_KEYWORDS.some(kw => lower.includes(kw));
}

// ── Enqueue a message for analysis ────────────
function enqueue(text, source) {
  const key = `${source}:${text.trim()}`;
  if (lastSeenMessages.has(key)) return;
  lastSeenMessages.add(key);
  saveSet('ss_seen', lastSeenMessages);

  if (!isSuspicious(text)) return;

  if (messageQueue.length >= MAX_QUEUE_SIZE) {
    messageQueue.shift();
  }

  messageQueue.push({ text, source });
  if (!isProcessing) processQueue();
}

// ── Throttled queue processor ──────────────────
function processQueue() {
  if (messageQueue.length === 0) {
    isProcessing = false;
    return;
  }

  isProcessing = true;
  const { text, source } = messageQueue.shift();

  chrome.runtime.sendMessage(
    { type: 'ANALYZE_MESSAGE', payload: { text, source } },
    (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[ScamSense] Send error:', chrome.runtime.lastError.message);
      } else if (response?.flagged) {
        const bannerKey = text.trim();
        const lastShown = recentlyBannered.get(bannerKey) ?? 0;
        if (Date.now() - lastShown > BANNER_COOLDOWN_MS) {
          showWarningBanner(text, response.reason);
          recentlyBannered.set(bannerKey, Date.now());
          saveMap('ss_bannered', recentlyBannered);
        }
      }
    }
  );

  setTimeout(processQueue, THROTTLE_INTERVAL_MS);
}

// ── DOM observer: watch for new messages ───────
function observeMessages() {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        const waSelectors = [
          '[data-testid="msg-container"]',
          '[data-testid="conversation-panel-messages"] .copyable-text',
          'span.selectable-text.copyable-text',
          '[class*="message-in"] .copyable-text',
          '[class*="message-out"] .copyable-text',
        ];

        for (const sel of waSelectors) {
          const elements = node.matches?.(sel) ? [node] : [...(node.querySelectorAll?.(sel) ?? [])];
          for (const el of elements) {
            const text = el.innerText?.trim();
            if (text && text.length > 10) enqueue(text, 'whatsapp-web');
          }
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  console.log('[ScamSense] Observer attached.');
}

// ── Warning Banner ────────────────────────────
function showWarningBanner(_text, reason) {
  document.getElementById('scamsense-banner')?.remove();

  const banner = document.createElement('div');
  banner.id = 'scamsense-banner';

  const inner = document.createElement('div');
  inner.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; z-index: 999999;
    background: linear-gradient(135deg, #ff3b3b, #c0392b);
    color: #fff; font-family: 'Segoe UI', sans-serif;
    padding: 12px 20px; display: flex; align-items: center;
    justify-content: space-between; box-shadow: 0 4px 20px rgba(0,0,0,0.4);
    border-bottom: 2px solid #ff6b6b;
  `;

  const label = document.createElement('span');
  label.style.fontSize = '15px';
  label.innerHTML = `⚠️ <strong>ScamSense Alert:</strong> ${reason || 'Suspicious message detected!'}`;

  const dismissBtn = document.createElement('button');
  dismissBtn.textContent = '✕ Dismiss';
  dismissBtn.style.cssText = `
    background: rgba(255,255,255,0.2); border: none; color: #fff;
    padding: 4px 12px; border-radius: 4px; cursor: pointer; font-size: 13px;
  `;
  dismissBtn.addEventListener('click', () => {
    banner.remove();
  });

  inner.appendChild(label);
  inner.appendChild(dismissBtn);
  banner.appendChild(inner);
  document.body.prepend(banner);
}

// ── Init ──────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', observeMessages);
} else {
  observeMessages();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'MANUAL_ANALYZE') {
    enqueue(msg.text, 'manual-paste');
    sendResponse({ queued: true });
  }
});
