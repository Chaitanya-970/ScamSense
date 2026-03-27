# ScamSense: Implementation Plan for Claude Code

> **Context**: Existing Chrome Extension (Manifest V3) that detects scams on WhatsApp Web / Google Messages. Currently calls **Gemini 2.0 Flash API** for every message. Goal is to **replace Gemini with a locally-trained ML model** (scikit-learn / XGBoost), served via a lightweight Python API, so we have a real trained-and-tested model for the hackathon.

---

## Architecture Overview

```
┌─────────────────────┐     HTTP POST      ┌─────────────────────┐
│  Chrome Extension   │ ──────────────────► │  Flask API Server   │
│  (content.js /      │ ◄────────────────── │  (Python, port 5000)│
│   background.js)    │   JSON response     │                     │
└─────────────────────┘                     │  Loads trained      │
                                            │  model + vectorizer │
                                            └─────────────────────┘
                                                      ▲
                                            ┌─────────┴──────────┐
                                            │ train_model.py     │
                                            │ (offline pipeline) │
                                            │ Dataset → TF-IDF   │
                                            │ → XGBoost/SVM      │
                                            │ → model.pkl        │
                                            └────────────────────┘
```

---

## Step 1 — Dataset Preparation (`data/` folder)

### [NEW] `data/prepare_data.py`

