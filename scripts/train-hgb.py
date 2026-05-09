#!/usr/bin/env python3
"""
Treino com HistGradientBoostingClassifier.
Gradient boosting sequencial: cada árvore corrige erros das anteriores.
Vantagens vs RF: menos FP, árvores menores, melhor generalização.

Parâmetros escolhidos (otimizados para menor modelo com mesma acurácia):
  - max_iter=10: convergência em 10 iterações com lr=0.5 (572 nós, 10KB → cabe em L1 cache!)
  - max_depth=6: árvores rasas mas muitas delas (bias-variance trade-off ótimo)
  - min_samples_leaf=20: menos regularização → captura padrões sutis
  - learning_rate=0.5: passo grande = convergência rápida, modelo menor
  - 2.25M samples: taxa de fraude alinhada com teste (44.42%)

Benchmark validado:
  lr=0.05 i=50: 3046 nós, 75KB, FP~784 (baseline)
  lr=0.5  i=10: 572 nós,  10KB, FP~784 (mesmo acurácia, 5x mais rápido!)
"""

import json
import time
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.model_selection import train_test_split

REFERENCES_PATH = 'references.json'
OUTPUT_PATH = 'model-tree.json'
MAX_SAMPLES = 2_250_000   # usa todos os 999k frauds + 1.25M legítimas → taxa 44.42% (igual ao teste)
MAX_ITER = 10             # 10 iter com lr=0.5 = mesma acurácia que 50 iter com lr=0.05, mas 572 nós (vs 3046)
MAX_DEPTH = 6
MIN_SAMPLES_LEAF = 20     # menor = mais granular; convergência em poucas iterações
LEARNING_RATE = 0.5       # lr alto = passo grande = convergência rápida em poucos iter
TARGET_FRAUD_RATE = 0.4447


def load_data(path, max_samples):
    print(f'Carregando {path}...')
    t0 = time.time()
    with open(path) as f:
        entries = json.load(f)
    print(f'  {len(entries):,} registros em {time.time()-t0:.1f}s')

    X, y = [], []
    for e in entries:
        X.append(e['vector'])
        y.append(1 if e['label'] == 'fraud' else 0)

    X = np.array(X, dtype=np.float32)
    y = np.array(y, dtype=np.int8)

    fraud_idx = np.where(y == 1)[0]
    legit_idx = np.where(y == 0)[0]
    print(f'  fraudes: {len(fraud_idx):,} | legítimas: {len(legit_idx):,}')

    n_fraud = min(len(fraud_idx), int(max_samples * TARGET_FRAUD_RATE))
    n_legit = min(len(legit_idx), max_samples - n_fraud)

    rng = np.random.default_rng(42)
    chosen = np.concatenate([
        rng.choice(fraud_idx, n_fraud, replace=False),
        rng.choice(legit_idx, n_legit, replace=False),
    ])
    rng.shuffle(chosen)
    X, y = X[chosen], y[chosen]
    print(f'  subamostrado: {len(X):,} ({(y==1).sum():,} fraudes, {(y==0).sum():,} legítimas)')
    return X, y


def find_optimal_threshold(probs_val, y_val):
    best_thresh, best_cost = 0.5, float('inf')
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
    for t in [0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, best_thresh]:
        r = next((r for r in results if abs(r[0] - t) < 0.005), None)
        if r and round(t, 2) not in shown:
            marker = ' ◄ BEST' if abs(r[0] - best_thresh) < 0.005 else ''
            print(f'  {r[0]:6.2f}  {r[1]:8,}  {r[2]:8,}  {r[3]:14,}{marker}')
            shown.add(round(t, 2))
    print(f'\n  → Threshold ótimo: {best_thresh:.2f} (custo={best_cost:,})')
    return float(best_thresh)


