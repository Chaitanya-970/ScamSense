# ScamSense — Engineering Tasks

> 8 tasks, execute in order. Each is independently testable. Copy-paste each task into Claude Code one at a time.

---

## Task 1 · Project Setup & Dependencies

**Files:** `requirements.txt` [NEW], `data/raw/` [NEW DIR]

**Instructions:**
1. Create `requirements.txt` in the project root with:
   ```
   pandas
   scikit-learn
   xgboost
   joblib
   flask
   flask-cors
   ```
2. Create the directories `data/raw/` and `model/` and `server/`
3. Download the **UCI SMS Spam Collection** dataset from `https://archive.ics.uci.edu/ml/machine-learning-databases/00228/smsspamcollection.zip`, unzip it, and place the `SMSSpamCollection` file inside `data/raw/`
4. Run `pip install -r requirements.txt`

**Acceptance Criteria:**
- [ ] `requirements.txt` exists at project root
- [ ] `data/raw/SMSSpamCollection` file exists and contains 5,574 lines
- [ ] `pip install -r requirements.txt` completes with no errors
- [ ] `python -c "import pandas, sklearn, xgboost, flask; print('OK')"` prints `OK`

---

## Task 2 · Dataset Preparation Script

**Files:** `data/prepare_data.py` [NEW]

**Instructions:**
Create `data/prepare_data.py` that:
1. Reads `data/raw/SMSSpamCollection` (tab-separated, no header, columns: `label_str`, `text`)
2. Maps labels: `ham` → 0, `spam` → 1
3. Cleans text: lowercase, strip URLs (`http\S+`), strip phone numbers (`\b\d{10,}\b`), collapse whitespace
4. Splits 80/20 stratified by label using `sklearn.model_selection.train_test_split` with `random_state=42`
5. Saves `data/train.csv` and `data/test.csv` with columns `text,label`
6. Prints: total count, train count, test count, class distribution for each split

**Acceptance Criteria:**
- [ ] Running `python data/prepare_data.py` produces no errors
- [ ] `data/train.csv` exists with ~4,459 rows (80% of 5,574)
- [ ] `data/test.csv` exists with ~1,115 rows (20% of 5,574)
- [ ] Both CSVs have exactly 2 columns: `text`, `label`
- [ ] Verify with: `python -c "import pandas as pd; df=pd.read_csv('data/test.csv'); print(df.shape); print(df['label'].value_counts())"`
- [ ] Class distribution is approximately 87% label=0 (safe), 13% label=1 (scam) in both splits

---

## Task 3 · Model Training Script

**Files:** `model/train_model.py` [NEW]

**Instructions:**
Create `model/train_model.py` that:
1. Loads `data/train.csv` and `data/test.csv`
2. Fits a `TfidfVectorizer(max_features=5000, ngram_range=(1,2), stop_words='english')` on training text
3. Transforms both train and test text
4. Trains **two models**:
   - `sklearn.svm.LinearSVC(C=1.0, max_iter=10000)` 
   - `xgboost.XGBClassifier(n_estimators=100, max_depth=6, eval_metric='logloss', use_label_encoder=False)`
5. Evaluates both on test set — prints `classification_report` and `confusion_matrix` for each
6. Prints a comparison table: `| Model | Accuracy | F1 (Scam) | Precision | Recall |`
7. Picks the model with the **higher F1 score on the scam class** as the winner
8. Saves the winning model as `model/scam_model.pkl` and the vectorizer as `model/tfidf_vectorizer.pkl` using `joblib.dump()`

**Acceptance Criteria:**
- [ ] Running `python model/train_model.py` completes with no errors
- [ ] Console output shows classification report for both LinearSVC and XGBClassifier
- [ ] Console output shows which model won and why
- [ ] F1 score for the scam class ≥ 0.90 for at least one model
- [ ] `model/scam_model.pkl` file exists (size > 10KB)
- [ ] `model/tfidf_vectorizer.pkl` file exists (size > 100KB)
- [ ] Verify: `python -c "import joblib; m=joblib.load('model/scam_model.pkl'); print('Loaded:', type(m).__name__)"`

---

## Task 4 · Flask API Server

**Files:** `server/app.py` [NEW]

