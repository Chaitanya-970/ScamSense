// ─────────────────────────────────────────────
//  ScamSense — popup.js
//  Dashboard stats + manual transcript analysis
// ─────────────────────────────────────────────

// ── DOM refs ──────────────────────────────────
const threatsCountEl  = document.getElementById('threats-count');
const gaugeBarEl      = document.getElementById('gauge-bar');
const gaugeLabelEl    = document.getElementById('gauge-label');
const transcriptEl    = document.getElementById('transcript-input');
const analyzeBtn      = document.getElementById('analyze-btn');
const resultBoxEl     = document.getElementById('result-box');
const resultTextEl    = document.getElementById('result-text');
const resetBtn        = document.getElementById('reset-btn');
const statusDotEl     = document.getElementById('status-dot');

// ── Load stats from background ────────────────
async function loadStats() {
  chrome.runtime.sendMessage({ type: 'GET_STATS' }, (stats) => {
    if (chrome.runtime.lastError || !stats) return;

    threatsCountEl.textContent = stats.threatsCount;

    // Update scans counter
    const scansCountEl = document.getElementById('scans-count');
    if (scansCountEl) scansCountEl.textContent = stats.scansCount ?? 0;

    const level = Math.max(0, Math.min(100, stats.securityLevel));
    gaugeBarEl.style.width = level + '%';

    // Color gradient: green → yellow → red
    if (level >= 70) {
      gaugeBarEl.style.background = 'linear-gradient(90deg, #00c853, #69f0ae)';
      gaugeLabelEl.textContent = 'SECURE';
      gaugeLabelEl.className = 'gauge-label secure';
    } else if (level >= 40) {
      gaugeBarEl.style.background = 'linear-gradient(90deg, #ffd600, #ffab00)';
      gaugeLabelEl.textContent = 'CAUTION';
      gaugeLabelEl.className = 'gauge-label caution';
    } else {
      gaugeBarEl.style.background = 'linear-gradient(90deg, #ff3b3b, #c0392b)';
      gaugeLabelEl.textContent = 'AT RISK';
      gaugeLabelEl.className = 'gauge-label risk';
    }
  });
}

// ── Analyze pasted transcript ─────────────────
analyzeBtn.addEventListener('click', async () => {
  const text = transcriptEl.value.trim();
  if (!text) {
    showResult('warning', '⚠️ Please paste a transcript first.');
    return;
  }

  analyzeBtn.disabled = true;
  analyzeBtn.textContent = 'Analyzing…';
  statusDotEl.classList.add('pulsing');
  resultBoxEl.classList.add('hidden');

  // Send to background for Gemini analysis
  chrome.runtime.sendMessage(
    { type: 'ANALYZE_MESSAGE', payload: { text, source: 'manual-transcript' } },
    (result) => {
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = 'Analyze Transcript';
      statusDotEl.classList.remove('pulsing');

      if (chrome.runtime.lastError || !result) {
        showResult('error', '❌ Error communicating with background. Try again.');
        return;
      }

      if (result.flagged) {
        const confidence = result.confidence ?? '?';
        const scamType   = result.scamType   ? ` [${result.scamType.toUpperCase()}]` : '';
        showResult('danger',
          `🚨 SCAM DETECTED${scamType}\n` +
          `Confidence: ${confidence}%\n` +
          `Reason: ${result.reason}`
        );
        loadStats(); // refresh counter
      } else {
        showResult('safe',
          `✅ No scam detected.\n` +
          `Confidence: ${result.confidence ?? '?'}%\n` +
          `${result.reason ? 'Note: ' + result.reason : 'This transcript appears safe.'}`
        );
      }
    }
  );
});

function showResult(type, message) {
  resultBoxEl.className = 'result-box ' + type;
  resultTextEl.textContent = message;
  resultBoxEl.classList.remove('hidden');
}

// ── Reset stats ───────────────────────────────
resetBtn.addEventListener('click', () => {
  if (!confirm('Reset all threat data?')) return;
  chrome.runtime.sendMessage({ type: 'RESET_STATS' }, () => {
    loadStats();
    resultBoxEl.classList.add('hidden');
  });
});

// ── Init ──────────────────────────────────────
loadStats();