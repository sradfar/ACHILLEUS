"""Datum-consistent MSCC/c-HAND and record-level residential loss screening."""
from __future__ import annotations
import gzip
import io
import json
import math
from pathlib import Path
import numpy as np
import requests
from scipy import ndimage
import streamlit as st

from constants import ROOT,ASSETS,STATIONS,LEADS

CURVE=np.array([[0,13.4],[.30,23.3],[.61,32.1],[.91,40.1],[1.22,47.1],
 [1.52,53.2],[1.83,58.6],[2.13,63.2],[2.44,67.2],[2.74,70.5],
 [3.05,73.2],[3.35,75.4],[3.66,77.2],[3.96,78.5],[4.27,79.5]],float)


@st.cache_resource(max_entries=2,show_spinner=False)
def terrain(sid,resolution):
    from cloud_runtime import download_asset
    meta=json.loads((ASSETS/'terrain_catalog.json').read_text())[sid]
    local=ROOT/'.release'/meta['artifact']
    path=local if local.exists() else download_asset(meta['artifact'],meta['sha256'])
    if resolution in ['1m','3m']:return high_resolution(sid,resolution,meta['bbox'])
    with np.load(path) as data:
        stride=2 if resolution=='17m' else 1
        return {'z':data['elevation_navd88'][::stride,::stride].copy(),
                'lats':data['lats'][::stride].copy(),'lons':data['lons'][::stride].copy(),
                'resolution':resolution,'source':'AWS Terrain Tiles'}


def high_resolution(sid,resolution,bbox):
    import rasterio
    cfg=STATIONS[sid]
    if resolution=='1m':bbox=cfg['bbox1m'];step=.000009
    else:
        bbox=[cfg['lon']-.07,cfg['lat']-.06,cfg['lon']+.07,cfg['lat']+.06];step=.000027
    west,south,east,north=bbox
    width=math.ceil((east-west)/step);height=math.ceil((north-south)/step)
    dx=(east-west)/width;dy=(north-south)/height
    z=np.full((height,width),np.nan,dtype=np.float32)
    endpoint='https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage'
    for row in range(0,height,2048):
        for col in range(0,width,2048):
            h=min(2048,height-row);w=min(2048,width-col)
            response=requests.get(endpoint,params={'bbox':f'{west+col*dx},{north-(row+h)*dy},{west+(col+w)*dx},{north-row*dy}',
                'bboxSR':4326,'imageSR':4326,'size':f'{w},{h}','format':'tiff','pixelType':'F32',
                'noData':-9999,'interpolation':'RSP_BilinearInterpolation','f':'image'},timeout=(20,120))
            response.raise_for_status()
            try:
                with rasterio.MemoryFile(response.content) as memory:
                    with memory.open() as raster:values=raster.read(1).astype(np.float32)
            except Exception:raise ValueError('USGS high-resolution terrain is unavailable here. Select 8 m or 17 m terrain.') from None
            if values.shape!=(h,w):raise ValueError('USGS returned an unexpected terrain grid. Select 8 m terrain or retry.')
            values[(values<-200)|(values>9000)]=np.nan
            z[row:row+h,col:col+w]=values
    # Preserve missing cells while suppressing isolated elevation artifacts.
    valid=np.isfinite(z);clean=ndimage.median_filter(np.where(valid,z,0),size=3)
    clean[~valid]=np.nan
    return {'z':clean,'lats':north-(np.arange(height)+.5)*dy,
            'lons':west+(np.arange(width)+.5)*dx,'resolution':resolution,'source':'USGS 3DEP'}


@st.cache_resource(max_entries=6,show_spinner=False)
def inventory(sid):
    with gzip.open(ASSETS/f'nsi-{sid}.json.gz','rt',encoding='utf-8') as stream:
        return np.asarray(json.load(stream),dtype=np.float64)