**Instructions:**
Create `server/app.py` that:
1. On startup, loads `model/scam_model.pkl` and `model/tfidf_vectorizer.pkl` using `joblib.load()`
2. Uses `flask-cors` to allow all origins (`CORS(app)`)
3. Exposes `POST /analyze` endpoint:
   - Accepts JSON body `{ "text": "..." }`
   - Validates that `text` is non-empty string, returns 400 if not
   - Transforms text with the loaded vectorizer
   - Predicts with the loaded model
   - For confidence: if model has `predict_proba`, use `max(proba) * 100`; if model has `decision_function`, use [min(abs(score) * 20, 100)](file:///c:/Users/Eshan/Downloads/ScamSense-main/ScamSense-main/background.js#46-119); otherwise confidence = 85 if flagged, 15 if not
   - Determines `scamType` using simple keyword matching on the input text:
     - Contains "prize/lottery/winner/won" → `"lottery"`
     - Contains "bank/account/otp/upi" → `"phishing"`
     - Contains "police/arrest/cbi/court" → `"impersonation"`
     - Contains "click/link/verify/update" → `"phishing"`
     - Else → `"other"` if flagged, `"none"` if safe
   - Returns JSON: `{ "flagged": bool, "confidence": int, "reason": str, "scamType": str }`
4. Exposes `GET /health` that returns `{ "status": "ok", "model": "<model class name>" }`
5. Runs on `0.0.0.0:5000` with `debug=False`

**Acceptance Criteria:**
- [ ] `python server/app.py` starts with no errors, prints "Running on http://0.0.0.0:5000"
- [ ] Health check works: `curl http://localhost:5000/health` returns `{"status":"ok",...}`
- [ ] Scam detection works:
  ```
  curl -X POST http://localhost:5000/analyze -H "Content-Type: application/json" -d "{\"text\":\"Congratulations! You won a $1000 prize. Click this link to claim now!\"}"
  ```
  Returns `flagged: true` with confidence > 50
- [ ] Safe message works:
  ```
  curl -X POST http://localhost:5000/analyze -H "Content-Type: application/json" -d "{\"text\":\"Hey are we still meeting for coffee at 3pm?\"}"
  ```
  Returns `flagged: false` with confidence < 50
- [ ] Empty text returns 400 error
- [ ] Stop the server after testing (Ctrl+C)

---

## Task 5 · Rewire [background.js](file:///c:/Users/Eshan/Downloads/ScamSense-main/ScamSense-main/background.js) to Use Local Model

**Files:** [background.js](file:///c:/Users/Eshan/Downloads/ScamSense-main/ScamSense-main/background.js) [MODIFY]

**Instructions:**
Modify [background.js](file:///c:/Users/Eshan/Downloads/ScamSense-main/ScamSense-main/background.js):
1. **Remove** the Gemini API constants: `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_URL`
2. **Remove** the [callGemini()](file:///c:/Users/Eshan/Downloads/ScamSense-main/ScamSense-main/background.js#46-119) function entirely
3. **Remove** the rate-limiting serializer (`apiQueue`, [enqueueApiCall](file:///c:/Users/Eshan/Downloads/ScamSense-main/ScamSense-main/background.js#20-32), `MIN_CALL_GAP_MS`, `MAX_RETRIES`, `BASE_DELAY_MS`)
4. **Add** a constant: `const API_URL = 'http://localhost:5000/analyze';`
5. **Add** a new function `callLocalModel(text)`:
   ```javascript
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
   ```
6. **Update** the `ANALYZE_MESSAGE` handler: replace [enqueueApiCall(() => callGemini(...))](file:///c:/Users/Eshan/Downloads/ScamSense-main/ScamSense-main/background.js#20-32) with `callLocalModel(msg.payload.text)`
7. Keep [sleep()](file:///c:/Users/Eshan/Downloads/ScamSense-main/ScamSense-main/background.js#120-124), [getStats()](file:///c:/Users/Eshan/Downloads/ScamSense-main/ScamSense-main/background.js#33-41), [saveStats()](file:///c:/Users/Eshan/Downloads/ScamSense-main/ScamSense-main/background.js#42-45), and all other message handlers (`GET_STATS`, `RESET_STATS`, `INCREMENT_SCANS`) unchanged

**Acceptance Criteria:**
- [ ] [background.js](file:///c:/Users/Eshan/Downloads/ScamSense-main/ScamSense-main/background.js) contains no references to `gemini`, `GEMINI`, or `generativelanguage.googleapis.com`
- [ ] [background.js](file:///c:/Users/Eshan/Downloads/ScamSense-main/ScamSense-main/background.js) contains `callLocalModel` function
- [ ] [background.js](file:///c:/Users/Eshan/Downloads/ScamSense-main/ScamSense-main/background.js) uses `http://localhost:5000/analyze`
- [ ] The `ANALYZE_MESSAGE` handler calls `callLocalModel` 
- [ ] [getStats](file:///c:/Users/Eshan/Downloads/ScamSense-main/ScamSense-main/background.js#33-41), [saveStats](file:///c:/Users/Eshan/Downloads/ScamSense-main/ScamSense-main/background.js#42-45), `GET_STATS`, `RESET_STATS` handlers are still intact

---

## Task 6 · Update [manifest.json](file:///c:/Users/Eshan/Downloads/ScamSense-main/ScamSense-main/manifest.json) and [popup.html](file:///c:/Users/Eshan/Downloads/ScamSense-main/ScamSense-main/popup.html)

**Files:** [manifest.json](file:///c:/Users/Eshan/Downloads/ScamSense-main/ScamSense-main/manifest.json) [MODIFY], [popup.html](file:///c:/Users/Eshan/Downloads/ScamSense-main/ScamSense-main/popup.html) [MODIFY]

**Instructions:**

In [manifest.json](file:///c:/Users/Eshan/Downloads/ScamSense-main/ScamSense-main/manifest.json):
1. In `host_permissions` array, replace `"https://generativelanguage.googleapis.com/*"` with `"http://localhost:5000/*"`
2. Keep the WhatsApp and Google Messages permissions unchanged

In [popup.html](file:///c:/Users/Eshan/Downloads/ScamSense-main/ScamSense-main/popup.html):
1. Change the footer text from `Powered by <strong>Gemini 2.0 Flash</strong> · ScamSense v1.0` to `Powered by <strong>ScamSense ML Engine</strong> · v1.0`

**Acceptance Criteria:**
- [ ] [manifest.json](file:///c:/Users/Eshan/Downloads/ScamSense-main/ScamSense-main/manifest.json) does NOT contain `generativelanguage.googleapis.com`
- [ ] [manifest.json](file:///c:/Users/Eshan/Downloads/ScamSense-main/ScamSense-main/manifest.json) contains `http://localhost:5000/*` in `host_permissions`
- [ ] [manifest.json](file:///c:/Users/Eshan/Downloads/ScamSense-main/ScamSense-main/manifest.json) is valid JSON (no syntax errors)
- [ ] [popup.html](file:///c:/Users/Eshan/Downloads/ScamSense-main/ScamSense-main/popup.html) footer says "ScamSense ML Engine" instead of "Gemini 2.0 Flash"
- [ ] Verify JSON: `python -c "import json; json.load(open('manifest.json')); print('Valid JSON')"`

---

## Task 7 · Model Evaluation Report (Proves Train/Test Separation)

**Files:** `model/evaluate.py` [NEW]

**Instructions:**
Create `model/evaluate.py` — a standalone script that:
1. Loads the saved model and vectorizer from `model/`
2. Loads `data/test.csv` (the held-out test set)
3. Runs predictions on the full test set
4. Prints:
   - Full `classification_report` with `target_names=['Safe', 'Scam']`
   - `confusion_matrix` with labels
   - Total test samples, total correct, accuracy percentage
   - 5 example false positives (safe messages flagged as scam) if any
   - 5 example false negatives (scam messages missed) if any
5. Saves results to `model/evaluation_report.txt`

**Acceptance Criteria:**
- [ ] Running `python model/evaluate.py` completes with no errors
- [ ] Console shows full classification report with precision/recall/F1 for both classes
- [ ] Console shows confusion matrix
- [ ] `model/evaluation_report.txt` is created and contains the same report
- [ ] Accuracy is ≥ 95% (typical for SMS spam datasets)
- [ ] This script uses `data/test.csv` which was NOT used during training (proves train/test separation)

---

## Task 8 · End-to-End Integration Test Script

**Files:** `tests/test_integration.py` [NEW]

**Instructions:**
Create `tests/test_integration.py` that:
1. Checks that all required files exist: `model/scam_model.pkl`, `model/tfidf_vectorizer.pkl`, `data/test.csv`, `server/app.py`
2. Loads model and vectorizer directly, runs 5 hardcoded scam messages and 5 hardcoded safe messages through the model, asserts correct predictions
3. Starts the Flask server as a subprocess on port 5001 (to avoid conflicts)
4. Sends HTTP requests to the running server with the same 10 test messages
5. Asserts that API responses match direct model predictions
6. Kills the server subprocess
7. Prints a final summary: `X/10 passed`

Test messages to use:
```
SCAM:
- "URGENT: Your SBI account has been blocked. Click here to verify your identity immediately."
- "Congratulations! You've won ₹50,000 in our lucky draw. Send your bank details to claim."
- "This is CBI. A case has been registered against your Aadhaar. Call immediately to avoid arrest."
- "Dear customer, your UPI ID is being used for fraud. Share OTP to secure your account."
- "You have been selected for a government refund of ₹25,000. Click the link to apply."

SAFE:
- "Hey, what time is the meeting tomorrow?"
- "Can you pick up groceries on your way home?"
- "Happy birthday! Hope you have a wonderful day."
- "The project deadline has been extended to next Friday."
- "Let's catch up over coffee this weekend."
```

**Acceptance Criteria:**
- [ ] Running `python tests/test_integration.py` completes with no errors
- [ ] All 5 scam messages are correctly flagged (`flagged: true`)
- [ ] All 5 safe messages are correctly marked safe (`flagged: false`)
- [ ] API responses match direct model predictions
- [ ] Final output: `10/10 passed`
- [ ] Server subprocess is properly cleaned up (no orphan process)
