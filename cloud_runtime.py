"""Session-isolated operational forecasting and a narrow browser bridge."""
from __future__ import annotations
from copy import deepcopy
from dataclasses import asdict
from datetime import datetime,timezone
import gzip
import hashlib
import json
from pathlib import Path
import pickle
import tarfile
import threading
from urllib.parse import urlparse,parse_qs
import uuid

import numpy as np
import pandas as pd
import requests
import streamlit as st

from constants import ROOT,ASSETS,RELEASE,STATIONS,LEADS
from ensemble_meta_runtime_v3 import install_pickle_compatibility,predict_meta_stack
from meta_stack_live_learning_v3 import MetaStackLiveLearningManager
from probabilistic_da_runtime_meta_v3 import OperationalMetaStackSelectiveDA
from probabilistic_da_runtime_v1 import LeadRuntimeParameters
from feeds import collect,noaa,timestamp

DOWNLOAD_LOCK=threading.RLock()


class DeploymentUnpickler(pickle.Unpickler):
    def find_class(self,module,name):
        if module=='pathlib' and name in ['WindowsPath','PosixPath']:return Path
        return super().find_class(module,name)


def metadata(sid):
    if sid not in STATIONS: raise ValueError('Choose one of the six study stations.')
    return json.loads((ASSETS/f'{sid}.json').read_text())


def download_asset(name,expected=None):
    cache=ROOT/'.downloads';cache.mkdir(exist_ok=True)
    target=cache/name
    if target.exists(): return target
    with DOWNLOAD_LOCK:
        if target.exists(): return target
        temp=target.with_suffix(target.suffix+'.partial')
        digest=hashlib.sha256()
        try:
            with requests.get(f'{RELEASE}/{name}',stream=True,timeout=(15,300)) as response:
                response.raise_for_status()
                with temp.open('wb') as stream:
                    for chunk in response.iter_content(1024*1024):
                        if chunk:stream.write(chunk);digest.update(chunk)
            if expected and digest.hexdigest()!=expected:raise ValueError('Station asset verification failed. Please retry.')
            temp.replace(target)
        finally:
            if temp.exists():temp.unlink()
    return target


@st.cache_resource(max_entries=2,show_spinner=False)
def load_station(sid):
    local=ROOT/'.model_staging'/sid
    folder=local if (local/'core.pkl').exists() else ASSETS/'models'/sid
    if not (folder/'core.pkl').exists():
        catalog=json.loads((ASSETS/'catalog.json').read_text())[sid]
        archive=download_asset(catalog['artifact'],catalog['sha256'])
        parent=ASSETS/'models';parent.mkdir(exist_ok=True)
        with DOWNLOAD_LOCK,tarfile.open(archive,'r:gz') as tar:
            tar.extractall(parent,filter='data')
    install_pickle_compatibility()
    with (folder/'core.pkl').open('rb') as stream:bundle=DeploymentUnpickler(stream).load()
    for name in ['RandomForest','ExtraTrees']:
        bundle['bases'][name]['model'].folder=folder/name
    for base in bundle['bases'].values():
        for estimator in getattr(base['model'],'estimators_',[]):
            if hasattr(estimator,'set_params'):estimator.set_params(n_jobs=2)
    return bundle


@st.cache_data(ttl=300,max_entries=12,show_spinner=False)
def live_inputs(sid):
    return collect(sid,metadata(sid)['feature_cols'])


@st.cache_data(ttl=300,max_entries=100,show_spinner=False)
def external_json(url):
    parsed=urlparse(url)
    if parsed.scheme!='https' or parsed.hostname not in {'api.tidesandcurrents.noaa.gov','api.weather.gov'}:
        raise ValueError('Unsupported data provider.')
    response=requests.get(url,headers={'User-Agent':'ACHILLEUS coastal research dashboard'},timeout=45)
    response.raise_for_status()
    return response.json()


def census(sid):
    return json.loads((ASSETS/'census.json').read_text())[sid]