def connected_mask(z,water,method):
    wet=np.isfinite(z)&(z<water)
    seed=np.zeros(wet.shape,dtype=bool)
    seed[0]=wet[0];seed[-1]=wet[-1];seed[:,0]=wet[:,0];seed[:,-1]=wet[:,-1]
    if method=='c_hand':
        if not seed.any():return seed
        flat=np.flatnonzero(seed);chosen=flat[np.argmin(z.ravel()[flat])]
        seed[:]=False;seed.ravel()[chosen]=True
        structure=np.ones((3,3),dtype=bool)
    else:structure=ndimage.generate_binary_structure(2,1)
    return ndimage.binary_propagation(seed,structure=structure,mask=wet)


def structure_cells(records,grid):
    lats,lons=grid['lats'],grid['lons']
    def nearest(axis,values):
        descending=axis[0]>axis[-1];ascending=axis[::-1] if descending else axis
        right=np.clip(np.searchsorted(ascending,values),1,len(axis)-1);left=right-1
        chosen=np.where(np.abs(values-ascending[left])<=np.abs(values-ascending[right]),left,right)
        return len(axis)-1-chosen if descending else chosen
    rr=nearest(lats,records[:,2]);cc=nearest(lons,records[:,1])
    dx=float(np.max(np.abs(np.diff(lons))));dy=float(np.max(np.abs(np.diff(lats))))
    valid=(np.abs(records[:,2]-lats[rr])<=dy*.500001)&(np.abs(records[:,1]-lons[cc])<=dx*.500001)
    return rr[valid],cc[valid],records[valid,3]


