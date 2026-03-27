import os
import re
import joblib
import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
model      = joblib.load(os.path.join(BASE_DIR, 'model', 'scam_model.pkl'))
vectorizer = joblib.load(os.path.join(BASE_DIR, 'model', 'tfidf_vectorizer.pkl'))


# Indian-specific scam keyword patterns not well-covered by the UCI training data
# Each entry: (list of regex patterns, scamType)
INDIAN_SCAM_PATTERNS = [
    # Impersonation: government/law enforcement (use word boundaries for short tokens)
    ([r'\bcbi\b', r'\baadhaar\b', r'\baadhar\b', r'\bnarcotics\b', r'\benforcement directorate\b'], 'impersonation'),
    ([r'\bpolice\b', r'\bsummons\b', r'\bwarrant\b'], 'impersonation'),
    # Phishing: financial fraud
    ([r'\bupi\b', r'\botp\b', r'\bkyc\b', r'\bpan card\b'], 'phishing'),
    ([r'\bneft\b', r'\bimps\b', r'\brtgs\b', r'account blocked', r'account suspend'], 'phishing'),
    # Lottery / prize
    ([r'lucky draw', r'prize money', r'cash prize', r'\blottery\b'], 'lottery'),
]

def indian_keyword_check(text):
    """Returns (True, scamType) if Indian-specific scam keywords detected, else (None, None)."""
    t = text.lower()
    for patterns, scam_type in INDIAN_SCAM_PATTERNS:
        if any(re.search(p, t) for p in patterns):
            return True, scam_type
    return None, None


def get_scam_type(text, flagged):
    t = text.lower()
    if any(w in t for w in ['prize', 'lottery', 'winner', 'won', 'lucky draw']):
        return 'lottery'
    if any(w in t for w in ['bank', 'account', 'otp', 'upi', 'kyc', 'aadhar', 'aadhaar', 'pan']):
        return 'phishing'
    if any(w in t for w in ['police', 'arrest', 'cbi', 'court', 'ed ', 'narcotics']):
        return 'impersonation'
    if any(w in t for w in ['click', 'link', 'verify', 'update']):
        return 'phishing'
    return 'other' if flagged else 'none'


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'model': type(model).__name__})


@app.route('/analyze', methods=['POST'])
def analyze():
    data = request.get_json(silent=True)
    if not data or not isinstance(data.get('text'), str) or not data['text'].strip():
        return jsonify({'error': 'text field required and must be a non-empty string'}), 400

    text = data['text']
    vec  = vectorizer.transform([text])
    pred = int(model.predict(vec)[0])
    flagged = pred == 1

    if hasattr(model, 'predict_proba'):
        proba = model.predict_proba(vec)[0]
        confidence = int(round(max(proba) * 100))
    elif hasattr(model, 'decision_function'):
        score = model.decision_function(vec)[0]
        confidence = int(min(abs(float(score)) * 20, 100))
    else:
        confidence = 85 if flagged else 15

    # Hybrid: supplement ML model with Indian-specific keyword rules
    # (UCI training data lacks Indian scam vocabulary like CBI, Aadhaar, UPI, OTP)
    kw_flagged, kw_scam_type = indian_keyword_check(text)
    if kw_flagged and not flagged:
        flagged = True
        confidence = max(confidence, 80)

    scam_type = get_scam_type(text, flagged)

    if flagged:
        reason = f"{scam_type.capitalize()} scam pattern detected"
    else:
        reason = "No scam indicators found"

    return jsonify({
        'flagged':    flagged,
        'confidence': confidence,
        'reason':     reason,
        'scamType':   scam_type,
    })


if __name__ == '__main__':
    print(f"Model loaded: {type(model).__name__}")
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