class SessionRuntime:
    def __init__(self):
        self.id=uuid.uuid4().hex
        self.bundles={};self.da={};self.learning={}
        self.lock=threading.RLock()

    def ensure(self,sid):
        if sid in self.bundles:return
        self.bundles[sid]=deepcopy(load_station(sid))
        meta=metadata(sid)
        self.da[sid]=OperationalMetaStackSelectiveDA(sid,meta['station_name'],
            {int(k):LeadRuntimeParameters(**v) for k,v in meta['da_parameters'].items()},
            meta['current_threshold_m'],ensemble_size=101,state_path=None)
        def get_bundle():return self.bundles[sid]
        def promote(candidate,sigma):
            with self.lock:self.bundles[sid]=candidate
            self.da[sid].reset_after_model_promotion(sigma)
        self.learning[sid]=MetaStackLiveLearningManager(sid,meta['historical_rmse'],meta['current_threshold_m'],
            ROOT/'.runtime'/self.id,get_bundle,promote,max_workers=1)

    def predict(self,sid,body):
        self.ensure(sid)
        inputs=live_inputs(sid)
        issue=datetime.fromtimestamp(inputs['origin'],timezone.utc).isoformat()
        observations=[(datetime.fromtimestamp(t,timezone.utc).isoformat(),value)
                      for t,value in inputs['residual'].items()]
        runtime=self.da[sid];manager=self.learning[sid]
        updates=runtime.assimilate_observations(observations)
        surge=float(inputs['residual'][inputs['origin']])
        learning=manager.observe_and_check(observations,surge)
        with self.lock:
            prior=predict_meta_stack(self.bundles[sid],inputs['X'].reshape(1,-1),np.array([surge]),np.zeros(1))[0]
        result=runtime.forecast(prior,surge,issue)
        manager.buffer.register(issue,inputs['X'],surge,0.,prior)
        result.update(issued_at=issue,n_features=487,n_features_provided=487,matured_updates=updates,
            live_learning=learning,bases_used=['LightGBM','XGBoost','RandomForest','ExtraTrees'],
            forecast_model='Four-model meta-stack + extreme-aware EnKF',ensemble_strategy='common quantile ranks',
            uncertainty_scope='Forecast water-level uncertainty',forcing=inputs['provenance'],
            tide_forecast=[dict(t=datetime.fromtimestamp(t,timezone.utc).isoformat(),v=inputs['tides'][t])
                for t in range(inputs['origin']+3600,inputs['origin']+73*3600,3600)])
        return result

    def route(self,url,method='GET',body=None):
        if url.startswith('https://'):return external_json(url)
        parsed=urlparse(url);path=parsed.path.removeprefix('/achilleus-api');query=parse_qs(parsed.query)
        body=json.loads(body) if isinstance(body,str) and body else (body or {})
        bits=path.strip('/').split('/');sid=bits[-1]
        if path=='/health':return dict(status='ok',stations_loaded=list(STATIONS),n_loaded=6)
        if path=='/stations':return [dict(station_id=k,station_name=v['name']) for k,v in STATIONS.items()]
        if path.startswith('/feature_cols/'):return metadata(sid)
        if path.startswith('/census/'):return census(sid)
        if path.startswith('/predict_probabilistic/'):return self.predict(sid,body)
        if path.startswith('/historical_replay/'):return replay(sid,query['begin'][0],query['end'][0])
        if path.startswith('/impact/'):
            from flood_impact import evaluate_impact
            return evaluate_impact(sid,body,census(sid))
        if path=='/forecast_water_level':
            forecast=body['forecast'];sid=body['station_id'];tides=forecast_tides(sid,forecast)
            return {'water_level':float(np.max(np.asarray(forecast['ml_surge_m'])+tides))}
        if path=='/drift_status':return {k:v.status() for k,v in self.learning.items()}
        if path=='/retrain_status':return {k:v.status() for k,v in self.learning.items()}
        if path.startswith('/da_status/'):
            self.ensure(sid);return self.da[sid].snapshot()
        raise ValueError('The requested dashboard function is unavailable.')


def forecast_tides(sid,forecast):
    origin=timestamp(forecast['issued_at']);rows=noaa(sid,'predictions',origin,origin+73*3600)
    values={timestamp(row['t']):float(row['v']) for row in rows}
    try:return np.array([values[origin+h*3600] for h in LEADS])
    except KeyError:raise ValueError('NOAA tide predictions are incomplete for these forecast valid times.')


def replay(sid,begin,end):
    from statistics import NormalDist
    a=pd.Timestamp(begin).normalize();z=pd.Timestamp(end).normalize()+pd.Timedelta(days=1)-pd.Timedelta(seconds=1)
    if a<pd.Timestamp('2020-01-01') or z>=pd.Timestamp('2026-01-01') or z<a or z-a>pd.Timedelta(days=31):
        raise ValueError('Choose up to 31 days within the 2020–2025 replay record.')
    frames=[]
    for year in range(a.year,z.year+1):
        with np.load(ASSETS/'replay'/f'{sid}-{year}.npz',allow_pickle=False) as data:
            frames.append(pd.DataFrame({k:data[k] for k in data.files}))
    frame=pd.concat(frames);frame['t0']=pd.to_datetime(frame['t0']);frame=frame[(frame.t0>=a)&(frame.t0<=z)].sort_values('t0')
    selections=pd.read_csv(ASSETS/f'{sid}-selections.csv')
    gates={(int(r.evaluation_year),int(r.lead_hours)):r.gate_name for r in selections.itertuples()}
    records=[]
    for _,row in frame.iterrows():
        year=int(row['evaluation_year']);mean=[float(row[f'da_{h}h']) for h in LEADS];sigma=[float(row[f'da_sigma_{h}h']) for h in LEADS]
        records.append(dict(t0=pd.Timestamp(row.t0).tz_localize('UTC').isoformat(),evaluation_year=year,surge_t0=float(row.surge_t0),
            observed_surge_m=[float(row[f'observed_{h}h']) for h in LEADS],ml_surge_m=[float(row[f'ml_{h}h']) for h in LEADS],
            surge_m=mean,p50_m=mean,p10_m=(np.array(mean)-1.2815515655446004*np.array(sigma)).tolist(),
            p90_m=(np.array(mean)+1.2815515655446004*np.array(sigma)).tolist(),sigma_m=sigma,
            da_correction_m=[float(row[f'da_correction_{h}h']) for h in LEADS],da_active=[bool(row[f'da_active_{h}h']) for h in LEADS],
            last_nis=[float(row[f'da_nis_{h}h']) if np.isfinite(row[f'da_nis_{h}h']) else None for h in LEADS],
            extreme_observed=[bool(row[f'extreme_{h}h']) for h in LEADS],gate_name=[gates[(year,h)] for h in LEADS]))
    if not records:raise ValueError('No forecasts are available for these replay dates.')
    return dict(mode='Historical Ensemble DA Replay: 2020–2025',read_only=True,live_state_modified=False,
        station_id=sid,station_name=STATIONS[sid]['name'],available_begin='2020-01-01',available_end='2025-12-31',
        requested_begin=a.date().isoformat(),requested_end=z.date().isoformat(),lead_times=LEADS,ensemble_size=101,
        ensemble_strategy='common quantile ranks',ensemble_z_quantiles=[NormalDist().inv_cdf((m+.5)/101) for m in range(101)],
        n_rows=len(records),records=records)