def evaluate_impact(sid,request,census):
    from cloud_runtime import forecast_tides
    if sid not in STATIONS:raise ValueError('Unknown coastal station.')
    resolution=request.get('resolution','8m')
    if resolution not in ['1m','3m','8m','17m']:raise ValueError('Choose an available terrain resolution.')
    method=request.get('method','hand_connectivity')
    if method not in ['hand_connectivity','mscc','c_hand']:raise ValueError('Choose MSCC or c-HAND.')
    grid=terrain(sid,resolution)
    navd=grid['z'];z=navd.astype(np.float64)-STATIONS[sid]['offset'];valid=np.isfinite(z);n_valid=int(valid.sum())
    if not n_valid:raise ValueError('The selected terrain domain has no valid elevation cells.')
    lats,lons=grid['lats'],grid['lons']
    dy=abs(float(lats[1]-lats[0]));dx=abs(float(lons[1]-lons[0]));area=dy*111.32*dx*111.32*math.cos(math.radians(float(lats.mean())))
    rr,cc,values=structure_cells(inventory(sid),grid)
    # Preview sampling affects only display; all metrics and record depths use
    # the complete selected-resolution raster.
    stride=max(1,math.ceil(math.sqrt(z.size/32000)))
    pr,pc=np.meshgrid(np.arange(0,z.shape[0],stride),np.arange(0,z.shape[1],stride),indexing='ij')
    pr,pc=pr.ravel(),pc.ravel();preview_valid=valid[pr,pc];pr,pc=pr[preview_valid],pc[preview_valid]
    def one(water,display=False):
        mask=connected_mask(z,float(water),method)
        count=int(mask.sum());depths=np.maximum(0,float(water)-z[mask])
        local=np.where(mask[rr,cc],np.maximum(0,float(water)-z[rr,cc]),0.)
        flooded=np.isfinite(local)&(local>0)
        exposed=float(values[flooded].sum())
        fraction=np.where(flooded,np.interp(local,CURVE[:,0],CURVE[:,1])/100,0.)
        damage=float(np.sum(values*fraction));ratio=100*damage/exposed if exposed else 0.
        deep=int(np.count_nonzero(depths>1.))
        hazard=dict(totalCells=n_valid,floodedCells=count,floodFrac=count/n_valid,
            floodKm2=float(np.count_nonzero(mask&(navd>0))*area),
            meanDepth=float(depths.mean()) if count else 0.,maxDepth=float(depths.max()) if count else 0.,
            shallow=int(np.count_nonzero((depths>0)&(depths<=.3))),
            moderate=int(np.count_nonzero((depths>.3)&(depths<=1))),deep=deep,
            avgDamage=ratio,elevMin=float(np.nanmin(z)),elevMax=float(np.nanmax(z)),wl=float(water),
            modelKey=method,modelInfo='c-HAND' if method=='c_hand' else 'MSCC',
            source=grid['source'],resolution=resolution)
        impact=dict(affPop=int(round(census['totalPop']*count/n_valid)),affUnits=int(round(census['totalUnits']*count/n_valid)),
            displaced=int(round(census['totalPop']*deep/n_valid)),damage=damage,avgDamage=ratio,
            exposedValue=exposed,floodedRecords=int(flooded.sum()),structVal=None)
        preview_depth=np.where(mask[pr,pc],np.maximum(0,float(water)-z[pr,pc]),0.)
        if display:hazard['flooded']=[dict(lat=float(lats[r]),lon=float(lons[c]),elevMLLW=float(z[r,c]),depth=float(d))
                                    for r,c,d in zip(pr,pc,preview_depth) if d>0]
        return hazard,impact,preview_depth
    forecast=request.get('probabilistic_forecast')
    prob=None
    if forecast and forecast.get('surge_members_m'):
        tides=forecast_tides(sid,forecast)
        members=np.asarray(forecast['surge_members_m'],float)
        if members.ndim!=2 or members.shape[1]!=5 or len(members)>201:raise ValueError('Invalid forecast ensemble.')
        peaks=np.max(members+tides[None,:],axis=1)
        levels=np.floor(peaks/.05+.5)*.05
        unique,counts=np.unique(levels,return_counts=True)
        evaluated={};flood_probability=np.zeros(len(pr));p03=flood_probability.copy();p10=flood_probability.copy()
        for level,count in zip(unique,counts):
            h,i,d=one(level)
            evaluated[float(level)]=(h,i)
            flood_probability+=(d>0)*count/len(levels);p03+=(d>.3)*count/len(levels);p10+=(d>1)*count/len(levels)
        def summary(values):return dict(zip(['p10','p50','p90'],map(float,np.quantile(values,[.1,.5,.9]))))
        p50,p90=np.quantile(peaks,[.5,.9]);h50,i50,_=one(float(np.floor(p50/.05+.5)*.05),True);h90,i90,_=one(float(np.floor(p90/.05+.5)*.05),True)
        hs=[evaluated[float(v)][0] for v in levels];imp=[evaluated[float(v)][1] for v in levels]
        prob=dict(ensembleSize=len(levels),ensembleStrategy=forecast.get('ensemble_strategy','common quantile ranks'),
            forecastModel=forecast.get('forecast_model','Meta-stack + EnKF'),
            daActiveLeads=[h for h,active in zip(LEADS,forecast.get('da_active',[])) if active],
            floodMethod=method,responseLevelsEvaluated=len(unique),waterLevelBinM=.05,peakWaterLevelM=summary(peaks),
            peakWaterLevelMembersM=peaks.tolist(),representativeP50=h50,representativeP90=h90,impactP50=i50,impactP90=i90,
            probabilityCells=[dict(lat=float(lats[r]),lon=float(lons[c]),flood_probability=float(p),probability_depth_gt_0_3m=float(a),probability_depth_gt_1_0m=float(b))
                              for r,c,p,a,b in zip(pr,pc,flood_probability,p03,p10)],
            hazard={out:summary([v[key] for v in hs]) for out,key in [('floodKm2','floodKm2'),('floodFraction','floodFrac'),('meanDepthM','meanDepth'),('maxDepthM','maxDepth')]},
            impact={out:summary([v[key] for v in imp]) for out,key in [('affectedPopulation','affPop'),('displacedPopulation','displaced'),('housingUnitsAtRisk','affUnits'),('meanDamageRatioPct','avgDamage'),('propertyDamageUsd','damage')]},
            uncertaintyScope='Conditional on forecast water levels; terrain, datum, exposure and vulnerability uncertainty are excluded.')
        hazard,impact=h50,i50
    else:
        water=float(request.get('water_level',0))
        if not np.isfinite(water) or water<-5 or water>15:raise ValueError('Choose a finite water level between −5 and 15 m MLLW.')
        hazard,impact,_=one(water,True)
    return dict(btub=hazard,impact=impact,probImpact=prob,census=census,
        terrain_preview=[dict(lat=float(lats[r]),lon=float(lons[c]),elev=float(navd[r,c])) for r,c in zip(pr,pc)])
