import copy
import numpy as np
from sklearn.preprocessing import StandardScaler

class WQEObjective:
    """Pickle-compatible weighted quantile plus quadratic XGBoost objective."""

    def __init__(self, tau1, tau2, w1, w2):
        self.tau1 = tau1
        self.tau2 = tau2
        self.w1 = w1
        self.w2 = w2

    def __call__(self, y_true: np.ndarray, y_pred: np.ndarray, sample_weight=None):
        eps = y_true - y_pred
        underprediction = eps >= 0
        grad_phi1 = np.where(underprediction, -self.tau1, 1.0 - self.tau1)
        grad_phi2 = np.where(
            underprediction,
            -2.0 * self.tau2 * eps,
            -2.0 * (1.0 - self.tau2) * eps,
        )
        hess_phi2 = np.where(
            underprediction,
            2.0 * self.tau2,
            2.0 * (1.0 - self.tau2),
        )
        grad = self.w1 * grad_phi1 + self.w2 * grad_phi2
        hess = self.w1 * 1e-4 + self.w2 * hess_phi2
        return grad.astype(np.float32), hess.astype(np.float32)

class SurgeScaler:
    """Pickle-compatible feature and target scaler."""

    def __init__(self):
        self.X_scaler = StandardScaler()
        self.y_scaler = StandardScaler()

    def fit(self, X_train: np.ndarray, y_train: np.ndarray) -> "SurgeScaler":
        self.X_scaler.fit(X_train)
        self.y_scaler.fit(y_train)
        return self

    def transform_X(self, X: np.ndarray) -> np.ndarray:
        return self.X_scaler.transform(X).astype(np.float32)

    def transform_y(self, y: np.ndarray) -> np.ndarray:
        return self.y_scaler.transform(y).astype(np.float32)

    def inverse_y(self, y_scaled: np.ndarray) -> np.ndarray:
        return self.y_scaler.inverse_transform(y_scaled).astype(np.float32)

class XGBMultiOutputWQE:
    """Pickle-compatible one-XGBRegressor-per-lead wrapper with warm start."""

    def __init__(self, base_model, wqe_obj):
        self.base_model = base_model
        self.wqe_obj = wqe_obj
        self.estimators_ = []

    def fit(self, X, Y, sample_weight=None, warm_start_estimators=None):
        self.estimators_ = []
        for target_index in range(Y.shape[1]):
            estimator = copy.deepcopy(self.base_model)
            estimator.set_params(objective=self.wqe_obj)
            fit_kwargs = {"verbose": False}
            if warm_start_estimators is not None:
                fit_kwargs["xgb_model"] = warm_start_estimators[target_index]
            if sample_weight is None:
                estimator.fit(X, Y[:, target_index], **fit_kwargs)
            else:
                estimator.fit(
                    X,
                    Y[:, target_index],
                    sample_weight=sample_weight,
                    **fit_kwargs,
                )
            self.estimators_.append(estimator)
        return self

    def predict(self, X):
        return np.column_stack(
            [estimator.predict(X) for estimator in self.estimators_]
        )
