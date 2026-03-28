// ─────────────────────────────────────────────
//  ScamSense — content.js
//  Throttled message scanner with keyword filter
// ─────────────────────────────────────────────

const SUSPICIOUS_KEYWORDS = [
  'money', 'prize', 'lottery', 'police', 'cbi', 'aadhaar',
  'upi', 'link', 'pay', 'arrest', 'reward', 'winner',
  'account', 'otp', 'bank', 'fraud', 'verify', 'urgent'
];

const THROTTLE_INTERVAL_MS = 2000;  // 2s between API calls
const MAX_QUEUE_SIZE = 20;
const SELECTOR_DEDUP_MS = 3000;     // ignore same text if seen within 3s (multiple selectors firing for one message)

let messageQueue = [];
let isProcessing = false;
let nextMsgId = 0;
const dismissedIds = new Set();

// Deduplicate by DOM element reference — same node re-rendered by WhatsApp = skipped.
const processedElements = new WeakSet();
// Deduplicate by text within a short window — prevents multiple selectors
// matching the same message and queuing it 3-4 times.
// After SELECTOR_DEDUP_MS, the same text is treated as a new message.
const recentTexts = new Map(); // text -> timestamp

// ── Keyword filter ────────────────────────────
function isSuspicious(text) {
  const lower = text.toLowerCase();
  return SUSPICIOUS_KEYWORDS.some(kw => lower.includes(kw));
}

// ── Enqueue a message for analysis ────────────
function enqueue(el, text, source) {
  // 1. Skip if this exact DOM element was already processed
  if (processedElements.has(el)) return;
  processedElements.add(el);

  if (!isSuspicious(text)) return;

  // 2. Skip if the same text was queued within SELECTOR_DEDUP_MS
  //    (multiple selectors firing for the same message bubble)
  const key = text.trim();
  const lastQueued = recentTexts.get(key) ?? 0;
  if (Date.now() - lastQueued < SELECTOR_DEDUP_MS) return;
  recentTexts.set(key, Date.now());

  if (messageQueue.length >= MAX_QUEUE_SIZE) {
    messageQueue.shift();
  }

  messageQueue.push({ text, source, msgId: nextMsgId++ });
  if (!isProcessing) processQueue();
}

// ── Throttled queue processor ──────────────────
function processQueue() {
  if (messageQueue.length === 0) {
    isProcessing = false;
    return;
  }

  isProcessing = true;
  const { text, source, msgId } = messageQueue.shift();

  chrome.runtime.sendMessage(
    { type: 'ANALYZE_MESSAGE', payload: { text, source } },
    (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[ScamSense] Send error:', chrome.runtime.lastError.message);
      } else if (response?.flagged && !dismissedIds.has(msgId)) {
        showWarningBanner(response.reason, msgId);
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
            if (text && text.length > 10) enqueue(el, text, 'whatsapp-web');
          }
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  console.log('[ScamSense] Observer attached.');
}

// ── Warning Banner ────────────────────────────
function showWarningBanner(reason, msgId) {
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
    dismissedIds.add(msgId);
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
    enqueue(document.createElement('span'), msg.text, 'manual-paste');
    sendResponse({ queued: true });
  }
});
