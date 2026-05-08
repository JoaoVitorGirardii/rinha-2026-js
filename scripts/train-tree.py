#!/usr/bin/env python3
"""
Treinamento de Decision Tree para detecção de fraude.
Lê references.json (vetores pré-computados), treina CART via sklearn
e serializa a árvore para model-tree.json consumido pelo service.tree.js.
"""

import json
import sys
import time
import numpy as np
from sklearn.tree import DecisionTreeClassifier
from sklearn.model_selection import train_test_split

REFERENCES_PATH = 'references.json'
OUTPUT_PATH = 'model-tree.json'
MAX_SAMPLES = 300_000   # subsample estratificado
MAX_DEPTH = 15          # ~32k folhas máx; na prática min_samples_leaf limita
MIN_SAMPLES_LEAF = 100  # evita overfitting


def load_data(path, max_samples):
    print(f'Carregando {path}...')
    t0 = time.time()
    with open(path) as f:
        entries = json.load(f)
    print(f'  {len(entries):,} registros carregados em {time.time()-t0:.1f}s')

    X, y = [], []
    for e in entries:
        X.append(e['vector'])
        y.append(1 if e['label'] == 'fraud' else 0)

    X = np.array(X, dtype=np.float32)
    y = np.array(y, dtype=np.int8)

    fraud_idx = np.where(y == 1)[0]
    legit_idx = np.where(y == 0)[0]
    print(f'  fraudes: {len(fraud_idx):,} | legítimas: {len(legit_idx):,}')

    # subsample estratificado mantendo proporção original
    n_fraud = min(len(fraud_idx), int(max_samples * len(fraud_idx) / len(y)))
    n_legit = min(len(legit_idx), max_samples - n_fraud)

    rng = np.random.default_rng(42)
    chosen = np.concatenate([
        rng.choice(fraud_idx, n_fraud, replace=False),
        rng.choice(legit_idx, n_legit, replace=False),
    ])
    rng.shuffle(chosen)

    X, y = X[chosen], y[chosen]
    print(f'  subamostrado para {len(X):,} registros '
          f'({(y==1).sum():,} fraudes, {(y==0).sum():,} legítimas)')
    return X, y


def train(X, y):
    X_train, X_val, y_train, y_val = train_test_split(
        X, y, test_size=0.1, random_state=42, stratify=y
    )

    print(f'\nTreinando DecisionTree (max_depth={MAX_DEPTH}, '
          f'min_samples_leaf={MIN_SAMPLES_LEAF})...')
    t0 = time.time()
    clf = DecisionTreeClassifier(
        max_depth=MAX_DEPTH,
        min_samples_leaf=MIN_SAMPLES_LEAF,
        class_weight='balanced',
        criterion='gini',
        random_state=42,
    )
    clf.fit(X_train, y_train)
    print(f'  treinado em {time.time()-t0:.1f}s')
    print(f'  nós na árvore: {clf.tree_.node_count:,}')

    y_pred = clf.predict(X_val)
    tp = int(((y_pred == 1) & (y_val == 1)).sum())
    tn = int(((y_pred == 0) & (y_val == 0)).sum())
    fp = int(((y_pred == 1) & (y_val == 0)).sum())
    fn = int(((y_pred == 0) & (y_val == 1)).sum())
    total = len(y_val)
    failure = (fp + fn) / total
    print(f'\nValidação (10% holdout):')
    print(f'  TP={tp:,} TN={tn:,} FP={fp:,} FN={fn:,}')
    print(f'  failure_rate={failure:.4%}')
    return clf


def export_tree(clf, path):
    tree = clf.tree_
    n = tree.node_count
    feat = tree.feature          # -2 = folha
    thresh = tree.threshold
    left = tree.children_left    # -1 = folha
    right = tree.children_right

    # Para folhas: majority class → 0 (legítima) ou 5 (fraude/5 votos)
    values_raw = tree.value  # shape (n_nodes, 1, n_classes): [n_legit, n_fraud]
    leaf_values = []
    for i in range(n):
        if left[i] == -1:  # é folha
            n_legit = values_raw[i][0][0]
            n_fraud = values_raw[i][0][1]
            leaf_values.append(5 if n_fraud > n_legit else 0)
        else:
            leaf_values.append(-1)

    model = {
        'n_nodes': n,
        'features':   feat.tolist(),
        'thresholds': [round(float(t), 6) for t in thresh],
        'lefts':      left.tolist(),
        'rights':     right.tolist(),
        'values':     leaf_values,  # -1 para nós internos, 0 ou 5 para folhas
    }

    with open(path, 'w') as f:
        json.dump(model, f, separators=(',', ':'))

    size_kb = len(json.dumps(model, separators=(',', ':')).encode()) / 1024
    print(f'\nModelo exportado → {path} ({size_kb:.1f} KB, {n} nós)')


def main():
    X, y = load_data(REFERENCES_PATH, MAX_SAMPLES)
    clf = train(X, y)
    export_tree(clf, OUTPUT_PATH)
    print('\nConcluído.')


if __name__ == '__main__':
    main()
