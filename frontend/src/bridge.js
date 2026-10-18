// Streamlit hosts the complete React dashboard and handles Python requests.
const pending=new Map();let serial=0;let ready=false;let queue=[];const session=String(Date.now());
const originalFetch=window.fetch.bind(window);
const send=(type,extra={})=>window.parent.postMessage({isStreamlitMessage:true,type,...extra},"*");
function flush(){if(ready&&queue.length)send("streamlit:setComponentValue",{value:{requests:queue},dataType:"json"});}
window.addEventListener("message",event=>{
  if(event.source!==window.parent||event.data?.type!=="streamlit:render")return;
  ready=true;
  const replies=event.data.args?.responses??{};
  for(const[id,result]of Object.entries(replies)){
    const task=pending.get(id);if(!task)continue;
    const body=typeof result.body==="string"?result.body:JSON.stringify(result.body);
    task.resolve(new Response(body,{status:result.status??200,headers:{"Content-Type":"application/json"}}));
    pending.delete(id);queue=queue.filter(r=>r.id!==id);
  }
  flush();
});
window.fetch=(input,options={})=>{
  const raw=typeof input==="string"?input:input.url;
  if(!raw.startsWith("/achilleus-api")&&!raw.startsWith("https://api.tidesandcurrents.noaa.gov/")&&!raw.startsWith("https://api.weather.gov/"))return originalFetch(input,options);
  if(window.parent===window)return originalFetch(input,options);
  return new Promise((resolve,reject)=>{
    const id=session+"-"+String(++serial);pending.set(id,{resolve,reject});
    queue.push({id,url:raw,method:options.method??"GET",body:options.body??null});flush();
    if(options.signal)options.signal.addEventListener("abort",()=>{if(pending.has(id)){pending.delete(id);queue=queue.filter(r=>r.id!==id);reject(new DOMException("Request aborted","AbortError"));}},{once:true});
  });
};
send("streamlit:componentReady",{apiVersion:1});
let previous=0;
new ResizeObserver(()=>{const height=Math.max(800,document.documentElement.scrollHeight);if(Math.abs(height-previous)>2){previous=height;send("streamlit:setFrameHeight",{height});}}).observe(document.documentElement);
