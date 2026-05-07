import KNN from 'ml-knn';
import modelData from '../model.json' with { type: 'json' };

const knn = KNN.load(modelData);

export function knnScoreService(vector, k = 5) {
  const neighbors = knn.kdTree.nearest(vector, k);
  const lastIdx = neighbors[0][0].length - 1;
  const fraudCount = neighbors.filter(([point]) => point[lastIdx] === 'fraud').length;
  const fraud_score = parseFloat((fraudCount / k).toFixed(4));
  const approved = fraud_score < 0.5;
  return { fraud_score, approved };
}
