import joblib
import pandas as pd
from sklearn.metrics import classification_report, confusion_matrix, accuracy_score

model      = joblib.load('model/scam_model.pkl')
vectorizer = joblib.load('model/tfidf_vectorizer.pkl')

test_df = pd.read_csv('data/test.csv')
X_test  = vectorizer.transform(test_df['text'])
y_test  = test_df['label']
y_pred  = model.predict(X_test)

total   = len(y_test)
correct = int((y_pred == y_test).sum())
acc     = accuracy_score(y_test, y_pred) * 100

report = classification_report(y_test, y_pred, target_names=['Safe', 'Scam'])
cm     = confusion_matrix(y_test, y_pred)

fp_mask = (y_pred == 1) & (y_test == 0)
fn_mask = (y_pred == 0) & (y_test == 1)
fp_examples = test_df[fp_mask]['text'].head(5).tolist()
fn_examples = test_df[fn_mask]['text'].head(5).tolist()

lines = []
lines.append("=== ScamSense Model Evaluation Report ===")
lines.append(f"Model: {type(model).__name__}")
lines.append(f"Test set: data/test.csv ({total} samples)")
lines.append("")
lines.append("--- Classification Report ---")
lines.append(report)
lines.append("--- Confusion Matrix ---")
lines.append("         Predicted Safe  Predicted Scam")
lines.append(f"Actual Safe     {cm[0][0]:>8}        {cm[0][1]:>8}")
lines.append(f"Actual Scam     {cm[1][0]:>8}        {cm[1][1]:>8}")
lines.append("")
lines.append(f"Total samples: {total}")
lines.append(f"Correct:       {correct}")
lines.append(f"Accuracy:      {acc:.2f}%")
lines.append("")

if fp_examples:
    lines.append("--- False Positives (safe flagged as scam) ---")
    for i, t in enumerate(fp_examples, 1):
        lines.append(f"  {i}. {t}")
else:
    lines.append("--- False Positives: none ---")
lines.append("")

if fn_examples:
    lines.append("--- False Negatives (scam missed) ---")
    for i, t in enumerate(fn_examples, 1):
        lines.append(f"  {i}. {t}")
else:
    lines.append("--- False Negatives: none ---")

output = "\n".join(lines)
print(output)

with open('model/evaluation_report.txt', 'w', encoding='utf-8') as f:
    f.write(output)
print("\nSaved: model/evaluation_report.txt")