1. **Download datasets** — use publicly available SMS spam datasets:
   - [UCI SMS Spam Collection](https://archive.ics.uci.edu/ml/datasets/sms+spam+collection) (5,574 messages, `ham`/`spam` labeled)
   - Optionally supplement with a Kaggle WhatsApp/call scam dataset if found
2. **Load & merge** into a single pandas DataFrame with columns: `text`, `label` (0 = safe, 1 = scam)
3. **Basic cleaning**: lowercase, strip URLs/phone-numbers, remove extra whitespace
4. **Train/test split**: 80/20 stratified split, save as `data/train.csv` and `data/test.csv`
5. **Print class distribution** so we can verify balance

> [!TIP]
> Keep the dataset file (`SMSSpamCollection`) checked into the repo under `data/raw/` so anyone can reproduce.

---

## Step 2 — Model Training (`model/train_model.py`)

### [NEW] `model/train_model.py`

A single Python script that:

1. Loads `data/train.csv`
2. **Feature extraction**: `TfidfVectorizer(max_features=5000, ngram_range=(1,2))`
3. **Trains two models** for comparison:
   - `sklearn.svm.LinearSVC` (fast, good baseline)
   - `xgboost.XGBClassifier` (gradient boosting, usually better)
4. **Evaluates on `data/test.csv`** — prints:
   - Accuracy, Precision, Recall, F1-score
   - Confusion matrix
   - Classification report
5. **Saves the best model** + vectorizer using `joblib`:
   - `model/scam_model.pkl`
   - `model/tfidf_vectorizer.pkl`
6. Prints a summary table comparing both models

### Dependencies (add to `requirements.txt`)
```
pandas
scikit-learn
xgboost
joblib
flask
flask-cors
```

---

## Step 3 — Flask API Server (`server/app.py`)

### [NEW] `server/app.py`

A minimal Flask server that:

1. On startup, loads `model/scam_model.pkl` and `model/tfidf_vectorizer.pkl`
2. Exposes **one endpoint**:

```
POST /analyze
Content-Type: application/json
Body: { "text": "You won a prize! Click here..." }

Response: {
  "flagged": true,
  "confidence": 92,
  "reason": "Lottery/prize scam pattern detected",
  "scamType": "lottery"
}
```

3. Logic:
   - Vectorize input text with the loaded TF-IDF vectorizer
   - Run prediction with loaded model
   - If model supports `predict_proba`, use it for confidence; otherwise use `decision_function` normalized to 0-100
   - Map to scam types using keyword heuristics (simple `if`/`elif` on the text)
4. Enable **CORS** (`flask-cors`) so the Chrome extension can call it from any origin
5. Run on `http://localhost:5000`

---

## Step 4 — Rewire the Chrome Extension

### [MODIFY] [background.js](file:///c:/Users/Eshan/Downloads/ScamSense-main/ScamSense-main/background.js)

**Replace Gemini API call with local Flask call:**

- Remove `GEMINI_API_KEY`, `GEMINI_URL`, and [callGemini()](file:///c:/Users/Eshan/Downloads/ScamSense-main/ScamSense-main/background.js#46-119) function
- Add new `callLocalModel(text)` function:
  ```javascript
  async function callLocalModel(text) {
    const response = await fetch('http://localhost:5000/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    return await response.json();
  }
  ```
- Update the `ANALYZE_MESSAGE` handler to call `callLocalModel()` instead of [callGemini()](file:///c:/Users/Eshan/Downloads/ScamSense-main/ScamSense-main/background.js#46-119)
- Remove rate-limiting / backoff logic (no longer needed for local server)
- Add error handling for "server not running" scenario

### [MODIFY] [manifest.json](file:///c:/Users/Eshan/Downloads/ScamSense-main/ScamSense-main/manifest.json)

- Update `host_permissions`: replace Gemini URL with `http://localhost:5000/*`
- Remove `https://generativelanguage.googleapis.com/*`

### [MODIFY] [popup.html](file:///c:/Users/Eshan/Downloads/ScamSense-main/ScamSense-main/popup.html)

- Change footer from "Powered by Gemini 2.0 Flash" → "Powered by ScamSense ML Engine"

### [MODIFY] [content.js](file:///c:/Users/Eshan/Downloads/ScamSense-main/ScamSense-main/content.js)

- No major changes needed (it already sends messages to background.js)
- Minor: optionally expand `SUSPICIOUS_KEYWORDS` list using top features from the trained model

### [MODIFY] [popup.js](file:///c:/Users/Eshan/Downloads/ScamSense-main/ScamSense-main/popup.js)

- No changes needed (it already works with the message protocol)

---

## Step 5 — Project Structure (Final)

```
ScamSense-main/
├── data/
│   ├── raw/
│   │   └── SMSSpamCollection       # UCI dataset
│   ├── prepare_data.py             # Step 1
│   ├── train.csv                   # generated
│   └── test.csv                    # generated
├── model/
│   ├── train_model.py              # Step 2
│   ├── scam_model.pkl              # generated
│   └── tfidf_vectorizer.pkl        # generated
├── server/
│   └── app.py                      # Step 3
├── background.js                   # modified
├── content.js                      # minor update
├── manifest.json                   # modified
├── popup.html                      # modified
├── popup.js                        # no changes
└── requirements.txt                # NEW
```

---

## Verification Plan — Step-by-Step Testing

### Test A: Dataset Preparation

```powershell
# From the project root:
cd c:\Users\Eshan\Downloads\ScamSense-main\ScamSense-main
pip install pandas scikit-learn xgboost joblib flask flask-cors
python data/prepare_data.py
```

**Expected output:**
- `data/train.csv` and `data/test.csv` created
- Console prints class distribution (≈87% ham, ≈13% spam)
- No errors

**Verify:**
```powershell
python -c "import pandas as pd; df=pd.read_csv('data/test.csv'); print(df.shape, df['label'].value_counts().to_dict())"
```

---

### Test B: Model Training & Evaluation

```powershell
python model/train_model.py
```

**Expected output:**
- Prints accuracy, precision, recall, F1 for both LinearSVC and XGBoost
- Prints confusion matrix
- Saves `model/scam_model.pkl` and `model/tfidf_vectorizer.pkl`
- Target: **F1 ≥ 0.90** on test set (SMS spam datasets typically achieve 0.95+)

**Verify model files exist:**
```powershell
python -c "import joblib; m=joblib.load('model/scam_model.pkl'); print('Model loaded:', type(m).__name__)"
```

---

### Test C: Flask API Server

**Terminal 1 — Start server:**
```powershell
python server/app.py
```
Expected: `Running on http://127.0.0.1:5000`

**Terminal 2 — Test with curl or Python:**
```powershell
# Test a scam message
curl -X POST http://localhost:5000/analyze -H "Content-Type: application/json" -d "{\"text\": \"Congratulations! You won a $1000 prize. Click this link to claim now!\"}"

# Expected: {"flagged": true, "confidence": >80, ...}

# Test a safe message
curl -X POST http://localhost:5000/analyze -H "Content-Type: application/json" -d "{\"text\": \"Hey, are we still meeting for coffee at 3pm?\"}"

# Expected: {"flagged": false, "confidence": <20, ...}
```

---

### Test D: Chrome Extension (Manual — requires your browser)

1. Open Chrome → `chrome://extensions/` → Enable Developer Mode
2. Click "Load unpacked" → select `ScamSense-main/` folder
3. Make sure Flask server is running (`python server/app.py`)
4. Open `https://web.whatsapp.com/` and log in
5. **Test real-time detection:**
   - Have a friend send you a message like: *"URGENT: Your bank account has been locked. Send OTP to unlock."*
   - A red warning banner should appear at the top of WhatsApp Web
6. **Test manual paste in popup:**
   - Click the ScamSense extension icon
   - Paste: *"You've been selected for a cash prize of ₹50,000. Click here to claim."*
   - Click "⚡ Analyze Transcript"
   - Should show 🚨 SCAM DETECTED with confidence > 80%
7. **Test safe message in popup:**
   - Paste: *"Can you pick up milk on the way home?"*
   - Should show ✅ No scam detected

---

### Test E: Model Evaluation on Separate Test Data

```powershell
python -c "
import joblib, pandas as pd
from sklearn.metrics import classification_report, confusion_matrix

model = joblib.load('model/scam_model.pkl')
vectorizer = joblib.load('model/tfidf_vectorizer.pkl')
test = pd.read_csv('data/test.csv')

X_test = vectorizer.transform(test['text'])
y_pred = model.predict(X_test)

print('=== Classification Report ===')
print(classification_report(test['label'], y_pred, target_names=['Safe', 'Scam']))
print('=== Confusion Matrix ===')
print(confusion_matrix(test['label'], y_pred))
"
```

**This proves the model was trained and tested on separate data** (hackathon requirement).

---

## Execution Order for the Agent

> [!IMPORTANT]
> Execute these steps in exact order. Do NOT skip ahead.

| Step | Action | Depends On |
|------|--------|-----------|
| 1 | Create `requirements.txt` | — |
| 2 | Create `data/raw/` folder, download/place UCI SMS dataset, create `data/prepare_data.py` | Step 1 |
| 3 | Run `data/prepare_data.py` to generate train/test CSVs | Step 2 |
| 4 | Create `model/train_model.py` | Step 2 |
| 5 | Run `model/train_model.py` — verify F1 ≥ 0.90 | Steps 3, 4 |
| 6 | Create `server/app.py` | Step 5 |
| 7 | Run `server/app.py` and test with curl | Step 6 |
| 8 | Modify [background.js](file:///c:/Users/Eshan/Downloads/ScamSense-main/ScamSense-main/background.js) — replace Gemini with local model call | Step 7 |
| 9 | Modify [manifest.json](file:///c:/Users/Eshan/Downloads/ScamSense-main/ScamSense-main/manifest.json) — update permissions | Step 8 |
| 10 | Modify [popup.html](file:///c:/Users/Eshan/Downloads/ScamSense-main/ScamSense-main/popup.html) — update footer text | Step 8 |
| 11 | Run Test E (model evaluation on test.csv) to prove train/test separation | Step 5 |
| 12 | Manual browser test (Test D) — user loads extension and tests real-time detection | Steps 8-10 |

---

## Time Estimate

| Task | Time |
|------|------|
| Dataset prep + cleaning | ~15 min |
| Model training script | ~20 min |
| Flask server | ~15 min |
| Extension rewiring | ~15 min |
| Testing & debugging | ~20 min |
| **Total** | **~1.5 hours** |
