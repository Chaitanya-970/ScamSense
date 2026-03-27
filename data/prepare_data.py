import re
import pandas as pd
from sklearn.model_selection import train_test_split

RAW_PATH = 'data/raw/SMSSpamCollection'

def clean_text(text):
    text = text.lower()
    text = re.sub(r'http\S+', '', text)
    text = re.sub(r'\b\d{10,}\b', '', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text

df = pd.read_csv(RAW_PATH, sep='\t', header=None, names=['label_str', 'text'], encoding='utf-8')

df['label'] = df['label_str'].map({'ham': 0, 'spam': 1})
df['text'] = df['text'].apply(clean_text)
df = df[['text', 'label']]

train_df, test_df = train_test_split(df, test_size=0.2, stratify=df['label'], random_state=42)

train_df.to_csv('data/train.csv', index=False)
test_df.to_csv('data/test.csv', index=False)

print(f"Total:  {len(df)}")
print(f"Train:  {len(train_df)}")
print(f"Test:   {len(test_df)}")
print("\nTrain class distribution:")
print(train_df['label'].value_counts().to_dict())
print("\nTest class distribution:")
print(test_df['label'].value_counts().to_dict())
