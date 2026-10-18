"""Prediction-equivalent, memory-mapped storage for the published forests."""
from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import numpy as np
from numba import njit


@njit(cache=True)
def _predict(x, roots, left, right, features, thresholds, leaves):
    out = np.zeros((x.shape[0], leaves.shape[1]), dtype=np.float64)
    for i in range(x.shape[0]):
        for root in roots:
            node = root
            while node >= 0:
                node = left[node] if x[i, features[node]] <= thresholds[node] else right[node]
            for j in range(leaves.shape[1]):
                out[i, j] += leaves[-node - 1, j]
        for j in range(leaves.shape[1]):
            out[i, j] /= len(roots)
    return out


class CompactForest:
    """Read-only trees, shared safely when a boosting challenger is copied."""
    def __init__(self, folder):
        self.folder = Path(folder)
        self.manifest = json.loads((self.folder / 'forest.json').read_text())
        self._arrays = None

    def _load(self):
        if self._arrays is None:
            self._arrays = [np.load(self.folder / f'{name}.npy', mmap_mode='r')
                            for name in ['roots', 'left', 'right', 'features', 'thresholds', 'leaves']]
        return self._arrays

    def predict(self, x):
        return _predict(np.asarray(x, dtype=np.float32), *self._load())

    def __deepcopy__(self, memo):
        return self

    def __getstate__(self):
        return {'folder': self.folder, 'manifest': self.manifest, '_arrays': None}


def export_forest(model, folder):
    """Preserve every tree and every float64 leaf value; no model fitting."""
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    trees = model.estimators_
    n_inner = int(sum(np.count_nonzero(t.tree_.children_left >= 0) for t in trees))
    n_leaves = int(sum(np.count_nonzero(t.tree_.children_left < 0) for t in trees))
    outputs = trees[0].tree_.value.shape[1]
    shapes = {'roots': (len(trees),), 'left': (n_inner,), 'right': (n_inner,),
              'features': (n_inner,), 'thresholds': (n_inner,), 'leaves': (n_leaves, outputs)}
    dtypes = {'roots': '<i4', 'left': '<i4', 'right': '<i4', 'features': '<i2',
              'thresholds': '<f4', 'leaves': '<f8'}
    arrays = {k: np.lib.format.open_memmap(folder / f'{k}.npy', mode='w+', dtype=dtypes[k], shape=v)
              for k,v in shapes.items()}
    a = z = 0
    for index, estimator in enumerate(trees):
        tree = estimator.tree_
        inner = tree.children_left >= 0
        leaf = ~inner
        ni, nl = int(inner.sum()), int(leaf.sum())
        mapping = np.empty(tree.node_count, dtype=np.int32)
        mapping[inner] = np.arange(a, a + ni, dtype=np.int32)
        mapping[leaf] = -1 - np.arange(z, z + nl, dtype=np.int32)
        arrays['roots'][index] = mapping[0]
        arrays['left'][a:a+ni] = mapping[tree.children_left[inner]]
        arrays['right'][a:a+ni] = mapping[tree.children_right[inner]]
        arrays['features'][a:a+ni] = tree.feature[inner]
        original = tree.threshold[inner]
        # sklearn first casts prediction inputs to float32. Flooring the split
        # to the greatest float32 <= the original threshold preserves every
        # finite float32 comparison, including values next to a split.
        threshold = original.astype(np.float32)
        above = threshold.astype(np.float64) > original
        threshold[above] = np.nextafter(threshold[above], np.float32(-np.inf))
        arrays['thresholds'][a:a+ni] = threshold
        arrays['leaves'][z:z+nl] = tree.value[leaf, :, 0]
        a += ni
        z += nl
    for value in arrays.values():
        value.flush()
    manifest = {'format': 'achilleus-compact-forest-v1', 'trees': len(trees),
                'inner_nodes': int(n_inner), 'leaves': int(n_leaves), 'outputs': outputs,
                'leaf_precision': 'float64', 'split_rule': 'exact for float32 sklearn inputs'}
    (folder / 'forest.json').write_text(json.dumps(manifest, indent=2))
    return CompactForest(folder)
