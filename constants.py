from pathlib import Path

ROOT=Path(__file__).resolve().parent
ASSETS=ROOT/'assets'
RELEASE='https://github.com/sradfar/ACHILLEUS/releases/download/models-v1'
LEADS=[6,12,24,48,72]
STATIONS={
 '8771450':dict(name='Galveston Pier 21',lat=29.31,lon=-94.79,fips='48167',offset=.161,bbox1m=[-94.808,29.295,-94.773,29.325]),
 '8638610':dict(name='Sewells Point',lat=36.95,lon=-76.33,fips='51710',offset=.094,bbox1m=[-76.347,36.935,-76.314,36.965]),
 '8518750':dict(name='The Battery',lat=40.70,lon=-74.01,fips='36061',offset=.143,bbox1m=[-74.026,40.686,-73.995,40.716]),
 '8443970':dict(name='Boston',lat=42.36,lon=-71.05,fips='25025',offset=.183,bbox1m=[-71.065,42.346,-71.035,42.376]),
 '8534720':dict(name='Atlantic City',lat=39.355,lon=-74.418,fips='34001',offset=.128,bbox1m=[-74.440,39.341,-74.408,39.371]),
 '8726520':dict(name='St. Petersburg',lat=27.760,lon=-82.627,fips='12103',offset=.199,bbox1m=[-82.645,27.746,-82.612,27.776]),
}
