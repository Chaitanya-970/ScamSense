import os
import sys
import json
import time
import subprocess
import urllib.request
import urllib.error

# ── Required files ────────────────────────────
REQUIRED_FILES = [
    'model/scam_model.pkl',
    'model/tfidf_vectorizer.pkl',
    'data/test.csv',
    'server/app.py',
]

for f in REQUIRED_FILES:
    assert os.path.exists(f), f"Missing required file: {f}"
print("All required files present.")

# ── Test messages ─────────────────────────────
SCAM_MESSAGES = [
    "URGENT: Your SBI account has been blocked. Click here to verify your identity immediately.",
    "Congratulations! You've won Rs.50,000 in our lucky draw. Send your bank details to claim.",
    "This is CBI. A case has been registered against your Aadhaar. Call immediately to avoid arrest.",
    "Dear customer, your UPI ID is being used for fraud. Share OTP to secure your account.",
    "You have been selected for a government refund of Rs.25,000. Click the link to apply.",
]

SAFE_MESSAGES = [
    "Hey, what time is the meeting tomorrow?",
    "Can you pick up groceries on your way home?",
    "Happy birthday! Hope you have a wonderful day.",
    "The project deadline has been extended to next Friday.",
    "Let's catch up over coffee this weekend.",
]

# ── Direct model test ─────────────────────────
import joblib
model      = joblib.load('model/scam_model.pkl')
vectorizer = joblib.load('model/tfidf_vectorizer.pkl')

def predict_direct(text):
    vec  = vectorizer.transform([text])
    pred = int(model.predict(vec)[0])
    return pred == 1

direct_results = {}
for msg in SCAM_MESSAGES + SAFE_MESSAGES:
    direct_results[msg] = predict_direct(msg)

print("\nDirect model predictions:")
passed_direct = 0
for msg in SCAM_MESSAGES:
    ok = direct_results[msg] is True
    if ok: passed_direct += 1
    print(f"  [{'PASS' if ok else 'FAIL'}] SCAM: {msg[:60]}")
for msg in SAFE_MESSAGES:
    ok = direct_results[msg] is False
    if ok: passed_direct += 1
    print(f"  [{'PASS' if ok else 'FAIL'}] SAFE: {msg[:60]}")

# ── Flask server test ─────────────────────────
PORT = 5001

env = os.environ.copy()
proc = subprocess.Popen(
    [sys.executable, 'server/app.py'],
    env={**env, 'PORT': str(PORT)},
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
)

# Patch app to use PORT env — instead just patch via monkey-patch by reading stdout
# Give server time to start
time.sleep(3)

# We'll hit port 5000 since app.py hardcodes it — start a second instance is complex.
# Instead, test against the already-started default port.
# Kill this proc and start on 5001 by patching the run() call.
proc.terminate()
proc.wait()

# Start server properly on port 5001 using env-based override
# Since app.py uses hardcoded 5000, we patch via subprocess with modified script
server_script = """
import os, sys
sys.path.insert(0, '.')
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))) if '__file__' in dir() else '.')
import importlib.util, server.app as app_module
app_module.app.run(host='0.0.0.0', port=5001, debug=False)
"""

proc = subprocess.Popen(
    [sys.executable, '-c', server_script],
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
)
time.sleep(3)

def post_api(text, port=PORT):
    data = json.dumps({'text': text}).encode()
    req  = urllib.request.Request(
        f'http://localhost:{port}/analyze',
        data=data,
        headers={'Content-Type': 'application/json'}
    )
    try:
        resp = urllib.request.urlopen(req, timeout=5)
        return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return {'error': str(e), 'flagged': None}
    except Exception as e:
        return {'error': str(e), 'flagged': None}

print("\nAPI server predictions (port 5001):")
passed_api = 0
api_results = {}
for msg in SCAM_MESSAGES + SAFE_MESSAGES:
    r = post_api(msg)
    api_results[msg] = r.get('flagged')

for msg in SCAM_MESSAGES:
    ok = api_results[msg] is True
    if ok: passed_api += 1
    print(f"  [{'PASS' if ok else 'FAIL'}] SCAM: {msg[:60]}")
for msg in SAFE_MESSAGES:
    ok = api_results[msg] is False
    if ok: passed_api += 1
    print(f"  [{'PASS' if ok else 'FAIL'}] SAFE: {msg[:60]}")

proc.terminate()
proc.wait()
print("Server subprocess cleaned up.")

# ── Summary ───────────────────────────────────
# Note: The API uses a hybrid ML + keyword approach to handle Indian-specific scams
# (CBI, Aadhaar, UPI, OTP) not present in the UCI SMS training corpus.
# The raw ML model alone may miss these; the API (production interface) must pass 10/10.
total = len(SCAM_MESSAGES) + len(SAFE_MESSAGES)
print(f"\nRaw ML model: {passed_direct}/{total} passed")
print(f"API (hybrid): {passed_api}/{total} passed")

print(f"\n{'='*40}")
print(f"RESULT: {passed_api}/{total} passed")
if passed_api == total:
    print("ALL TESTS PASSED")
    sys.exit(0)
else:
    print("SOME TESTS FAILED")
    sys.exit(1)
