#!/usr/bin/env python3
"""
Treinamento de Random Forest para detecção de fraude.
Lê references.json (vetores pré-computados), treina ensemble via sklearn
e serializa TODAS as árvores para model-tree.json.

Mudança v3 (tentativa-07):
  - MAX_SAMPLES: 300k → 2M (melhor calibração, mais cobertura de edge cases)
  - Modelo: Decision Tree → Random Forest (50 árvores, max_depth=12)
  - Export: N árvores com probabilidades por folha + threshold otimizado
  - Threshold: otimizado no validation split para minimizar FP + 3×FN
"""

import json
import sys
import time
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split

REFERENCES_PATH = 'references.json'
OUTPUT_PATH = 'model-tree.json'
MAX_SAMPLES = 2_000_000   # 2M → probabilidades mais estáveis
N_ESTIMATORS = 50         # 50 árvores; 600 comparações/request = ~1μs
MAX_DEPTH = 12            # ligeiramente menor (mais regularização no ensemble)
MIN_SAMPLES_LEAF = 200    # maior para RF (evita overfitting no ensemble)
TARGET_FRAUD_RATE = 0.4


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

    # Alinhar distribuição de treino com o conjunto de teste (44.47% fraude)
    # Isso calibra as probabilidades das folhas para o contexto real do teste
    n_fraud = min(len(fraud_idx), int(max_samples * TARGET_FRAUD_RATE))
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


def find_optimal_threshold(probs_val, y_val):
    """Busca threshold que minimiza FP + 3*FN (pesos da competição)."""
    best_thresh = 0.5
    best_cost = float('inf')
    results = []

    for thresh in np.arange(0.05, 0.96, 0.01):
        preds = (probs_val >= thresh).astype(int)
        fp = int(((preds == 1) & (y_val == 0)).sum())
        fn = int(((preds == 0) & (y_val == 1)).sum())
        cost = fp + 3 * fn
        results.append((thresh, fp, fn, cost))
        if cost < best_cost:
            best_cost = cost
            best_thresh = thresh

    print(f'\nOtimização de threshold (val size={len(y_val):,}):')
    print(f'  {"Thresh":>6}  {"FP":>8}  {"FN":>8}  {"Cost(FP+3FN)":>14}')
    shown = set()
    for t in [0.20, 0.25, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80]:
        r = next((r for r in results if abs(r[0] - t) < 0.005), None)
        if r:
            marker = ' ◄ BEST' if abs(r[0] - best_thresh) < 0.005 else ''
            print(f'  {r[0]:6.2f}  {r[1]:8,}  {r[2]:8,}  {r[3]:14,}{marker}')
            shown.add(round(t, 2))
    # mostra best se não foi mostrado acima
    if round(best_thresh, 2) not in shown:
        r = next((r for r in results if abs(r[0] - best_thresh) < 0.005), None)
        if r:
            print(f'  {r[0]:6.2f}  {r[1]:8,}  {r[2]:8,}  {r[3]:14,} ◄ BEST')

    print(f'\n  → Threshold ótimo: {best_thresh:.2f} (custo={best_cost:,})')
    return float(best_thresh)


def train(X, y):
    X_train, X_val, y_train, y_val = train_test_split(
        X, y, test_size=0.1, random_state=42, stratify=y
    )

    print(f'\nTreinando RandomForest (n_estimators={N_ESTIMATORS}, '
          f'max_depth={MAX_DEPTH}, min_samples_leaf={MIN_SAMPLES_LEAF})...')
    t0 = time.time()
    clf = RandomForestClassifier(
        n_estimators=N_ESTIMATORS,
        max_depth=MAX_DEPTH,
        min_samples_leaf=MIN_SAMPLES_LEAF,
        max_features='sqrt',
        class_weight=None,    # distribuição já alinhada com teste → sem weighting
        n_jobs=-1,
        random_state=42,
    )
    clf.fit(X_train, y_train)
    elapsed = time.time() - t0
    print(f'  treinado em {elapsed:.1f}s')

    node_counts = [est.tree_.node_count for est in clf.estimators_]
    print(f'  nós por árvore: min={min(node_counts)}, '
          f'max={max(node_counts)}, avg={sum(node_counts)/len(node_counts):.0f}')
    print(f'  total de nós: {sum(node_counts):,}')

    # Avaliação com majority vote do RF (threshold=0.5)
    y_pred_default = clf.predict(X_val)
    tp = int(((y_pred_default == 1) & (y_val == 1)).sum())
    tn = int(((y_pred_default == 0) & (y_val == 0)).sum())
    fp = int(((y_pred_default == 1) & (y_val == 0)).sum())
    fn = int(((y_pred_default == 0) & (y_val == 1)).sum())
    print(f'\nValidação com threshold=0.5 (majority vote):')
    print(f'  TP={tp:,} TN={tn:,} FP={fp:,} FN={fn:,}')
    print(f'  custo={fp + 3*fn:,} | failure_rate={((fp+fn)/len(y_val)):.4%}')

    # Otimização de threshold com probabilidades
    probs_val = clf.predict_proba(X_val)[:, 1]
    threshold = find_optimal_threshold(probs_val, y_val)

    return clf, threshold


def export_tree_single(estimator):
    """Serializa uma árvore do RF para dict."""
    tree = estimator.tree_
    n = tree.node_count
    feat = tree.feature
    thresh = tree.threshold
    left = tree.children_left
    right = tree.children_right
    values_raw = tree.value  # shape (n_nodes, 1, n_classes)

    probs = []
    for i in range(n):
        if left[i] == -1:  # folha
            n_legit = float(values_raw[i][0][0])
            n_fraud = float(values_raw[i][0][1])
            total = n_legit + n_fraud
            probs.append(round(n_fraud / total if total > 0 else 0.0, 6))
        else:
            probs.append(-1.0)

    return {
        'n_nodes':    n,
        'features':   feat.tolist(),
        'thresholds': [round(float(t), 6) for t in thresh],
        'lefts':      left.tolist(),
        'rights':     right.tolist(),
        'probs':      probs,
    }


def export_forest(clf, path, threshold):
    print(f'\nExportando {len(clf.estimators_)} árvores...')
    t0 = time.time()
    trees = [export_tree_single(est) for est in clf.estimators_]

    model = {
        'n_trees':   len(trees),
        'threshold': round(threshold, 4),
        'trees':     trees,
    }

    with open(path, 'w') as f:
        json.dump(model, f, separators=(',', ':'))

    size_kb = len(json.dumps(model, separators=(',', ':')).encode()) / 1024
    total_nodes = sum(t['n_nodes'] for t in trees)
    print(f'  exportado em {time.time()-t0:.1f}s')
    print(f'\nModelo exportado → {path}')
    print(f'  {len(trees)} árvores | {total_nodes:,} nós totais | {size_kb:.1f} KB | threshold={threshold:.4f}')


def main():
    X, y = load_data(REFERENCES_PATH, MAX_SAMPLES)
    clf, threshold = train(X, y)
    export_forest(clf, OUTPUT_PATH, threshold)
    print('\nConcluído.')


if __name__ == '__main__':
    main()
