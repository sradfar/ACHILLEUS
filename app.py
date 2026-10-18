"""ACHILLEUS coastal digital twin, hosted with its original six workspaces."""
import json
from pathlib import Path
import numpy as np
import streamlit as st
import streamlit.components.v1 as components

ROOT=Path(__file__).resolve().parent
st.set_page_config(page_title='ACHILLEUS · Coastal digital twin',
                   page_icon=str(ROOT/'assets'/'logo-light.png'),layout='wide',initial_sidebar_state='collapsed')
st.markdown('''<style>
header[data-testid="stHeader"],[data-testid="stToolbar"],[data-testid="stStatusWidget"],[data-testid="stAppDeployButton"]{display:none!important}
[data-testid="stMainBlockContainer"]{padding:0!important;max-width:none!important}
[data-testid="stVerticalBlock"]{gap:0!important}
[data-testid="stAppViewContainer"]{background:#f3f7fb}
iframe{border:0;display:block;width:100%;}
footer{display:none}
</style>''',unsafe_allow_html=True)

from cloud_runtime import SessionRuntime
if 'achilleus_runtime' not in st.session_state:st.session_state.achilleus_runtime=SessionRuntime()
if 'achilleus_responses' not in st.session_state:st.session_state.achilleus_responses={}
dashboard=components.declare_component('achilleus_dashboard',path=str(ROOT/'frontend'/'dist'))
request=dashboard(responses=st.session_state.achilleus_responses,key='achilleus',default=None)

def native(value):
    if isinstance(value,np.ndarray):return value.tolist()
    if isinstance(value,np.generic):return value.item()
    raise TypeError(type(value).__name__)

changed=False
for item in (request or {}).get('requests',[]):
    identity=str(item.get('id',''))
    if not identity or identity in st.session_state.achilleus_responses:continue
    try:
        body=st.session_state.achilleus_runtime.route(item['url'],item.get('method','GET'),item.get('body'))
        body=json.loads(json.dumps(body,default=native,allow_nan=False))
        result={'status':200,'body':body}
    except Exception as error:
        # Do not reveal server paths, provider credentials, or tracebacks in UI.
        message=str(error) if isinstance(error,ValueError) else 'The data service is temporarily unavailable. Please retry.'
        result={'status':422,'body':{'detail':message[:400]}}
        print('ACHILLEUS request failed',item.get('url','').split('?')[0],type(error).__name__,flush=True)
    st.session_state.achilleus_responses[identity]=result
    changed=True
if changed:
    # Retain enough completed responses for concurrent component requests.
    if len(st.session_state.achilleus_responses)>60:
        st.session_state.achilleus_responses=dict(list(st.session_state.achilleus_responses.items())[-40:])
    st.rerun()