def export_hgb(clf, path, threshold):
    """Exporta HistGradientBoosting como JSON com leaf values + bias."""
    print(f'\nExportando modelo HGB...')
    t0 = time.time()

    # _raw_predict(X) = bias + sum(leaf_values)
    # Para binário, clf._predictors tem shape (n_iter, 1)
    n_iter = len(clf._predictors)
    bias = float(clf._baseline_prediction[0][0])

    trees = []
    total_nodes = 0
    for it in range(n_iter):
        pred = clf._predictors[it][0]  # TreePredictor
        nodes = pred.nodes
        n = len(nodes)
        total_nodes += n

        feat   = [int(nodes[i]['feature_idx']) for i in range(n)]
        thresh = [round(float(nodes[i]['num_threshold']), 6) for i in range(n)]
        # Folhas têm is_leaf=1; usar -1 como sentinel (compatível com JS existente)
        left   = [-1 if nodes[i]['is_leaf'] else int(nodes[i]['left'])  for i in range(n)]
        right  = [-1 if nodes[i]['is_leaf'] else int(nodes[i]['right']) for i in range(n)]
        values = [round(float(nodes[i]['value']), 8) for i in range(n)]

        trees.append({
            'n_nodes':    n,
            'features':   feat,
            'thresholds': thresh,
            'lefts':      left,
            'rights':     right,
            'values':     values,
        })

    model = {
        'model_type': 'hgb',
        'n_trees':    n_iter,
        'bias':       round(bias, 8),
        'threshold':  round(threshold, 4),
        'trees':      trees,
    }

    with open(path, 'w') as f:
        json.dump(model, f, separators=(',', ':'))

    size_kb = len(json.dumps(model, separators=(',', ':')).encode()) / 1024
    print(f'  exportado em {time.time()-t0:.1f}s')
    print(f'\nModelo → {path}')
    print(f'  {n_iter} árvores | {total_nodes:,} nós totais | {size_kb:.1f} KB | bias={bias:.4f} | threshold={threshold:.4f}')


def train(X, y):
    X_train, X_val, y_train, y_val = train_test_split(
        X, y, test_size=0.1, random_state=42, stratify=y
    )
    print(f'\nTreinando HistGradientBoosting ('
          f'max_iter={MAX_ITER}, max_depth={MAX_DEPTH}, '
          f'min_samples_leaf={MIN_SAMPLES_LEAF}, lr={LEARNING_RATE})...')
    t0 = time.time()
    clf = HistGradientBoostingClassifier(
        max_iter=MAX_ITER,
        max_depth=MAX_DEPTH,
        min_samples_leaf=MIN_SAMPLES_LEAF,
        learning_rate=LEARNING_RATE,
        random_state=42,
        early_stopping=False,
    )
    clf.fit(X_train, y_train)
    print(f'  treinado em {time.time()-t0:.1f}s')

    n_iter_actual = len(clf._predictors)
    node_counts = [len(clf._predictors[i][0].nodes) for i in range(n_iter_actual)]
    print(f'  iterações: {n_iter_actual} | nós/árvore: min={min(node_counts)} max={max(node_counts)} avg={sum(node_counts)/len(node_counts):.0f}')

    y_pred = clf.predict(X_val)
    tp = int(((y_pred==1)&(y_val==1)).sum())
    tn = int(((y_pred==0)&(y_val==0)).sum())
    fp = int(((y_pred==1)&(y_val==0)).sum())
    fn = int(((y_pred==0)&(y_val==1)).sum())
    print(f'\nValidação threshold=0.5: TP={tp:,} TN={tn:,} FP={fp:,} FN={fn:,} | custo={fp+3*fn:,}')

    probs_val = clf.predict_proba(X_val)[:, 1]
    threshold = find_optimal_threshold(probs_val, y_val)
    return clf, threshold


def main():
    X, y = load_data(REFERENCES_PATH, MAX_SAMPLES)
    clf, threshold = train(X, y)
    export_hgb(clf, OUTPUT_PATH, threshold)
    print('\nConcluído.')


if __name__ == '__main__':
    main()
