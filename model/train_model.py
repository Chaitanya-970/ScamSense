import pandas as pd
import joblib
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.svm import LinearSVC
from sklearn.metrics import classification_report, confusion_matrix, f1_score
from xgboost import XGBClassifier

train_df = pd.read_csv('data/train.csv')
test_df  = pd.read_csv('data/test.csv')

X_train, y_train = train_df['text'], train_df['label']
X_test,  y_test  = test_df['text'],  test_df['label']

vectorizer = TfidfVectorizer(max_features=5000, ngram_range=(1, 2), stop_words='english')
X_train_vec = vectorizer.fit_transform(X_train)
X_test_vec  = vectorizer.transform(X_test)

models = {
    'LinearSVC': LinearSVC(C=1.0, max_iter=10000),
    'XGBClassifier': XGBClassifier(n_estimators=100, max_depth=6, eval_metric='logloss', use_label_encoder=False, verbosity=0),
}

results = {}
for name, model in models.items():
    print(f"\n{'='*50}")
    print(f"Training {name}...")
    model.fit(X_train_vec, y_train)
    y_pred = model.predict(X_test_vec)
    f1 = f1_score(y_test, y_pred)
    results[name] = {'model': model, 'f1': f1, 'y_pred': y_pred}
    print(f"\n--- {name} ---")
    print(classification_report(y_test, y_pred, target_names=['Safe', 'Scam']))
    print("Confusion Matrix:")
    print(confusion_matrix(y_test, y_pred))

print(f"\n{'='*50}")
print(f"{'Model':<20} {'Accuracy':>10} {'F1 (Scam)':>12} {'Precision':>12} {'Recall':>10}")
print('-' * 66)
for name, r in results.items():
    from sklearn.metrics import accuracy_score, precision_score, recall_score
    y_pred = r['y_pred']
    acc  = accuracy_score(y_test, y_pred)
    prec = precision_score(y_test, y_pred)
    rec  = recall_score(y_test, y_pred)
    print(f"{name:<20} {acc:>10.4f} {r['f1']:>12.4f} {prec:>12.4f} {rec:>10.4f}")

winner_name = max(results, key=lambda k: results[k]['f1'])
winner_model = results[winner_name]['model']
print(f"\nWinner: {winner_name} (F1={results[winner_name]['f1']:.4f})")

joblib.dump(winner_model, 'model/scam_model.pkl')
joblib.dump(vectorizer,   'model/tfidf_vectorizer.pkl')
print("Saved: model/scam_model.pkl and model/tfidf_vectorizer.pkl")
