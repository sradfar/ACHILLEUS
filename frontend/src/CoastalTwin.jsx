import "./bridge.js";
import "./design.css";
import TimeSeriesHover from "./TimeSeriesHover.jsx";
import FloodMap from "./FloodMap.jsx";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  alignHourlyTideV5,
  buildHistoricalReplayForecastV5,
  floorUtcHourV5,
  floodDepthV5,
  formatNoaaUtcV5,
  peakWaterLevelMembersV5,
  propagateHazardImpactV5,
  quantileV5,
  tideAtLeadV5,
  totalWaterLevelAtLeadsV5,
} from "./probabilistic_hazard_impact_v5.js";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const NOAA_BASE   = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";
const NWS_BASE    = "https://api.weather.gov";
const CENSUS_BASE = "https://api.census.gov/data/2020/dec/pl";
const ML_BASE = "/achilleus-api";

// ─── ACHEILUS LOGO (embedded PNG, falls back to SVG wave icon) ───────────────
const ACHEILUS_LOGO_DARK = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCABAAEADASIAAhEBAxEB/8QAHAAAAgIDAQEAAAAAAAAAAAAABAUCBgABAwcI/8QANxAAAQMDAgIHBQYHAAAAAAAAAQIDBAAFERIhMVEGExQyQXGBIkJhcpEVI2KhwdEWRFKCkrHx/8QAGgEAAgMBAQAAAAAAAAAAAAAABAUCAwYAAf/EAC4RAAIBAwEGAwgDAAAAAAAAAAECAwAEESESMUFRgaEFkcETFCJhcbHS8DNC0f/aAAwDAQACEQMRAD8A+VKyso21QVTpIQMhtO61chU442kYIo1NRZggLNurlDhvy16WEZxxUdgPWnDdiZbAMuTg8k4H+6aNowOzxB1TLZ0qWOOeQ+PM1pDkdpagy2p1wd4oTqPqo/vWgg8OhjGZNT893QcaWSXUjn4dP3jyoT7Gg6QdTmCcA6/H6VwesDagrsz51A4IWM7+Ypp2rPejvYBzsArHoDmpocYW0paVp0JOpRzjB+NFG0tX02R9qpE8y65P3qnzIb8Rel9BAPBQ3B9aHpteLqZeWWdmAeJ4qpTWZuViWQiE5FN4i7KC4wayrdYWCxZi6gfeukkeecD96qNX2zKSLPGUSAkN5JPAYzTHwVA0zE8BQfiLFYx9aEmkNhMRnUUIACtJwVk8E58M7knlUUR21MkupL+jYNoGEA8kjx8zQ8WSmXcpQZOdPWLQrmTgA+gFMQURYg1nShtAyfIU3i2Zsv8A11+mn768aDbMYC8aRP3CK26W120JxzwlQ+gqcmG9PZQ5FLug7FD2xx83vCmLciDLR2pQR90dOpwY01N1ph51ICXOs7yHQCQD4b8KH929qDtOGB3YwD5irfbbBGFII61TSCCQRgitUbeWuquT4AwCrUPXegqzcqGNyh4GmqNtKG51lGLuDyrc3DB0tJJJx72+cGg6k2guLCU4yeZwK5HZchTv0rmVTgtwph0e1/aaNHDB1eWP+VZZTZebUhawhkj28cSP0pdbFQbeyQqS0p1XeUk59BQ14uyHWSxFJKVbKXjG3IU/t3jtLUiRgSdcZ7f7SyVXnmyo0500ct7DkBUdkBCFe0CN9/A1XI5lCQISXloyvQQFbDferLaZCZMFspPtJASociKXzLeuPcEzWsraCwtYHFPM/EVK7gEqxzRDTTOOVeQSFGaN9/DPOgL5pUtlXWIW6E6HNJzuPGldGXZGi5SAOBWVDyO/60HSK6YtM2edMoRhBXWKyZEhtpJIKzjZJV+Q3NehWixsQm0q/h+bMc8XJJbR9EFW3rVBiTZEQL7K6ppShgrRsrHLPEV0ZutwZWFtTZKVcch1X71fZ3EMB2nXJ6aeeaFvIJpxso2B118sV6r263MpCbha1wUcNT0ZJb/yTkD1rlP6OQJrQfiRIL7a9wlJ6vPyrRt9QaqVq6dz4/sT20S2zsT3V/UbH1FMmukFj1mRBfmWmQrdSW2gptZ/EjOD5jBrQLfWs64Yg/IgA/ie1IGsbqBsqCDzBJH5DvXNPRqKmWEQJ79tmn+WmpHtfKobKHlmi1WG/tbKjRH/AMSHtGfQitOdOILiez3GKiayeK0N4B/sX+hqI6Q9Gkoywu7Rx/Qw6tI+mrFRR7RP45AOuOxBHlirCb3TbQnpnuCD55oOX0MmyHDLuT8K2xkpAUpTmrGPy/OqvfWIkWZ2eCHi22Blx4aVOE750+6OQ486fXHpTDQdVpgrMgd2VOcLy0fFIJIB+NVJ1xbrinHVKWtZKlKUckk8STSa/ktycQ6k7zv9B2HWm9ilyfin0HAbvU9z0r//2Q==";
const ACHEILUS_LOGO_LIGHT = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCABAAEADASIAAhEBAxEB/8QAHAAAAgIDAQEAAAAAAAAAAAAABgcECAADBQEC/8QAOBAAAQMDAwEFBQYFBQAAAAAAAQIDBAUGEQASIQcTMUFRYRQVInGBCFJygpGhFiMyQnMzQ2KTov/EABoBAQADAQEBAAAAAAAAAAAAAAUAAwQGAQL/xAAuEQABAwIEBAYABwAAAAAAAAABAAIDBBESIUGhMVGBkQUTInGx8DIzQmHB0fH/2gAMAwEAAhEDEQA/ALUazWaEup16xbGth2pPpDspZ7KLHzjtXCOB+Ed5PkPMjX0xjnuDW8SvHODRcqbeN4USz4AlV2ahgKyG2h8Tjp8kpHJ+fcPE6SVY+0JU5z7jVpW6FIT/ALknc6r5lDfA/U6VNYqLs983JeDiqjUpwK4sNailHZ5IC14OUtZyEoTgqwTkDlXrlOr1SYZNWnR6RCdAVHjvqLIWnwLcZtJWR67OfM6dh8PijF5Mzt0GqNkqnuPpy+7ItX1yv1EhaVtwEqQkrU2YZGEjvJ+LONEVB+0XUGVtJuShMuMrGQ7DUW1YzjISvIPcfEd2lhIssxWSv31HZ3Ap3S4MuK2QfDtFtbR9SNc1dBrzNXgw0wnXpctPZQyztdQ8nGMtLSSlQAJ5B47zjWk01LILYR8Knzp2HiflXQsu9qDeURT1CmpdWgZdYWNjrX4knn6jI9dEmlJ0d6QxrPLNXrCxJr5QQAhR7OMCMFKfvHHeo/QeJbeudqGxteREbhKxF5bd4sVmqldfK4m4Oqnu2Q6oUukpDKgk+m94j1PCfyjVtdUYvmHOqXVK4IcRh2ROkVR9tDTYypZLhwB9P21v8JYDI5x0CzVziGADUrr24wJK37mqimWXnd7rCnGwtuFHawlTwQeFFJKGWkHgr5P9OoNYuGpx6uqHEfXQW3ylT7pcUuUoK53yXkguKVgglI4GcBI0ddRLZfsW0raXVNjyHnoTMphsZCUMJW4tvd/ducWtXh3DSkYYn3Tc/ZRUF+o1OUooSTjctaieSe4c6VhLZbyfpWKW7LMHFPu2ek0+XSGqvTOpclYdRvD0bepo+eSXOfXI+Y1qs69aLYFYqcOtOU6plQDqqnQkKWjcOD2jQwhtZB5UjvA57tKytWjeVvVT+ESmU8uaj2sQ4LynG5AAOVbRjJG0g5Hh8tQaVLqdFgGUmsx222lqYfo7slaHFoPwrQtkjBBBI8/HvGqTT+YDifiB4WsNx/isEuE5NsR1V52XUPNIdaUFtrSFJUO4g8g6+9BHRSoqqnS23n3FFSkR+wJJyf5aigZ+iRo31z0jMDy06JRrsTQ7ms0KUKxaRSLvrNyNN9pUqk5u3rA/kp2gKSj8RBJPrjRXqDW6pGo1OdmzO1LaBwhltTjiz4JSlIyonyGoxzhdrdVHAcTolt9ph2CjphIRNCTJXJZEQZ5DgVkkfk35+eqwWbUHKZWokimwVTa0HkiClSjsQ6ThJ2jlasngEgeYOmL1JgdQuo1cTLVa9Vj09jKYcVxAR2aT3qVuIyo4GT8h4aNuhnSCbQaom4LqabbmMgiJECgstkjBcWRxnHAAzjJPfjTsL46SmLXuBJ0vt/aNka+eYFosOaT1E6jVun9Qot0Vp5dSlxwWHkO4Tlo5CkJAACcZJGB3/XVrLtftym29Iu+fSIkwxo4kodMZCnlA42gKI47xz4aqX1atmTa99VWI+ypEZ95ciKvHwuNLUSMH0ztPkRpr0jqJBvbpXNtCQREuH3f7NHSv/TlqQkbQlXgtW3G0+J4zqVcAkEcsYy1tyUp5Cwujec9PdHHQFyaml1qM7Sp8CkmYZlN9rb25Zeyrak9xAPOR94aauhfpdORUenVtyW+4wGUH0KUhJH6pOijQtQ7FK42skIhZgUapS0wYL0lxO5LadxG5Kf3UQB8ycaTNyXpVqk8tuPdNDpLOeGoy3HV/mdS2Rn8OBpw1Kkwampv3jGblIbOUtujcgHz2ngn1I1Em2vQprJak0eAtH+BII+RAyNaKSeCE3kbc9Mu91krIJ5xhjdYdf4skJtvBwqepVwvVUj4j7DUVOL/6yQv/AM6m0HqLW4q/Z51VeaeQcEzGA83nyWAA4n5gn5aMbh6OwXl9vb8xyA8DlLbpK0A+iv6k/vriu2ZdzpEeuUyDXWEjamQqUG30j/i7wr6KChp4VVJO31YeoAI75HZAmlrIH+nEPYkg9sxut9y3PBrdHTHvu10Tqao5bqFOd7VtJ+8hXBQfTcD5jSyl2JYsp0vUm8J1ORnclqZAU6pP5kY0zo3S6u08e1W9V1U95Y+OM85n6FaBtWPmnWr+CrvcdxKpNryVeLzjCAT6naBn9NVRupWflyWH7G2zgR2K0OdWH8bL+4vuCD3CkWBdlJtO24tu0uVPuWY2txTRYiFrO5RVg7jwASedNK3n58qnplVNMdt1740ssK3pbT4Ar/uPmRx5eZErcsSS0B7+mRlR85NPpzCY7Cv8hACnB6Hjzzo/SAlICQABwAPDQ9a+C9osyeJ+gfHVLUbZyMU2XIfSfnov/9k=";

const STATIONS = [
  { id:"8771450", name:"Galveston Pier 21",  lat:29.31,  lon:-94.79, region:"Gulf Coast",
    bbox13:[-94.98,29.17,-94.60,29.45], bbox14:[-94.86,29.25,-94.72,29.37],
    bbox1m:[-94.808,29.295,-94.773,29.325],
    fips:{state:"48",county:"167"}, city:"Galveston, TX" },
  { id:"8638610", name:"Sewells Point, VA",  lat:36.95,  lon:-76.33, region:"Chesapeake",
    bbox13:[-76.50,36.82,-76.18,37.08], bbox14:[-76.40,36.89,-76.26,37.01],
    bbox1m:[-76.347,36.935,-76.314,36.965],
    fips:{state:"51",county:"710"}, city:"Norfolk, VA"   },
  { id:"8518750", name:"The Battery, NYC",   lat:40.70,  lon:-74.01, region:"NE Atlantic",
    bbox13:[-74.18,40.58,-73.84,40.82], bbox14:[-74.08,40.64,-73.94,40.76],
    bbox1m:[-74.026,40.686,-73.995,40.716],
    fips:{state:"36",county:"061"}, city:"New York, NY"  },
  { id:"8443970", name:"Boston, MA",         lat:42.36,  lon:-71.05, region:"NE Atlantic",
    bbox13:[-71.18,42.28,-70.92,42.48], bbox14:[-71.12,42.30,-70.98,42.42],
    bbox1m:[-71.065,42.346,-71.035,42.376],
    fips:{state:"25",county:"025"}, city:"Boston, MA"    },
  { id:"8534720", name:"Atlantic City, NJ",  lat:39.355, lon:-74.418, region:"NE Atlantic",
    bbox13:[-74.55,39.28,-74.30,39.43], bbox14:[-74.50,39.30,-74.36,39.42],
    bbox1m:[-74.440,39.341,-74.408,39.371],
    fips:{state:"34",county:"001"}, city:"Atlantic City, NJ" },
  { id:"8726520", name:"St. Petersburg, FL", lat:27.760, lon:-82.627, region:"Gulf Coast",
    bbox13:[-82.75,27.68,-82.50,27.84], bbox14:[-82.70,27.71,-82.56,27.81],
    bbox1m:[-82.645,27.746,-82.612,27.776],
    fips:{state:"12",county:"103"}, city:"St. Petersburg, FL" },
];

const STORM_PRESETS = {
  "8771450": [
    { name:"Tropical Storm Alberto", begin:"20240619", end:"20240621", kind:"da", note:"Saved +6h replay: event RMSE improves by 62.3% with Extreme-aware DA" },
    { name:"Hurricane Hanna", begin:"20200725", end:"20200727", kind:"da", note:"Saved +6h replay: event RMSE improves by 15.7% with Extreme-aware DA" },
    { name:"Hurricane Francine", begin:"20240911", end:"20240913", kind:"da", note:"Saved +6h replay: event RMSE improves by 10.3% with Extreme-aware DA" },
    { name:"Hurricane Laura", begin:"20200826", end:"20200828", kind:"da", note:"Saved +6h replay: event RMSE improves by 6.1% with Extreme-aware DA" },
    { name:"Hurricane Beryl",    begin:"20240707", end:"20240709", kind:"da", note:"2024 rolling-origin DA benchmark; major Gulf Coast coastal extreme" },
    { name:"Hurricane Nicholas", begin:"20210914", end:"20210916", kind:"da", note:"2021 rolling-origin DA benchmark; Cat 1 Texas landfall" },
    { name:"Hurricane Ike",      begin:"20080912", end:"20080915", kind:"analog", note:"Observed historical analog; Cat 2 Galveston landfall" },
    { name:"Hurricane Harvey",   begin:"20170825", end:"20170829", kind:"analog", note:"Observed historical analog; Cat 4 landfall and record rainfall" },
  ],
  "8638610": [
    { name:"December 2023 coastal storm", begin:"20231217", end:"20231219", kind:"da", note:"Saved +6h replay: event RMSE improves by 9.9% with Extreme-aware DA" },
    { name:"Hurricane Sandy",    begin:"20121029", end:"20121031", kind:"analog", note:"Observed historical analog; record Chesapeake surge" },
    { name:"Hurricane Isabel",   begin:"20030918", end:"20030920", kind:"analog", note:"Observed historical analog; Cat 2 and major Norfolk surge" },
    { name:"Hurricane Dorian",   begin:"20190906", end:"20190908", kind:"analog", note:"Observed historical analog; near-miss with significant surge" },
  ],
  "8518750": [
    { name:"January 13 coastal storm", begin:"20240112", end:"20240114", kind:"da", note:"Saved +6h replay: event RMSE improves by 4.9%; extreme-hour RMSE improves by 16.7%" },
    { name:"December 2023 coastal storm", begin:"20231217", end:"20231219", kind:"da", note:"Saved +6h replay: event RMSE improves by 4.1% with Extreme-aware DA" },
    { name:"Hurricane Sandy",    begin:"20121029", end:"20121031", kind:"analog", note:"Observed historical analog; record surge at The Battery" },
    { name:"Hurricane Irene",    begin:"20110827", end:"20110829", kind:"analog", note:"Observed historical analog; significant NYC surge" },
    { name:"1992 Nor'easter",    begin:"19921210", end:"19921212", kind:"analog", note:"Observed historical analog; major Northeast coastal storm" },
  ],
  "8443970": [
    { name:"January 9 coastal storm", begin:"20240109", end:"20240111", kind:"da", note:"Saved +6h replay: event RMSE improves by 12.1% with Extreme-aware DA" },
    { name:"January 13 coastal storm", begin:"20240112", end:"20240114", kind:"da", note:"Saved +6h replay: event RMSE improves by 10.5% with Extreme-aware DA" },
    { name:"Hurricane Bob",      begin:"19910819", end:"19910820", kind:"analog", note:"Observed hourly historical analog; Cat 2 New England landfall" },
    { name:"Hurricane Sandy",    begin:"20121029", end:"20121031", kind:"analog", note:"Observed historical analog; surge extended into New England" },
    { name:"1978 Blizzard",      begin:"19780206", end:"19780208", kind:"analog", note:"Observed historical analog; historic New England coastal storm" },
  ],
  "8534720": [
    { name:"January 9 coastal storm", begin:"20240109", end:"20240111", kind:"da", note:"Saved +6h replay: event RMSE improves by 2.8%; extreme-hour RMSE improves by 11.9%" },
    { name:"Hurricane Sandy",    begin:"20121029", end:"20121031", kind:"analog", note:"Observed historical analog; record Atlantic City surge" },
    { name:"Hurricane Irene",    begin:"20110827", end:"20110829", kind:"analog", note:"Observed historical analog; significant New Jersey surge" },
    { name:"1992 Nor'easter",    begin:"19921210", end:"19921212", kind:"analog", note:"Observed historical analog; major Northeast coastal storm" },
  ],
  "8726520": [
    { name:"Hurricane Helene", begin:"20240926", end:"20240928", kind:"da", note:"Saved +6h replay: event RMSE improves by 6.8% with Extreme-aware DA" },
    { name:"Hurricane Idalia",   begin:"20230829", end:"20230831", kind:"da", note:"2023 rolling-origin DA benchmark; major St. Petersburg surge" },
    { name:"Hurricane Ian",      begin:"20220928", end:"20220930", kind:"da", note:"2022 rolling-origin DA benchmark; Cat 4 Gulf Coast landfall" },
    { name:"Hurricane Irma",     begin:"20170910", end:"20170912", kind:"analog", note:"Observed historical analog; major Tampa Bay water-level response" },
  ],
};

const LEAD_TIMES = [6, 12, 24, 48, 72];
const ALERT = { low: 0.3, medium: 0.6, high: 1.0 };

// ─── EnKF CONSTANTS ──────────────────────────────────────────────────────────
// ─── DATE HELPERS ─────────────────────────────────────────────────────────────
const fmtNoaa  = formatNoaaUtcV5;
const fmtInput = d => `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
const parseDate = s => { const [y,m,d] = s.split("-"); return new Date(Date.UTC(+y,+m-1,+d)); };
const yyyymmddToDate = s => new Date(Date.UTC(+s.slice(0,4), +s.slice(4,6)-1, +s.slice(6,8)));
const noaaUtcIso = value => {
  const text=String(value??"").trim().replace(" ","T");
  const normalized=/[zZ]|[+-]\d\d:\d\d$/.test(text)
    ? text
    : /T\d\d:\d\d$/.test(text) ? `${text}:00Z` : `${text}Z`;
  const parsed=new Date(normalized);
  if(!Number.isFinite(parsed.getTime())) throw new Error(`Invalid NOAA UTC timestamp: ${value}`);
  return parsed.toISOString();
};
function clampRange(begin, end) {
  const maxMs = 31*24*3600*1000;
  return (end-begin)>maxMs ? {begin, end:new Date(begin.getTime()+maxMs)} : {begin, end};
}

async function fetchWaterLevelRange(stationId, begin, end) {
  const fetchProduct=async product=>{
    const url = `${NOAA_BASE}?begin_date=${encodeURIComponent(fmtNoaa(begin))}&end_date=${encodeURIComponent(fmtNoaa(end))}&station=${stationId}&product=${product}&datum=MLLW&time_zone=gmt&units=metric&format=json&application=achilleus_v5`;
    const response=await fetch(url);
    const payload=await response.json();
    if(payload.error) throw new Error(payload.error.message);
    const values=(payload.data??[]).map(point=>({t:noaaUtcIso(point.t),v:parseFloat(point.v)})).filter(point=>!isNaN(point.v));
    values.sourceProduct=product;
    return values;
  };
  try{
    return await fetchProduct("water_level");
  }catch(primaryError){
    // Older events often predate six-minute digital observations. NOAA's
    // verified hourly-height archive is the scientifically appropriate
    // historical fallback; do not use it as a substitute for live polling.
    const historic=end.getTime()<Date.now()-48*3600*1000;
    if(!historic) throw primaryError;
    try{
      return await fetchProduct("hourly_height");
    }catch{
      throw primaryError;
    }
  }
}
async function fetchTidePredictions(stationId, begin, end) {
  const url = `${NOAA_BASE}?begin_date=${encodeURIComponent(fmtNoaa(begin))}&end_date=${encodeURIComponent(fmtNoaa(end))}&station=${stationId}&product=predictions&datum=MLLW&time_zone=gmt&interval=h&units=metric&format=json&application=coastal_twin`;
  const r = await fetch(url); const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  return d.predictions.map(p=>({t:noaaUtcIso(p.t),v:parseFloat(p.v)}));
}
function isoDurationHoursV2(duration){
  const match=String(duration).match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?)?$/);
  return match?(Number(match[1]??0)*24+Number(match[2]??0)):0;
}
function expandNwsGridSeriesV2(series){
  const expanded=new Map();
  for(const item of series?.values??[]){
    const[startText,durationText]=String(item.validTime).split("/");
    const start=new Date(startText);
    const hours=Math.max(1,isoDurationHoursV2(durationText));
    for(let offset=0;offset<hours;offset++){
      expanded.set(new Date(start.getTime()+offset*3600*1000).toISOString().slice(0,13),item.value);
    }
  }
  return expanded;
}
function degreesToCardinalV2(value){
  const directions=["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return directions[Math.round((((Number(value)%360)+360)%360)/22.5)%16];
}
async function fetchNwsGridFallbackV2(gridUrl){
  const response=await fetch(gridUrl,{headers:{"User-Agent":"CoastalTwin/2.0"}});
  if(!response.ok) throw new Error("NWS gridded forecast failed");
  const properties=(await response.json()).properties;
  const windSpeed=expandNwsGridSeriesV2(properties.windSpeed);
  const windDirection=expandNwsGridSeriesV2(properties.windDirection);
  const temperature=expandNwsGridSeriesV2(properties.temperature);
  const availableHours=[...new Set([...windSpeed.keys(),...windDirection.keys(),...temperature.keys()])].sort().slice(0,72);
  if(!availableHours.length) throw new Error("NWS gridded forecast is empty");
  return availableHours.map(hour=>{
    const speedKmh=Number(windSpeed.get(hour)??0);
    const directionDeg=Number(windDirection.get(hour)??180);
    const temperatureC=Number(temperature.get(hour)??0);
    return{
      startTime:`${hour}:00:00Z`,
      shortForecast:"NWS gridded forecast",
      windSpeed:`${Math.round(speedKmh*0.621371)} mph`,
      windDirection:degreesToCardinalV2(directionDeg),
      temperature:Math.round(temperatureC*9/5+32),
      temperatureUnit:"F",
      source:"forecastGridData",
    };
  });
}
async function fetchNWSForecast(lat, lon) {
  const pt = await fetch(`${NWS_BASE}/points/${lat.toFixed(4)},${lon.toFixed(4)}`, {headers:{"User-Agent":"CoastalTwin/1.0"}});
  if (!pt.ok) throw new Error("NWS point lookup failed");
  const ptj = await pt.json();
  try{
    const fc = await fetch(ptj.properties.forecastHourly, {headers:{"User-Agent":"CoastalTwin/2.0"}});
    if (!fc.ok) throw new Error(`NWS hourly forecast returned ${fc.status}`);
    return (await fc.json()).properties.periods.slice(0,72);
  }catch{
    // The BOX hourly product can fail while the official raw hourly grid
    // remains healthy. Use the same NWS grid rather than a third-party source.
    return fetchNwsGridFallbackV2(ptj.properties.forecastGridData);
  }
}

// ─── ELEVATION ────────────────────────────────────────────────────────────────
// Resolution options:
//   "17m"  → AWS Terrarium tiles z=13  (~17 m)   wide area
//   "8m"   → AWS Terrarium tiles z=14  (~8 m)    detail
//   "3m"   → USGS 3DEP ImageServer     (~3 m /9 arc-sec)
//   "1m"   → USGS 3DEP ImageServer     (~1 m lidar, where available)
//
// USGS 3DEP limits: max 4096×4096 px per exportImage request.
// We tile the bbox into chunks so each request stays ≤ 1024×1024 px.

// ─── CENSUS ───────────────────────────────────────────────────────────────────
async function fetchCensus(station){const r=await fetch(`${ML_BASE}/census/${station.id}`);if(!r.ok)throw new Error("Census totals unavailable");return r.json();}

// ─── WEATHER HELPERS + RESIDUAL ──────────────────────────────────────────────
const parseWind = s => parseFloat(s)||0;
const cardinalToDeg = s=>({N:0,NNE:22.5,NE:45,ENE:67.5,E:90,ESE:112.5,SE:135,SSE:157.5,S:180,SSW:202.5,SW:225,WSW:247.5,W:270,WNW:292.5,NW:315,NNW:337.5}[s]??180);
function nwsPeriodToWx(p){return {spdMph:parseWind(p.windSpeed),dirDeg:cardinalToDeg(p.windDirection),pres:1013};}
function computeResidual(obs, pred) {
  const map={}; pred.forEach(p=>{map[p.t.slice(0,13)]=p.v;});
  return obs.map(o=>{const k=o.t.slice(0,13);return map[k]!==undefined?{t:o.t,v:+(o.v-map[k]).toFixed(3)}:null;}).filter(Boolean);
}
function surgeColor(v){return v>=ALERT.high?"#ff2244":v>=ALERT.medium?"#ff8800":v>=ALERT.low?"#ffcc00":"#00cc77";}
function riskLabel(v){return v>=ALERT.high?"HIGH":v>=ALERT.medium?"ELEVATED":v>=ALERT.low?"WATCH":"NOMINAL";}

// ─── ML BACKEND ───────────────────────────────────────────────────────────────
async function checkBackend(){
  try{const r=await fetch(`${ML_BASE}/health`,{signal:AbortSignal.timeout(120000)});if(!r.ok)return{ok:false};const d=await r.json();return{ok:true,stations:d.stations_loaded??[]};}catch{return{ok:false,stations:[]};}
}
async function fetchFeatureCols(stationId){
  const r=await fetch(`${ML_BASE}/feature_cols/${stationId}`);if(!r.ok)throw new Error("feature_cols failed");
  return (await r.json()).feature_cols;
}
async function fetchHistoricalReplayV1(stationId,begin,end){
  const query=new URLSearchParams({begin,end});
  const r=await fetch(`${ML_BASE}/historical_replay/${stationId}?${query.toString()}`);
  if(!r.ok){const e=await r.json().catch(()=>({detail:r.statusText}));throw new Error(e.detail??r.statusText);}
  return r.json();
}
async function probabilisticPredictV1(stationId, featDict, issuedAt, observedAt=null, observedSurgeM=null, observationHistory=[]){
  const r=await fetch(`${ML_BASE}/predict_probabilistic/${stationId}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
    features:        featDict,
    surge_t0:        featDict["surge_t0"]    ?? 0,
    storm_flag:      featDict["storm_flag"]  ?? 0,
    issued_at:       issuedAt,
    observed_at:     observedAt,
    observed_surge_m: observedSurgeM,
    observation_history: observationHistory,
  })});
  if(!r.ok){const e=await r.json().catch(()=>({detail:r.statusText}));throw new Error(e.detail??r.statusText);}
  return r.json();
}

function asForecastDistributionV1(result){
  return {
    mean: result.surge_m,
    std: result.sigma_m,
    p10: result.p10_m,
    p90: result.p90_m,
    priorMean: result.ml_surge_m,
    priorStd: result.ml_sigma_m,
    ensemble: result.surge_members_m,
    kalmanGain: result.last_gain?.map(value=>Number.isFinite(value)?value:0)??Array(5).fill(0),
    history: [],
  };
}

function buildFeatureDict({featureCols,residuals24h,wxLookback,wxForecast,tideForecast72,now}){
  const toRad=deg=>deg*Math.PI/180, ms=mph=>mph*0.44704;
  const resMap={},wxLbMap={},wxFcMap={},tideMap={};
  for (let h=1;h<=24;h++){
    const idx=residuals24h.length-h; resMap[h]=idx>=0?(residuals24h[idx]?.v??0):0;
    const wx=wxLookback[wxLookback.length-h]??{};const dr=toRad(wx.dirDeg??180);
    wxLbMap[h]={spd:ms(wx.spdMph??0),sin:Math.sin(dr),cos:Math.cos(dr),pres:wx.pres??1013};
  }
  for (let h=1;h<=72;h++){
    const wx=wxForecast[h-1]??{};const dr=toRad(wx.dirDeg??180);
    wxFcMap[h]={spd:ms(wx.spdMph??0),sin:Math.sin(dr),cos:Math.cos(dr),pres:wx.pres??1013};
    tideMap[h]=tideForecast72[h-1]?.v??0;
  }
  const month=(now??new Date()).getUTCMonth(), mA=2*Math.PI*month/12;
  const surge_t0=residuals24h.at(-1)?.v??0;
  const feat={};
  for (const col of featureCols){
    let m;
    if((m=col.match(/surge_res_t-(\d+)/)))    {feat[col]=resMap[+m[1]]??0;continue;}
    if((m=col.match(/wind_speed_t-(\d+)/)))    {feat[col]=wxLbMap[+m[1]]?.spd??0;continue;}
    if((m=col.match(/wind_sin_t-(\d+)/)))      {feat[col]=wxLbMap[+m[1]]?.sin??0;continue;}
    if((m=col.match(/wind_cos_t-(\d+)/)))      {feat[col]=wxLbMap[+m[1]]?.cos??1;continue;}
    if((m=col.match(/pressure_t-(\d+)/)))      {feat[col]=wxLbMap[+m[1]]?.pres??1013;continue;}
    if((m=col.match(/wind_speed_t\+(\d+)/)))   {feat[col]=wxFcMap[+m[1]]?.spd??0;continue;}
    if((m=col.match(/wind_sin_t\+(\d+)/)))     {feat[col]=wxFcMap[+m[1]]?.sin??0;continue;}
    if((m=col.match(/wind_cos_t\+(\d+)/)))     {feat[col]=wxFcMap[+m[1]]?.cos??1;continue;}
    if((m=col.match(/pressure_t\+(\d+)/)))     {feat[col]=wxFcMap[+m[1]]?.pres??1013;continue;}
    if((m=col.match(/tide_pred_t\+(\d+)/)))    {feat[col]=tideMap[+m[1]]??0;continue;}
    if(col==="month_sin") {feat[col]=Math.sin(mA);continue;}
    if(col==="month_cos") {feat[col]=Math.cos(mA);continue;}
    if(col==="surge_t0")  {feat[col]=surge_t0;continue;}
    feat[col]=0;
  }
  return feat;
}

// ─── FLOOD MODEL ──────────────────────────────────────────────────────────────
const NAVD_TO_MLLW={
  "8771450":0.161,"8638610":0.094,"8518750":0.143,"8443970":0.183,
  "8534720":0.128,"8726520":0.199
};

// ─── SVG COMPONENTS ───────────────────────────────────────────────────────────
function Sparkline({data,color="#32bad2",h=48,showZero=false,label="Water level",unit="m MLLW"}){
  if(!data||data.length<2) return <div style={{height:h}}/>;
  const vals=data.map(d=>d.v),mn=Math.min(...vals),mx=Math.max(...vals),rng=mx-mn||1;
  const W=260,H=h;
  const uid=color.replace(/[^a-z0-9]/gi,"")+(H|0);
  const times=data.map(d=>new Date(d.t).getTime()),start=Math.min(...times),span=Math.max(...times)-start||1;
  const toX=t=>(new Date(t).getTime()-start)/span*W;
  const toY=v=>H-((v-mn)/rng)*(H-4)-2;
  const pts=data.map(d=>`${toX(d.t)},${toY(d.v)}`).join(" ");
  const hoverSeries=[{name:label,unit,color,points:data.map(d=>({x:toX(d.t),y:toY(d.v),v:d.v,t:d.t}))}];
  return(
    <TimeSeriesHover width={W} height={H} label={label} series={hoverSeries}>
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{overflow:"visible"}}>
      <defs><linearGradient id={`g${uid}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity={0.45}/><stop offset="100%" stopColor={color} stopOpacity={0}/>
      </linearGradient></defs>
      {showZero&&mn<0&&mx>0&&<line x1={0} y1={H-((0-mn)/rng)*(H-4)-2} x2={W} y2={H-((0-mn)/rng)*(H-4)-2} stroke="rgba(255,255,255,0.12)" strokeWidth={1} strokeDasharray="3,3"/>}
      <polyline points={`0,${H} ${pts} ${W},${H}`} fill={`url(#g${uid})`}/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round"/>
    </svg>
    </TimeSeriesHover>
  );
}

function TideChart({observed,predicted,isHistoric,label}){
  if(!observed.length&&!predicted.length) return null;
  const W=560,H=140;
  const allV=[...observed.map(d=>d.v),...predicted.map(d=>d.v)];
  const mn=Math.min(...allV)-.1,mx=Math.max(...allV)+.1,rng=mx-mn;
  const allT=[...observed,...predicted].map(d=>new Date(d.t));
  const tMin=Math.min(...allT),tMax=Math.max(...allT),tRng=tMax-tMin||1;
  const toX=t=>((new Date(t)-tMin)/tRng)*(W-40)+20;
  const toY=v=>H-((v-mn)/rng)*(H-24)-12;
  const obsPts=observed.map(d=>`${toX(d.t)},${toY(d.v)}`).join(" ");
  const predPts=predicted.map(d=>`${toX(d.t)},${toY(d.v)}`).join(" ");
  const nowX=!isHistoric?toX(new Date().toISOString()):null;
  const labels=Array.from({length:6},(_,i)=>new Date(tMin+(i/5)*tRng));
  const hoverSeries=[{name:"Observed water level",color:"#32bad2",unit:"m MLLW",points:observed.map(d=>({x:toX(d.t),y:toY(d.v),v:d.v,t:d.t}))},
    {name:"Predicted tide",color:"#2a6080",unit:"m MLLW",points:predicted.map(d=>({x:toX(d.t),y:toY(d.v),v:d.v,t:d.t}))}];
  return(
    <TimeSeriesHover width={W} height={H} label="Water level and predicted tide" series={hoverSeries} exact={false}>
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{overflow:"visible"}}>
      <defs><linearGradient id="obsGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#32bad2" stopOpacity={0.3}/><stop offset="100%" stopColor="#32bad2" stopOpacity={0}/>
      </linearGradient></defs>
      {[0,.25,.5,.75,1].map(f=>{const v=mn+f*rng,y=toY(v);return<g key={f}><line x1={20} y1={y} x2={W-20} y2={y} stroke="rgba(255,255,255,0.04)" strokeWidth={1}/><text x={16} y={y+3} fill="rgba(255,255,255,0.2)" fontSize={7.5} textAnchor="end">{v.toFixed(1)}</text></g>;})}
      {labels.map((d,i)=><text key={i} x={toX(d.toISOString())} y={H-1} fill="rgba(255,255,255,0.15)" fontSize={7} textAnchor="middle">{d.toISOString().slice(5,10)}</text>)}
      {predPts&&<polyline points={predPts} fill="none" stroke="#2a6080" strokeWidth={1} strokeDasharray="4,3"/>}
      {obsPts&&<><polyline points={`20,${H-12} ${obsPts} ${toX(observed.at(-1).t)},${H-12}`} fill="url(#obsGrad)"/><polyline points={obsPts} fill="none" stroke="#32bad2" strokeWidth={1.5}/></>}
      {nowX&&nowX>20&&nowX<W-20&&<><line x1={nowX} y1={8} x2={nowX} y2={H-12} stroke="#ffcc00" strokeWidth={1} strokeDasharray="3,2"/><text x={nowX+3} y={15} fill="#ffcc00" fontSize={7}>NOW</text></>}
      <text x={22} y={H-14} fill="rgba(255,255,255,0.18)" fontSize={7}>— Observed</text>
      <text x={100} y={H-14} fill="#2a6080" fontSize={7}>- - Predicted tide</text>
      {label&&<text x={W-20} y={H-14} fill="#2a5060" fontSize={7} textAnchor="end">{label}</text>}
    </svg>
    </TimeSeriesHover>
  );
}

/** Extreme-aware DA chart: tide + ensemble prior + posterior + p10/p90. */
function EnKFForecastChart({tideFc, enkfResult, mlResult, rmse, issuedAt}){
  if(!tideFc.length||!enkfResult) return null;
  const W=580,H=190;
  const{mean:postMean,std:postStd,p10,p90,priorMean,priorStd}=enkfResult;
  const tideAt=lead=>tideAtLeadV5(tideFc,lead,issuedAt);

  // Build all y values for axis scaling
  const tideVals=tideFc.slice(0,72).map(p=>p.v);
  const allY=[
    ...tideVals,
    ...LEAD_TIMES.map(tideAt).map((t,j)=>t+p90[j]+0.1),
    ...LEAD_TIMES.map(tideAt).map((t,j)=>t+p10[j]-0.1),
  ];
  const mn=Math.min(...allY)-.05, mx=Math.max(...allY)+.05, rng=mx-mn||1;
  const toX=h=>32+(h/72)*(W-62);
  const toY=v=>H-((v-mn)/rng)*(H-30)-15;

  // Tide continuous line
  const tideLine=tideFc.slice(0,72).map((_,i)=>`${toX(i+1)},${toY(tideFc[i].v)}`).join(" ");

  // EnKF posterior band and line (total WL = tide + surge ensemble)
  const postBandTop=LEAD_TIMES.map((lt,j)=>`${toX(lt)},${toY(tideAt(lt)+p90[j])}`).join(" ");
  const postBandBot=[...LEAD_TIMES].reverse().map((lt,j2)=>{
    const j=LEAD_TIMES.length-1-j2;
    return `${toX(lt)},${toY(tideAt(lt)+p10[j])}`;
  }).join(" ");
  const postLine=LEAD_TIMES.map((lt,j)=>`${toX(lt)},${toY(tideAt(lt)+postMean[j])}`).join(" ");

  // Prior band (before assimilation) — lighter
  const priorBandTop=LEAD_TIMES.map((lt,j)=>`${toX(lt)},${toY(tideAt(lt)+priorMean[j]+priorStd[j])}`).join(" ");
  const priorBandBot=[...LEAD_TIMES].reverse().map((lt,j2)=>{
    const j=LEAD_TIMES.length-1-j2;
    return `${toX(lt)},${toY(Math.max(tideAt(lt)+priorMean[j]-priorStd[j],mn+0.02))}`;
  }).join(" ");

  // Ensemble total water level (if available)
  const mlLine=mlResult?LEAD_TIMES.map((lt,j)=>`${toX(lt)},${toY(tideAt(lt)+mlResult.surge_m[j])}`).join(" "):null;

  const gridVals=[.15,.35,.55,.75].map(f=>mn+f*rng);

  const point=(lead,value)=>({x:toX(lead),y:toY(value),v:value,t:new Date(new Date(issuedAt).getTime()+lead*3600000).toISOString()});
  const leadSeries=(name,values,color)=>({name,color,unit:"m MLLW",points:LEAD_TIMES.map((lt,j)=>point(lt,tideAt(lt)+values[j]))});
  const hoverSeries=[
    {name:"Predicted tide",color:"#2a6080",unit:"m MLLW",points:tideFc.slice(0,72).map((p,i)=>point(i+1,p.v))},
    leadSeries("Extreme-aware DA mean",postMean,"#71a8f0"),
    leadSeries("p10 water level",p10,"#71a8f0"),leadSeries("p90 water level",p90,"#71a8f0"),
    ...(mlResult?[leadSeries("Ensemble prior",mlResult.surge_m,"#ff8800")]:[]),
    leadSeries("Prior mean − σ",priorMean.map((m,j)=>m-priorStd[j]),"#446677"),
    leadSeries("Prior mean + σ",priorMean.map((m,j)=>m+priorStd[j]),"#446677")];
  return(
    <TimeSeriesHover width={W} height={H} label="Probabilistic total water level" series={hoverSeries} exact={true}>
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{overflow:"visible"}}>
      {/* Grid */}
      {gridVals.map((v,i)=><g key={i}><line x1={32} y1={toY(v)} x2={W-30} y2={toY(v)} stroke="rgba(255,255,255,0.03)" strokeWidth={1}/><text x={28} y={toY(v)+3} fill="rgba(255,255,255,0.14)" fontSize={7} textAnchor="end">{v.toFixed(1)}</text></g>)}
      {[12,24,36,48,60,72].map(h=><g key={h}><line x1={toX(h)} y1={H-13} x2={toX(h)} y2={H-9} stroke="#1e3040" strokeWidth={1}/><text x={toX(h)} y={H-1} fill="#2a4050" fontSize={7} textAnchor="middle">+{h}h</text></g>)}

      {/* Prior uncertainty band (lighter) */}
      <polygon points={`${priorBandTop} ${priorBandBot}`} fill="#446677" opacity={0.1}/>

      {/* Posterior (EnKF) uncertainty band */}
      <polygon points={`${postBandTop} ${postBandBot}`} fill="#71a8f0" opacity={0.18}/>

      {/* Tide line */}
      <polyline points={tideLine} fill="none" stroke="#1e5070" strokeWidth={1} strokeDasharray="3,3"/>

      {/* ML line (if present) */}
      {mlLine&&<polyline points={mlLine} fill="none" stroke="#ff8800" strokeWidth={1.5} strokeDasharray="5,2" opacity={0.7}/>}

      {/* EnKF posterior mean line */}
      <polyline points={postLine} fill="none" stroke="#71a8f0" strokeWidth={2.5} strokeLinejoin="round"/>

      {/* Dots at lead times */}
      {LEAD_TIMES.map((lt,j)=>{
        const tide=tideAt(lt);
        const total=tide+postMean[j];
        const col=surgeColor(postMean[j]);
        return <g key={lt}>
          {/* p10-p90 line */}
          <line x1={toX(lt)} y1={toY(tide+p90[j])} x2={toX(lt)} y2={toY(tide+p10[j])} stroke="#71a8f0" strokeWidth={1.5} opacity={0.6}/>
          <line x1={toX(lt)-5} y1={toY(tide+p90[j])} x2={toX(lt)+5} y2={toY(tide+p90[j])} stroke="#71a8f0" strokeWidth={1} opacity={0.5}/>
          <line x1={toX(lt)-5} y1={toY(tide+p10[j])} x2={toX(lt)+5} y2={toY(tide+p10[j])} stroke="#71a8f0" strokeWidth={1} opacity={0.5}/>
          {/* Dot */}
          <circle cx={toX(lt)} cy={toY(total)} r={5} fill="#0c1820" stroke={col} strokeWidth={1.5}/>
          <circle cx={toX(lt)} cy={toY(total)} r={2} fill={col}/>
          <text x={toX(lt)} y={toY(total)-10} fill={col} fontSize={8} textAnchor="middle" fontWeight="600">{total.toFixed(2)}</text>
          <text x={toX(lt)} y={toY(total)+20} fill="#8060aa" fontSize={7} textAnchor="middle">±{(postStd[j]*100).toFixed(0)}cm</text>
        </g>;
      })}

      {/* Legend */}
      <line x1={34} y1={H-24} x2={52} y2={H-24} stroke="#1e5070" strokeWidth={1} strokeDasharray="3,3"/>
      <text x={55} y={H-20} fill="#2a6080" fontSize={7}>Tide</text>
      <line x1={86} y1={H-24} x2={104} y2={H-24} stroke="#71a8f0" strokeWidth={2.5}/>
      <text x={107} y={H-20} fill="#8060aa" fontSize={7}>Extreme-aware DA</text>
      <rect x={205} y={H-30} width={12} height={8} fill="#71a8f0" opacity={0.22}/>
      <text x={220} y={H-20} fill="#5a4466" fontSize={7}>p10–p90 range</text>
      {mlLine&&<><line x1={310} y1={H-24} x2={328} y2={H-24} stroke="#ff8800" strokeWidth={1.5} strokeDasharray="4,2"/><text x={331} y={H-20} fill="#8a6030" fontSize={7}>Ensemble prior</text></>}
      <text x={30} y={14} fill="#2a5060" fontSize={7}>m MLLW</text>
    </svg>
    </TimeSeriesHover>
  );
}

function parseReplayUtcV2(value){
  const text=String(value);
  return new Date(/[zZ]$|[+-]\d\d:\d\d$/.test(text)?text:`${text}Z`);
}
function eventDateIsoV2(value){
  return `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}`;
}
function HistoricalReplayPanelV2({replay,event,leadHours,onLeadChange,selectedIndex,onIndexChange,lm}){
  if(!replay?.records?.length) return null;
  const records=replay.records;
  const leadIndex=LEAD_TIMES.indexOf(leadHours);
  const safeIndex=Math.min(Math.max(selectedIndex,0),records.length-1);
  const selected=records[safeIndex];
  const observed=records.map(row=>row.observed_surge_m[leadIndex]);
  const ml=records.map(row=>row.ml_surge_m[leadIndex]);
  const da=records.map(row=>row.surge_m[leadIndex]);
  const p10=records.map(row=>row.p10_m[leadIndex]);
  const p90=records.map(row=>row.p90_m[leadIndex]);
  const issueTimes=records.map(row=>parseReplayUtcV2(row.t0));
  const validTimes=issueTimes.map(time=>new Date(time.getTime()+leadHours*3600*1000));
  const eventBegin=event?new Date(`${eventDateIsoV2(event.begin)}T00:00:00Z`):null;
  const eventEnd=event?new Date(`${eventDateIsoV2(event.end)}T23:59:59Z`):null;
  const eventMask=validTimes.map(time=>!event||(time>=eventBegin&&time<=eventEnd));
  const extremeMask=records.map((row,index)=>eventMask[index]&&row.extreme_observed[leadIndex]);
  const metricMask=event?eventMask:records.map(()=>true);
  const allValues=[...observed,...ml,...da].filter(Number.isFinite);
  const minimum=Math.min(...allValues)-0.03;
  const maximum=Math.max(...allValues)+0.03;
  const range=maximum-minimum||1;
  const width=920,height=220,left=44,right=18,top=18,bottom=32;
  const step=Math.max(1,Math.ceil(records.length/600));
  const plotIndices=records.map((_,index)=>index).filter(index=>index%step===0||index===records.length-1);
  const x=index=>left+(index/Math.max(records.length-1,1))*(width-left-right);
  const y=value=>top+(maximum-value)/range*(height-top-bottom);
  const line=values=>plotIndices.map(index=>`${x(index)},${y(values[index])}`).join(" ");
  const rmse=(values,mask)=>{
    const indices=values.map((_,index)=>index).filter(index=>mask[index]&&Number.isFinite(values[index])&&Number.isFinite(observed[index]));
    return indices.length?Math.sqrt(indices.reduce((sum,index)=>sum+(values[index]-observed[index])**2,0)/indices.length):NaN;
  };
  const mlRmse=rmse(ml,metricMask),daRmse=rmse(da,metricMask);
  const gain=mlRmse>0?100*(1-daRmse/mlRmse):0;
  const mlExtremeRmse=rmse(ml,extremeMask),daExtremeRmse=rmse(da,extremeMask);
  const extremeGain=mlExtremeRmse>0?100*(1-daExtremeRmse/mlExtremeRmse):NaN;
  const activeHours=records.filter((row,index)=>metricMask[index]&&row.da_active[leadIndex]).length;
  const extremeHours=extremeMask.filter(Boolean).length;
  const coveredHours=records.filter((_,index)=>metricMask[index]&&observed[index]>=p10[index]&&observed[index]<=p90[index]).length;
  const metricHours=metricMask.filter(Boolean).length;
  const coverage=metricHours?100*coveredHours/metricHours:NaN;
  const peak=(values,mask)=>{
    const indices=values.map((_,index)=>index).filter(index=>mask[index]&&Number.isFinite(values[index]));
    if(!indices.length) return null;
    const index=indices.reduce((best,current)=>values[current]>values[best]?current:best,indices[0]);
    return{index,value:values[index],time:validTimes[index]};
  };
  const observedPeak=peak(observed,metricMask);
  const mlPeakEvent=peak(ml,metricMask);
  const daPeakEvent=peak(da,metricMask);
  const peakError=forecastPeak=>forecastPeak&&observedPeak?forecastPeak.value-observedPeak.value:NaN;
  const peakTiming=forecastPeak=>forecastPeak&&observedPeak?(forecastPeak.time-observedPeak.time)/3600000:NaN;
  const score=Number.isFinite(extremeGain)?extremeGain:gain;
  const classification=score>1?"DA IMPROVED":score<-1?"DA WORSENED":"DA NEUTRAL";
  const classificationColor=score>1?"#00cc77":score<-1?"#ff5577":"#aa8844";
  const issueTime=parseReplayUtcV2(selected.t0);
  const validTime=new Date(issueTime.getTime()+leadHours*3600*1000);
  const eventIndices=eventMask.map((included,index)=>included?index:-1).filter(index=>index>=0);
  const eventShade=eventIndices.length?{
    first:eventIndices[0],
    last:eventIndices.at(-1),
  }:null;
  const hoverSeries=[{name:"Observed surge",values:observed,color:"#32bad2"},
    {name:"Meta-stack surge",values:ml,color:"#ff9a32"},{name:"Extreme-aware DA surge",values:da,color:"#71a8f0"}]
    .map(({name,values,color})=>({name,color,unit:"m",points:records.map((_,i)=>({x:x(i),y:y(values[i]),v:values[i],t:validTimes[i].toISOString()}))}));
  const background=lm?"#eff5fd":"#101f3a";
  const border=lm?"#c4d9ef":"#243b5d";
  return(
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div className="card-enkf">
        <div style={{display:"flex",justifyContent:"space-between",gap:14,alignItems:"flex-start",flexWrap:"wrap"}}>
          <div>
            <div style={{fontSize:11,color:"#71a8f0",letterSpacing:1}}>HISTORICAL DA REPLAY: 2020–2025</div>
            <div style={{fontSize:11,color:"#5a3a88",marginTop:4}}>
              {event?`${event.name} · event-valid evaluation · 72 h pre-event issuance context`:"Read-only annual rolling-origin results"} · live operational state is never modified
            </div>
          </div>
          <div style={{fontSize:11,color:"#5a3a88",textAlign:"right"}}>
            <div>{replay.station_name}</div>
            <div style={{marginTop:3}}>{replay.requested_begin} → {replay.requested_end} · {replay.n_rows} hourly issuances</div>
          </div>
        </div>
      </div>

      <div className="card-enkf">
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap",marginBottom:10}}>
          <div style={{fontSize:11,color:"#3a1a55",letterSpacing:2}}>SURGE REPLAY BY VALID TIME {event?`· SHADED ${event.name.toUpperCase()}`:""}</div>
          <div style={{display:"flex",gap:4}}>
            {LEAD_TIMES.map(lead=><button key={lead} className={`btn-enkf${leadHours===lead?" active":""}`} onClick={()=>onLeadChange(lead)}>+{lead}H</button>)}
          </div>
        </div>
        <TimeSeriesHover width={width} height={height} label="Historical surge replay" series={hoverSeries}>
        <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{overflow:"visible"}}>
          {eventShade&&<rect
            x={Math.max(left,x(eventShade.first)-2)}
            y={top}
            width={Math.max(4,x(eventShade.last)-x(eventShade.first)+4)}
            height={height-top-bottom}
            fill="#71a8f0"
            opacity={0.07}
          />}
          {[0.2,0.4,0.6,0.8].map(fraction=>{
            const value=minimum+fraction*range;
            return <g key={fraction}><line x1={left} y1={y(value)} x2={width-right} y2={y(value)} stroke="rgba(128,96,170,.14)"/><text x={left-6} y={y(value)+3} textAnchor="end" fill="#5a3a88" fontSize={8}>{value.toFixed(2)}</text></g>;
          })}
          <polyline points={line(observed)} fill="none" stroke="#32bad2" strokeWidth={1.6}/>
          <polyline points={line(ml)} fill="none" stroke="#ff9a32" strokeWidth={1.3} strokeDasharray="5,3"/>
          <polyline points={line(da)} fill="none" stroke="#71a8f0" strokeWidth={2}/>
          <line x1={x(safeIndex)} y1={top} x2={x(safeIndex)} y2={height-bottom} stroke="#ffffff" strokeWidth={1} opacity={0.35}/>
          <circle cx={x(safeIndex)} cy={y(da[safeIndex])} r={4} fill="#71a8f0"/>
          <text x={left} y={height-8} fill="#5a3a88" fontSize={8}>{validTimes[0].toISOString().slice(0,16).replace("T"," ")}</text>
          <text x={width-right} y={height-8} textAnchor="end" fill="#5a3a88" fontSize={8}>{validTimes.at(-1).toISOString().slice(0,16).replace("T"," ")}</text>
          <line x1={left+8} y1={top+4} x2={left+28} y2={top+4} stroke="#32bad2" strokeWidth={1.6}/><text x={left+33} y={top+7} fill="#3a7890" fontSize={8}>Observed</text>
          <line x1={left+105} y1={top+4} x2={left+125} y2={top+4} stroke="#ff9a32" strokeWidth={1.3} strokeDasharray="5,3"/><text x={left+130} y={top+7} fill="#8a6030" fontSize={8}>Meta-stack</text>
          <line x1={left+205} y1={top+4} x2={left+225} y2={top+4} stroke="#71a8f0" strokeWidth={2}/><text x={left+230} y={top+7} fill="#8060aa" fontSize={8}>Extreme-aware DA</text>
        </svg>
        </TimeSeriesHover>
        <input type="range" min={0} max={records.length-1} step={1} value={safeIndex} onChange={event=>onIndexChange(Number(event.target.value))}/>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#5a3a88",marginTop:4}}>
          <span>Selected issue: {issueTime.toISOString().slice(0,16).replace("T"," ")} UTC</span>
          <span>Valid +{leadHours}h: {validTime.toISOString().slice(0,16).replace("T"," ")} UTC</span>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
        {[
          ["EVENT META-STACK RMSE",Number.isFinite(mlRmse)?`${mlRmse.toFixed(4)} m`:"—","#71a8f0"],
          ["EVENT EXTREME-AWARE DA RMSE",Number.isFinite(daRmse)?`${daRmse.toFixed(4)} m`:"—","#71a8f0"],
          ["EVENT RMSE CHANGE",Number.isFinite(gain)?`${gain>=0?"+":""}${gain.toFixed(2)}% skill`:"—",gain>=0?"#00cc77":"#ff5577"],
          ["EXTREME-ONLY CHANGE",Number.isFinite(extremeGain)?`${extremeGain>=0?"+":""}${extremeGain.toFixed(2)}% skill`:"No extreme hours",Number.isFinite(extremeGain)?(extremeGain>=0?"#00cc77":"#ff5577"):"#8060aa"],
          ["EVENT CLASSIFICATION",classification,classificationColor],
          ["REGIME COUNTS",`${activeHours} active · ${extremeHours} observed-extreme hours`,"#71a8f0"],
          ["P10–P90 COVERAGE",Number.isFinite(coverage)?`${coverage.toFixed(1)}% · ${coveredHours}/${metricHours} h`:"—","#71a8f0"],
          ["PEAK ERRORS",`Stack ${peakError(mlPeakEvent)>=0?"+":""}${peakError(mlPeakEvent).toFixed(3)} m · DA ${peakError(daPeakEvent)>=0?"+":""}${peakError(daPeakEvent).toFixed(3)} m`,"#71a8f0"],
          ["PEAK TIMING",`Stack ${peakTiming(mlPeakEvent)>=0?"+":""}${peakTiming(mlPeakEvent).toFixed(0)} h · DA ${peakTiming(daPeakEvent)>=0?"+":""}${peakTiming(daPeakEvent).toFixed(0)} h`,"#71a8f0"],
        ].map(([label,value,color])=><div key={label} style={{background,border:`1px solid ${border}`,padding:"11px 13px",borderRadius:2}}><div style={{fontSize:11,color:"#3a1a55",letterSpacing:1.5}}>{label}</div><div style={{fontSize:16,color,marginTop:6,fontFamily:"Inter,system-ui,sans-serif"}}>{value}</div></div>)}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8}}>
        {LEAD_TIMES.map((lead,index)=>{
          const active=selected.da_active[index];
          return <div key={lead} className="enkf-lt-card">
            <div style={{fontSize:11,color:"#3a1a55",letterSpacing:2}}>+{lead}H</div>
            <div style={{fontSize:18,color:surgeColor(selected.surge_m[index]),marginTop:6,fontFamily:"Inter,system-ui,sans-serif"}}>{selected.surge_m[index]>=0?"+":""}{selected.surge_m[index].toFixed(3)} m</div>
            <div style={{fontSize:11,color:"#5a3a88",marginTop:4}}>obs {selected.observed_surge_m[index].toFixed(3)} · stack {selected.ml_surge_m[index].toFixed(3)}</div>
            <div style={{fontSize:11,color:"#5a3a88",marginTop:3}}>p10 {selected.p10_m[index].toFixed(3)} · p90 {selected.p90_m[index].toFixed(3)}</div>
            <div style={{fontSize:11,color:active?"#71a8f0":"#00aa77",marginTop:5}}>{active?`DA ACTIVE · ${selected.gate_name[index]}`:"ENSEMBLE RETAINED"}</div>
            <div style={{fontSize:11,color:"#4a2a55",marginTop:3}}>DA correction {selected.da_correction_m[index]>=0?"+":""}{selected.da_correction_m[index].toFixed(3)} m</div>
          </div>;
        })}
      </div>
    </div>
  );
}

/** Uncertainty band sparkline for surge: shows prior vs posterior std */
function UncertaintyBand({enkfResult,issuedAt}){
  if(!enkfResult) return null;
  const{priorStd,std:postStd}=enkfResult;
  const W=420,H=80;
  const labels=LEAD_TIMES;
  const mx=Math.max(...priorStd,...postStd)+0.01;
  const toX=j=>40+j*(W-60)/4;
  const toYv=v=>H-10-(v/mx)*(H-20);
  const hoverSeries=[{name:"Prior σ",values:priorStd,color:"#446677"},{name:"Posterior σ",values:postStd,color:"#71a8f0"}]
    .map(({name,values,color})=>({name,color,unit:"m",points:labels.map((lead,j)=>({x:toX(j),y:toYv(values[j]),v:values[j],t:issuedAt?new Date(new Date(issuedAt).getTime()+lead*3600000).toISOString():null}))}));
  return(
    <TimeSeriesHover width={W} height={H} label="Surge uncertainty by forecast lead" series={hoverSeries} exact={false}>
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{overflow:"visible"}}>
      {/* prior */}
      <polyline points={labels.map((_,j)=>`${toX(j)},${toYv(priorStd[j])}`).join(" ")} fill="none" stroke="#446677" strokeWidth={1.5} strokeDasharray="4,2"/>
      {/* posterior */}
      <polyline points={labels.map((_,j)=>`${toX(j)},${toYv(postStd[j])}`).join(" ")} fill="none" stroke="#71a8f0" strokeWidth={2}/>
      {labels.map((_,j)=><g key={j}>
        <circle cx={toX(j)} cy={toYv(priorStd[j])} r={3} fill="#446677" opacity={0.6}/>
        <circle cx={toX(j)} cy={toYv(postStd[j])} r={3.5} fill="#71a8f0"/>
        <text x={toX(j)} y={H-2} fill="#2a4050" fontSize={7} textAnchor="middle">+{LEAD_TIMES[j]}h</text>
        <text x={toX(j)} y={toYv(postStd[j])-7} fill="#71a8f0" fontSize={7} textAnchor="middle">{(postStd[j]*100).toFixed(0)}cm</text>
      </g>)}
      <text x={42} y={12} fill="#446677" fontSize={7}>- - Prior σ</text>
      <text x={110} y={12} fill="#71a8f0" fontSize={7}>— Posterior σ (after assimilation)</text>
    </svg>
    </TimeSeriesHover>
  );
}

function DepthBar({label,count,total,color}){
  const pct=total>0?count/total*100:0;
  return(
    <div style={{marginBottom:8}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
        <span style={{fontSize:11,color:"#446677"}}>{label}</span>
        <span style={{fontSize:11,color}}>{count.toLocaleString()} ({pct.toFixed(1)}%)</span>
      </div>
      <div style={{height:4,background:"#0a1820",borderRadius:1}}>
        <div style={{height:4,width:`${pct}%`,background:color,borderRadius:1,transition:"width .5s"}}/>
      </div>
    </div>
  );
}

function DRow({k,v,vCol="#88aacc"}){
  return(
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:"1px solid #0e1e2a"}}>
      <span style={{fontSize:11,color:"#446677"}}>{k}</span>
      <span style={{fontSize:11,color:vCol}}>{v}</span>
    </div>
  );
}

function ForecastChart({tideFc,surgeML,sigma,modelName,issuedAt}){
  if(!tideFc.length||!surgeML.length) return null;
  const W=580,H=170;
  const mlPts=LEAD_TIMES.map((lt,i)=>{const tide=tideAtLeadV5(tideFc,lt,issuedAt);return{h:lt,tide,surge:surgeML[i],total:tide+surgeML[i],sigma:sigma[i]};});
  const allVals=[...tideFc.slice(0,72).map(p=>p.v),...mlPts.flatMap(p=>[p.total+p.sigma,p.total-p.sigma])];
  const mn=Math.min(...allVals)-.1,mx=Math.max(...allVals)+.1,rng=mx-mn||1;
  const toX=h=>30+(h/72)*(W-60), toY=v=>H-((v-mn)/rng)*(H-28)-14;
  const tideLine=tideFc.slice(0,72).map((_,i)=>`${toX(i+1)},${toY(tideFc[i].v)}`).join(" ");
  const mlLine=mlPts.map(p=>`${toX(p.h)},${toY(p.total)}`).join(" ");
  const envTop=mlPts.map(p=>`${toX(p.h)},${toY(p.total+p.sigma)}`).join(" ");
  const envBot=[...mlPts].reverse().map(p=>`${toX(p.h)},${toY(p.total-p.sigma)}`).join(" ");
  const point=(lead,value)=>({x:toX(lead),y:toY(value),v:value,t:new Date(new Date(issuedAt).getTime()+lead*3600000).toISOString()});
  const hoverSeries=[{name:"Predicted tide",color:"#2a6080",unit:"m MLLW",points:tideFc.slice(0,72).map((p,i)=>point(i+1,p.v))},
    {name:"Forecast total water level",color:"#ff8800",unit:"m MLLW",points:mlPts.map(p=>point(p.h,p.total))},
    {name:"Mean − σ",color:"#ff8800",unit:"m MLLW",points:mlPts.map(p=>point(p.h,p.total-p.sigma))},
    {name:"Mean + σ",color:"#ff8800",unit:"m MLLW",points:mlPts.map(p=>point(p.h,p.total+p.sigma))}];
  return(
    <TimeSeriesHover width={W} height={H} label="Forecast total water level" series={hoverSeries} exact={true}>
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{overflow:"visible"}}>
      {[.2,.4,.6,.8].map((f,i)=>{const v=mn+f*rng;return<g key={i}><line x1={30} y1={toY(v)} x2={W-30} y2={toY(v)} stroke="rgba(255,255,255,0.03)" strokeWidth={1}/><text x={26} y={toY(v)+3} fill="rgba(255,255,255,0.15)" fontSize={7} textAnchor="end">{v.toFixed(1)}</text></g>;})}
      {[12,24,36,48,60,72].map(h=><g key={h}><line x1={toX(h)} y1={H-12} x2={toX(h)} y2={H-8} stroke="#1e3040" strokeWidth={1}/><text x={toX(h)} y={H-1} fill="#2a4050" fontSize={7} textAnchor="middle">+{h}h</text></g>)}
      <polygon points={`${envTop} ${envBot}`} fill="#ff8800" opacity={0.1}/>
      <polyline points={tideLine} fill="none" stroke="#1e5070" strokeWidth={1} strokeDasharray="3,3"/>
      <polyline points={mlLine} fill="none" stroke="#ff8800" strokeWidth={2} strokeLinejoin="round"/>
      {mlPts.map(p=>{const col=surgeColor(p.surge);return<g key={p.h}><circle cx={toX(p.h)} cy={toY(p.total)} r={5} fill="#0c1820" stroke={col} strokeWidth={1.5}/><circle cx={toX(p.h)} cy={toY(p.total)} r={2} fill={col}/><text x={toX(p.h)} y={toY(p.total)-9} fill={col} fontSize={8} textAnchor="middle" fontWeight="600">{p.total.toFixed(2)}</text></g>;})}
      <line x1={32} y1={H-24} x2={50} y2={H-24} stroke="#1e5070" strokeWidth={1} strokeDasharray="3,3"/><text x={53} y={H-20} fill="#2a6080" fontSize={7}>Tide</text>
      <line x1={84} y1={H-24} x2={102} y2={H-24} stroke="#ff8800" strokeWidth={2}/><text x={105} y={H-20} fill="#ff8800" fontSize={7}>Ensemble total WL</text>
      <rect x={190} y={H-30} width={12} height={8} fill="#ff8800" opacity={0.2}/><text x={205} y={H-20} fill="#446677" fontSize={7}>±1σ forecast spread</text>
      <text x={W-28} y={H-20} fill="#2a4050" fontSize={7} textAnchor="end">{modelName}</text>
      <text x={30} y={12} fill="#2a5060" fontSize={7}>m MLLW</text>
    </svg>
    </TimeSeriesHover>
  );
}

export default function ProbabilisticCoastalTwinV5() {
  const [stIdx,    setStIdx]    = useState(0);
  const [timeMode, setTimeMode] = useState("live");
  const [lightMode, setLightMode] = useState(() => {try{return localStorage.getItem("achilleus-theme")!=="dark"}catch{return true}});
  useEffect(()=>{document.documentElement.dataset.theme=lightMode?"light":"dark";try{localStorage.setItem("achilleus-theme",lightMode?"light":"dark")}catch{}},[lightMode]);
  const today = fmtInput(new Date());
  const [histBegin, setHistBegin] = useState(fmtInput(new Date(Date.now()-7*86400000)));
  const [histEnd,   setHistEnd]   = useState(today);
  const [storm,     setStorm]     = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);

  // Core data
  const [waterData,  setWaterData]  = useState([]);
  const [waterProduct,setWaterProduct]= useState("water_level");
  const [tideData,   setTideData]   = useState([]);
  const [wxData,     setWxData]     = useState([]);
  const [residuals,  setResiduals]  = useState([]);
  const [loading,    setLoading]    = useState({data:false,impact:false,ml:false,enkf:false,replay:false});
  const [lastUpd,    setLastUpd]    = useState(null);
  const [error,      setError]      = useState(null);
  const [tab,        setTab]        = useState("overview");
  const [autoUpd,    setAutoUpd]    = useState(true);

  // Impact
  const [elevGrid,   setElevGrid]   = useState(null);
  const impactTimer=useRef(null);
  const [btub,       setBtub]       = useState(null);
  const [census,     setCensus]     = useState(null);
  const [impact,     setImpact]     = useState(null);
  const [probImpact, setProbImpact] = useState(null);
  const [impStat,    setImpStat]    = useState("");
  const [scenario,   setScenario]   = useState(null);
  const [demRes,     setDemRes]     = useState("17m");
  const [floodMethod,setFloodMethod]= useState("hand_connectivity");
  // "live" | "ml" | "prob" — which data source drives the impact water level
  const [impactSource, setImpactSource] = useState("live");

  // ML
  const [backend,     setBackend]     = useState(null);
  const [featureCols, setFeatureCols] = useState([]);
  const [mlResult,    setMlResult]    = useState(null);
  const [mlErr,       setMlErr]       = useState(null);
  const [mlStat,      setMlStat]      = useState("");
  const [tideFc72,    setTideFc72]    = useState([]);
  const [historicalReplay,      setHistoricalReplay]      = useState(null);
  const [historicalReplayError, setHistoricalReplayError] = useState(null);
  const [historicalReplayLead,  setHistoricalReplayLead]  = useState(6);
  const [historicalReplayIndex, setHistoricalReplayIndex] = useState(0);

  // Compatibility-shaped chart data from the probabilistic DA response.
  const [enkfResult,        setEnkfResult]        = useState(null);
  const [enkfStatus,        setEnkfStatus]        = useState("");
  const [enkfLastUpdated,   setEnkfLastUpdated]   = useState(null);
  const [enkfSigInit,       setEnkfSigInit]       = useState(null);
  const [enkfUserTriggered, setEnkfUserTriggered] = useState(false); // historic: requires explicit Run Filter

  const timerRef    = useRef(null);
  const lastAutoForecastHourRef = useRef(null);
  const lastEventReplayKeyRef = useRef(null);
  const [nextUpdate, setNextUpdate] = useState(null); // UTC time of next auto-refresh
  const station  = STATIONS[stIdx];
  const presets  = STORM_PRESETS[station.id]??[];
  const selectedReplayRecord=historicalReplay?.records?.[historicalReplayIndex]??null;
  const impactForecast=timeMode==="historic"
    ? buildHistoricalReplayForecastV5(selectedReplayRecord,historicalReplay)
    : mlResult;

  useEffect(()=>{checkBackend().then(setBackend);},[]);
  useEffect(()=>{
    if(!backend?.ok) return;
    fetchFeatureCols(station.id).then(setFeatureCols).catch(()=>setFeatureCols([]));
  },[station.id,backend?.ok]);

  const getRange=useCallback(()=>{
    if(timeMode==="live"){const n=new Date();return{begin:new Date(n-86400000),end:n,live:true};}
    const begin=parseDate(histBegin),end=parseDate(histEnd);end.setUTCHours(23,59,0,0);
    return{...clampRange(begin,end),live:false};
  },[timeMode,histBegin,histEnd]);

  const loadData=useCallback(async()=>{
    setLoading(l=>({...l,data:true}));setError(null);
    const{begin,end,live}=getRange();
    try{
      const[wl,tide]=await Promise.all([
        fetchWaterLevelRange(station.id,begin,end),
        fetchTidePredictions(station.id,begin,end),
      ]);
      setWaterProduct(wl.sourceProduct??"water_level");
      setWaterData(wl);setTideData(tide);
      const res=computeResidual(wl,tide);setResiduals(res);
      if(live){
        const wx=await fetchNWSForecast(station.lat,station.lon).catch(()=>[]);
        setWxData(wx);
      } else {
        setWxData([]);
      }
      setLastUpd(new Date());
    }catch(e){setError(e.message);}
    finally{setLoading(l=>({...l,data:false}));}
  },[station,getRange]);

  useEffect(()=>{loadData();},[loadData]);
  useEffect(()=>{
    clearTimeout(timerRef.current);
    clearInterval(timerRef.current);
    setNextUpdate(null);
    if(!autoUpd||timeMode!=="live") return;
    // Schedule first fire at the next NOAA 6-min boundary (:00,:06,:12,...,:54)
    // then repeat every 6 minutes exactly.
    const scheduleNext=()=>{
      const now=new Date();
      const mins=now.getMinutes(), secs=now.getSeconds(), ms=now.getMilliseconds();
      const totalSec=mins*60+secs+ms/1000;
      const nextBoundary=Math.ceil(totalSec/360)*360;
      const delay=Math.max((nextBoundary-totalSec)*1000, 1000);
      const fireAt=new Date(now.getTime()+delay);
      setNextUpdate(fireAt);
      timerRef.current=setTimeout(()=>{
        loadData();
        // After first fire, repeat every 6 minutes
        timerRef.current=setInterval(()=>{
          loadData();
          setNextUpdate(new Date(Date.now()+6*60*1000));
        },6*60*1000);
        setNextUpdate(new Date(Date.now()+6*60*1000));
      },delay);
    };
    scheduleNext();
    return()=>{clearTimeout(timerRef.current);clearInterval(timerRef.current);};
  },[autoUpd,timeMode,loadData]);

  // Reset EnKF, ML and Impact when station, mode or date window changes
  useEffect(()=>{
    lastAutoForecastHourRef.current=null;
    setEnkfResult(null);setEnkfStatus("");setEnkfSigInit(null);setEnkfLastUpdated(null);setEnkfUserTriggered(false);
    setMlResult(null);setMlStat("");setMlErr(null);setTideFc72([]);
    setHistoricalReplay(null);setHistoricalReplayError(null);setHistoricalReplayLead(6);setHistoricalReplayIndex(0);
    setBtub(null);setImpact(null);setProbImpact(null);setCensus(null);setElevGrid(null);setImpStat("");
    setImpactSource("live");
    setTab(current=>{
      if(selectedEvent?.kind==="analog"&&current==="⚡ forecast") return "◷ historical analog";
      if(current==="🔵 probabilistic"||current==="🔵 historical da replay"||current==="◷ historical analog"){
        if(timeMode==="live") return "🔵 probabilistic";
        return selectedEvent?.kind==="analog"?"◷ historical analog":"🔵 historical da replay";
      }
      return current;
    });
  },[stIdx,timeMode,histBegin,histEnd,selectedEvent?.kind]);

  // ── Probabilistic ML + Extreme-aware DA forecast ──────────────────────────────
  const runML=useCallback(async()=>{
    if(!backend?.ok){setMlErr("Forecast service is reconnecting. Please retry.");return;}
    if(timeMode!=="live"){setMlErr("Switch to LIVE mode.");return;}
    setLoading(l=>({...l,ml:true}));setMlErr(null);setMlResult(null);
    try{
      setMlStat("Retrieving verified NOAA observations, GFS forcing and time-aligned tides…");
      const response=await fetch(`${ML_BASE}/predict_probabilistic/${station.id}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({})});
      const res=await response.json();if(!response.ok)throw new Error(res.detail??"Forecast retrieval failed");
      if(res.tide_forecast){setTideFc72(res.tide_forecast);}
      setMlResult(res);
      setEnkfResult(asForecastDistributionV1(res));
      setEnkfLastUpdated(new Date());
      setImpactSource("prob");
      setMlStat("Complete");
    }catch(e){setMlErr(e.message);setMlStat("Failed");}
    finally{setLoading(l=>({...l,ml:false}));}
  },[station,backend,featureCols,residuals,timeMode]);

  // Historical replay is served entirely from read-only rolling-origin outputs.
  // It never invokes or mutates the live operational DA runtime.
  const runHistoricalReplay=useCallback(async()=>{
    if(!backend?.ok){setHistoricalReplayError("Forecast service is reconnecting. Please retry.");return;}
    if(timeMode!=="historic"){setHistoricalReplayError("Switch to HISTORIC mode.");return;}
    setLoading(current=>({...current,replay:true}));
    setHistoricalReplayError(null);
    setHistoricalReplay(null);
    try{
      const replay=await fetchHistoricalReplayV1(station.id,histBegin,histEnd);
      setHistoricalReplay(replay);
      setHistoricalReplayLead(6);
      setHistoricalReplayIndex(Math.max(0,replay.records.length-1));
      setImpactSource("prob");
      setTab("🔵 historical da replay");
    }catch(error){
      setHistoricalReplayError(error.message);
    }finally{
      setLoading(current=>({...current,replay:false}));
    }
  },[backend?.ok,timeMode,station.id,histBegin,histEnd]);

  useEffect(()=>{
    if(timeMode!=="historic") return;
    setBtub(null);setImpact(null);setProbImpact(null);setTideFc72([]);setImpactSource("prob");
  },[historicalReplayIndex,timeMode]);

  useEffect(()=>{
    if(selectedEvent?.kind!=="da"||timeMode!=="historic"){
      lastEventReplayKeyRef.current=null;
      return;
    }
    if(!backend?.ok) return;
    const key=`${station.id}:${selectedEvent.name}:${histBegin}:${histEnd}`;
    if(lastEventReplayKeyRef.current===key) return;
    lastEventReplayKeyRef.current=key;
    runHistoricalReplay();
  },[selectedEvent?.name,selectedEvent?.kind,timeMode,backend?.ok,histBegin,histEnd,station.id,runHistoricalReplay]);

  // NOAA remains on a six-minute polling cycle. The ML feature/lead grid is
  // hourly, so issue one automatic probabilistic forecast per new UTC hour.
  useEffect(()=>{
    if(!autoUpd||timeMode!=="live"||!backend?.ok||!featureCols.length||!residuals.length) return;
    const observedAt=residuals.at(-1)?.t;
    if(!observedAt) return;
    const hour=new Date(observedAt).toISOString().slice(0,13);
    if(lastAutoForecastHourRef.current===hour) return;
    lastAutoForecastHourRef.current=hour;
    runML();
  },[autoUpd,timeMode,backend?.ok,featureCols.length,residuals,runML]);

  // Fetch tide forecast independently when EnKF result is available but tideFc72 is empty
  // This ensures Impact tab shows correct total water level even without running ML first
  useEffect(()=>{
    if(tideFc72.length>0) return;          // already have it
    if(!enkfResult && !impactSource) return;
    if(timeMode!=="live") return;           // historic: tides not needed for impact
    const forecastOrigin=floorUtcHourV5(mlResult?.issued_at??new Date());
    const fcEnd=new Date(forecastOrigin.getTime()+73*3600*1000);
    fetchTidePredictions(station.id,forecastOrigin,fcEnd)
      .then(t=>{ if(t.length) setTideFc72(alignHourlyTideV5(t,forecastOrigin,72)); })
      .catch(()=>{});
  },[enkfResult,mlResult?.issued_at,station.id,tideFc72.length,timeMode,impactSource]);

  // ── Impact ────────────────────────────────────────────────────────────────
  useEffect(()=>()=>clearTimeout(impactTimer.current),[station.id,demRes,floodMethod,impactSource]);
  const requestImpact=async(waterLevel,method=floodMethod,probabilistic=false)=>{
    const response=await fetch(`${ML_BASE}/impact/${station.id}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
      water_level:waterLevel,method,resolution:demRes,
      probabilistic_forecast:probabilistic?impactForecast:null,
    })});
    const data=await response.json();if(!response.ok)throw new Error(data.detail??"Impact calculation failed");
    if(!data.map_grid||!data.btub?.map_depth_png)throw new Error("The impact service is updating. Please refresh the app and retry shortly.");
    setBtub(data.btub);setImpact(data.impact);setCensus(data.census);setProbImpact(data.probImpact??null);
    setElevGrid(data.map_grid??null);setImpStat("Complete");return data;
  };
  const runImpact=useCallback(async()=>{
    setLoading(l=>({...l,impact:true}));setImpStat("Loading terrain and residential inventory; calculating connected flood depths…");
    try{
      const probabilistic=scenario===null&&impactSource==="prob"&&impactForecast?.surge_members_m;
      let wl=scenario;
      if(wl===null){
        if(impactSource==="ml"&&impactForecast?.ml_surge_m){
          const response=await fetch(`${ML_BASE}/forecast_water_level`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({station_id:station.id,forecast:impactForecast})});
          const data=await response.json();if(!response.ok)throw new Error(data.detail);wl=data.water_level;
        }else wl=waterData.length?Math.max(...waterData.map(d=>d.v)):0;
      }
      await requestImpact(wl,floodMethod,Boolean(probabilistic));
    }catch(e){setImpStat("⚠ "+e.message);}finally{setLoading(l=>({...l,impact:false}));}
  },[station,demRes,scenario,impactSource,impactForecast,waterData,floodMethod]);
  const rerunFlood=useCallback(async(wl,method=floodMethod)=>{
    if(!btub)return;setLoading(l=>({...l,impact:true}));setImpStat("Updating flood and impact estimates…");
    try{await requestImpact(wl,method,false);}catch(e){setImpStat("⚠ "+e.message);}finally{setLoading(l=>({...l,impact:false}));}
  },[btub,station.id,demRes,floodMethod]);

  const applyPreset=useCallback(p=>{
    const eventBegin=yyyymmddToDate(p.begin);
    const eventEnd=yyyymmddToDate(p.end);
    const replayBegin=new Date(eventBegin);
    const replayEnd=new Date(eventEnd);
    if(p.kind==="da"){
      replayBegin.setUTCDate(replayBegin.getUTCDate()-3);
      replayEnd.setUTCDate(replayEnd.getUTCDate()+1);
    }
    setSelectedEvent(p);
    setHistoricalReplayLead(6);
    setTimeMode("historic");
    setHistBegin(fmtInput(replayBegin));
    setHistEnd(fmtInput(replayEnd));
    setStorm(p.name);
    setTab(p.kind==="da"?"🔵 historical da replay":"◷ historical analog");
  },[]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const latestWL  = waterData.at(-1)?.v??null;
  const peakWL    = waterData.length?Math.max(...waterData.map(d=>d.v)):null;
  const latestRes = residuals.at(-1)?.v??null;
  const peakRes   = residuals.length?Math.max(...residuals.map(r=>r.v)):null;
  const wx0       = wxData[0];
  const mlPeak    = mlResult?Math.max(...mlResult.surge_m):null;
  const mlPeakLT  = mlResult?LEAD_TIMES[mlResult.surge_m.indexOf(Math.max(...mlResult.surge_m))]:null;

  // displayWL: respects impactSource selection so slider + header show the right value immediately
  const displayWL = useMemo(()=>{
    if(scenario!==null) return scenario;
    if(impactSource==="prob"&&impactForecast?.surge_members_m){
      if(probImpact) return probImpact.peakWaterLevelM.p50;
      if(!tideFc72.length) return 0;
      const members=peakWaterLevelMembersV5(impactForecast,tideFc72);
      return members.length?quantileV5(members,0.50):0;
    }
    if(impactSource==="ml"&&impactForecast?.ml_surge_m){
      if(!tideFc72.length) return 0;
      return Math.max(...totalWaterLevelAtLeadsV5(
        impactForecast.ml_surge_m,LEAD_TIMES,tideFc72,impactForecast.issued_at
      ));
    }
    return waterData.length?Math.max(...waterData.map(d=>d.v)):0;
  },[scenario,impactSource,impactForecast,probImpact,tideFc72,waterData]);

  // Extreme-aware DA best estimate at the nearest lead.
  const enkfBestSurge = enkfResult?.mean[0]??null;
  const activeLeadCount = mlResult?.da_active?.filter(Boolean).length??0;

  const periodLabel=timeMode==="historic"
    ? (storm ? `${histBegin} → ${histEnd} (${storm})` : `${histBegin} → ${histEnd}`)
    : "LIVE 24H";
  const stationInBackend=backend?.stations?.includes(station.id);
  const historicalAnalysisTab=selectedEvent?.kind==="analog"?"◷ historical analog":"🔵 historical da replay";
  const allTabs=[
    "overview",
    "timeseries",
    timeMode==="live"?"weather":null,
    timeMode==="live"||selectedEvent?.kind!=="analog"?"⚡ forecast":null,
    timeMode==="live"?"🔵 probabilistic":historicalAnalysisTab,
    "⚠ impact",
  ].filter(Boolean);

  // ── light mode theme ────────────────────────────────────────────────────────
  const lm = lightMode;
  return(
    <div className="achilleus-app" data-theme={lm?"light":"dark"} style={{minHeight:"100vh",background:lm?"#f3f7fb":"#07152a",fontFamily:"Inter, system-ui, sans-serif",color:lm?"#1a2a38":"#d7e5f4",transition:"background .25s,color .25s"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Barlow+Condensed:wght@300;500;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:${lm?"#dce8f0":"#09131c"}}::-webkit-scrollbar-thumb{background:${lm?"#8aaabb":"#1a3040"};border-radius:2px}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
        @keyframes pulse{0%,100%{opacity:.9}50%{opacity:.3}}
        .card{background:${lm?"#ffffff":"#10233f"};border:1px solid ${lm?"#d6e2ef":"#243b5d"};border-radius:3px;padding:14px 16px;transition:border-color .2s,background .25s}
        .card:hover{border-color:${lm?"#6aaccc":"#244050"}}
        .card-ml{background:${lm?"#eef6fc":"#102641"};border:1px solid ${lm?"#c4d9ef":"#243b5d"};border-radius:3px;padding:14px 16px}
        .card-enkf{background:${lm?"#eff5fd":"#101f3a"};border:1px solid ${lm?"#c4d9ef":"#243b5d"};border-radius:3px;padding:14px 16px;transition:border-color .2s,background .25s}
        .card-enkf:hover{border-color:${lm?"#9a70cc":"#4a2a66"}}
        .tab{background:none;border:none;padding:7px 18px;cursor:pointer;font-family:inherit;font-size:10.5px;letter-spacing:1.5px;text-transform:uppercase;color:${lm?"#6a8898":"#3a5568"};border-bottom:2px solid transparent;transition:all .2s}
        .tab.on{color:#087f9e;border-bottom-color:#087f9e}
        .tab.on-ml{color:${lm?"#2459a9":"#35bfd2"};border-bottom-color:${lm?"#2459a9":"#35bfd2"}}
        .tab.on-enkf{color:#2459a9;border-bottom-color:#2459a9}
        .tab:hover:not(.on):not(.on-ml):not(.on-enkf){color:${lm?"#3a5870":"#6a8a9a"}}
        .stbtn{background:${lm?"#ffffff":"#10233f"};border:1px solid ${lm?"#d6e2ef":"#243b5d"};padding:8px 12px;cursor:pointer;font-family:inherit;font-size:10px;color:${lm?"#5a7888":"#3a5568"};border-radius:2px;transition:all .15s;text-align:left}
        .stbtn.on{background:${lm?"#e0f4ff":"#0d2030"};border-color:#087f9e;color:${lm?"#007a99":"#32bad2"}}
        .stbtn:hover:not(.on){border-color:${lm?"#6aaccc":"#244050"};color:${lm?"#3a5870":"#6a8a9a"}}
        .btn{border:1px solid ${lm?"#d6e2ef":"#243b5d"};background:${lm?"#ffffff":"#10233f"};color:${lm?"#5a7888":"#6a8a9a"};padding:6px 14px;border-radius:2px;cursor:pointer;font-family:inherit;font-size:10px;letter-spacing:.8px;transition:all .15s}
        .btn:hover{border-color:#087f9e;color:${lm?"#007a99":"#32bad2"}}
        .btn:disabled{opacity:.35;cursor:not-allowed}
        .btn-ml{border:1px solid ${lm?"#c4d9ef":"#243b5d"};background:${lm?"#eef6fc":"#102641"};color:${lm?"#4a7a20":"#7a9a44"};padding:6px 14px;border-radius:2px;cursor:pointer;font-family:inherit;font-size:10px;letter-spacing:.8px;transition:all .15s}
        .btn-ml:hover{border-color:${lm?"#5a9a20":"#35bfd2"};color:${lm?"#3a7810":"#35bfd2"}}
        .btn-ml:disabled{opacity:.35;cursor:not-allowed}
        .btn-enkf{border:1px solid ${lm?"#c4d9ef":"#243b5d"};background:${lm?"#eff5fd":"#101f3a"};color:${lm?"#5481bd":"#5481bd"};padding:6px 14px;border-radius:2px;cursor:pointer;font-family:inherit;font-size:10px;letter-spacing:.8px;transition:all .15s}
        .btn-enkf:hover{border-color:#2459a9;color:${lm?"#2459a9":"#71a8f0"}}
        .btn-enkf:disabled{opacity:.35;cursor:not-allowed}
        .btn-enkf.active{border-color:#2459a9;color:${lm?"#2459a9":"#71a8f0"};background:${lm?"#e8e0f8":"#120a1e"}}
        .seg{border:1px solid ${lm?"#d6e2ef":"#243b5d"};background:${lm?"#ffffff":"#10233f"};color:${lm?"#5a7888":"#3a5568"};padding:5px 14px;cursor:pointer;font-family:inherit;font-size:10px;letter-spacing:.8px;transition:all .15s}
        .seg.on{background:${lm?"#e0f4ff":"#0a1e2c"};border-color:#087f9e;color:${lm?"#007a99":"#32bad2"}}
        .seg:first-child{border-radius:2px 0 0 2px}
        .seg:last-child{border-radius:0 2px 2px 0}
        .spin{width:12px;height:12px;border:2px solid ${lm?"#d6e2ef":"#243b5d"};border-top-color:#087f9e;border-radius:50%;animation:spin .8s linear infinite;display:inline-block;vertical-align:middle}
        .spin-ml{width:12px;height:12px;border:2px solid ${lm?"#c4d9ef":"#243b5d"};border-top-color:${lm?"#5a9a20":"#35bfd2"};border-radius:50%;animation:spin .8s linear infinite;display:inline-block;vertical-align:middle}
        .spin-enkf{width:12px;height:12px;border:2px solid ${lm?"#c4d9ef":"#243b5d"};border-top-color:#2459a9;border-radius:50%;animation:spin .8s linear infinite;display:inline-block;vertical-align:middle}
        .metric{background:${lm?"#ffffff":"#10233f"};border:1px solid ${lm?"#d6e2ef":"#243b5d"};border-radius:3px;padding:13px 15px;transition:border-color .2s,background .25s}
        .metric:hover{border-color:${lm?"#6aaccc":"#244050"}}
        .metric-enkf{background:${lm?"#eff5fd":"#101f3a"};border:1px solid ${lm?"#c4d9ef":"#243b5d"};border-radius:3px;padding:13px 15px;transition:border-color .2s}
        .metric-enkf:hover{border-color:${lm?"#9a70cc":"#4a2a66"}}
        .num{font-family:Inter,system-ui,sans-serif;font-size:29px;font-weight:300;line-height:1;letter-spacing:.5px}
        .lt-card{background:${lm?"#eef6fc":"#102641"};border:1px solid ${lm?"#c0d8a8":"#243b5d"};border-radius:2px;padding:10px 12px;flex:1;min-width:100px;text-align:center;transition:border-color .2s}
        .lt-card:hover{border-color:${lm?"#5a9830":"#2a4418"}}
        .enkf-lt-card{background:${lm?"#eff5fd":"#101f3a"};border:1px solid ${lm?"#c4d9ef":"#243b5d"};border-radius:2px;padding:10px 12px;flex:1;min-width:100px;text-align:center;transition:border-color .2s}
        .enkf-lt-card:hover{border-color:${lm?"#9a70cc":"#441a6a"}}
        input[type=date]{background:${lm?"#ffffff":"#10233f"};border:1px solid ${lm?"#d6e2ef":"#243b5d"};color:${lm?"#3a5870":"#6a8a9a"};padding:5px 9px;border-radius:2px;font-family:inherit;font-size:10px;outline:none}
        input[type=date]:focus{border-color:#087f9e}
        input[type=range]{-webkit-appearance:none;width:100%;height:3px;background:${lm?"#d6e2ef":"#243b5d"};border-radius:2px;outline:none}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;background:#087f9e;border-radius:50%;cursor:pointer}
        .chip{background:${lm?"#ffffff":"#10233f"};border:1px solid ${lm?"#d6e2ef":"#243b5d"};padding:5px 9px;border-radius:2px;cursor:pointer;font-family:inherit;font-size:9px;color:${lm?"#5a7888":"#3a5568"};transition:all .15s;white-space:nowrap}
        .chip:hover{border-color:#ff8800;color:#ff8800}
        .chip.on{border-color:#ff8800;color:#ff8800;background:${lm?"#fff4e0":"#120e00"}}
        .banner{border-radius:2px;padding:8px 14px;margin-bottom:12px;display:flex;align-items:center;gap:10px;font-size:10px;animation:fadeUp .3s ease}
        .banner-hist{background:${lm?"#f0f8e8":"#08100a"};border:1px solid ${lm?"#b0cc88":"#1e3010"};color:${lm?"#4a7820":"#6a9044"}}
        .banner-ml{background:${lm?"#eef8e8":"#06100a"};border:1px solid ${lm?"#a8cc80":"#1a3010"};color:${lm?"#3a7010":"#5a8a34"}}
        .banner-enkf{background:${lm?"#f4f0ff":"#101f3a"};border:1px solid ${lm?"#c8a8ee":"#3a1a55"};color:${lm?"#2459a9":"#8050aa"}}
        .banner-err{background:${lm?"#fff4e8":"#100800"};border:1px solid ${lm?"#e8c090":"#3a2000"};color:${lm?"#8a5010":"#9a6020"}}
        .enkf-matrix{font-size:9px;color:${lm?"#2459a9":"#5481bd"};font-family:monospace;line-height:1.6;background:${lm?"#f0ecff":"#06040c"};padding:8px 12px;border-radius:2px;border:1px solid ${lm?"#c8b0e8":"#1e1030"}}
      `}</style>

      {/* ── HEADER ── */}
      <div style={{background:lm?"#ffffff":"#07152a",borderBottom:`1px solid ${lm?"#d6e2ef":"#0e1e2a"}`,padding:"0 22px",transition:"background .25s"}}>
        <div style={{maxWidth:1440,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",height:62}}>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            {(ACHEILUS_LOGO_DARK || ACHEILUS_LOGO_LIGHT) ? (
              <img
                src={`data:image/png;base64,${ACHEILUS_LOGO_LIGHT}`}
                alt="ACHILLEUS coastal digital twin"
                width={54} height={54}
                style={{objectFit:"contain",display:"block",background:"#ffffff",borderRadius:12,padding:3}}
                onError={e=>{e.currentTarget.style.display="none";e.currentTarget.nextSibling.style.display="block";}}
              />
            ) : null}
            <svg width={20} height={20} viewBox="0 0 22 22" fill="none"
              style={{display: (ACHEILUS_LOGO_DARK || ACHEILUS_LOGO_LIGHT) ? "none" : "block"}}>
              <circle cx={11} cy={11} r={9} stroke="#087f9e" strokeWidth={1.5}/>
              <path d="M2 11 Q5 7 8 11 Q11 15 14 11 Q17 7 20 11" stroke="#087f9e" strokeWidth={1.2} fill="none"/>
              <circle cx={11} cy={11} r={2} fill="#087f9e" opacity={0.7}/>
            </svg>
            <span style={{fontFamily:"Inter,system-ui,sans-serif",fontWeight:700,fontSize:15,color:lm?"#102b5c":"#e6f0fb",letterSpacing:2,marginLeft:4}}>ACHILLEUS</span>
            <span style={{color:lm?"#9ab8c8":"#1e4060",fontSize:11}}>|</span>
            <span style={{fontSize:11,color:lm?"#6a8898":"#69819b",letterSpacing:2}}>Coastal digital twin · Princeton University</span>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            {loading.data&&<div className="spin"/>}
            {loading.enkf&&<div className="spin-enkf"/>}
            {/* Light / Dark toggle */}
            <button onClick={()=>setLightMode(m=>!m)} title={lm?"Switch to dark mode":"Switch to light mode"} style={{background:lm?"#e6f0fb":"#0c1820",border:`1px solid ${lm?"#a0c8dd":"#1e3848"}`,borderRadius:14,padding:"3px 10px",cursor:"pointer",fontSize:11,color:lm?"#1a4060":"#88aacc",transition:"all .2s",lineHeight:1,letterSpacing:0}}>
              {lm?"🌙 DARK":"☀ LIGHT"}
            </button>
            {lastUpd&&<span style={{fontSize:11,color:"#69819b"}}>{timeMode==="live"?`UPD ${lastUpd.toUTCString().slice(17,25)} UTC`:"HISTORIC"}</span>}
            {timeMode==="live"&&autoUpd&&nextUpdate&&<span style={{fontSize:11,color:"#1a3a50"}}>NEXT {nextUpdate.toUTCString().slice(17,22)} UTC</span>}
            {timeMode==="live"&&(
              <div style={{display:"flex",alignItems:"center",gap:5}}>
                <span style={{fontSize:11,color:"#69819b"}}>AUTO</span>
                <div onClick={()=>setAutoUpd(a=>!a)} style={{width:28,height:14,background:autoUpd?"#003344":"#0c1a24",border:`1px solid ${autoUpd?"#32bad2":"#1a3040"}`,borderRadius:7,cursor:"pointer",position:"relative",transition:"all .2s"}}>
                  <div style={{width:10,height:10,background:autoUpd?"#32bad2":"#1a3040",borderRadius:5,position:"absolute",top:1,left:autoUpd?15:1,transition:"left .2s"}}/>
                </div>
              </div>
            )}
            <button className="btn" onClick={loadData} disabled={loading.data}>↻ {timeMode==="live"?"REFRESH":"LOAD"}</button>
          </div>
        </div>
      </div>

      <div style={{maxWidth:1440,margin:"0 auto",padding:"28px 32px"}}>

        {/* Station selector */}
        <div style={{marginBottom:14}}>
          <div style={{fontSize:11,color:"#69819b",letterSpacing:2,marginBottom:7}}>SELECT TIDE GAUGE STATION (NOAA CO-OPS)</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {STATIONS.map((s,i)=>(
              <button key={s.id} className={`stbtn${i===stIdx?" on":""}`} onClick={()=>{setStIdx(i);setStorm(null);setSelectedEvent(null);}}>
                <div style={{fontWeight:500}}>{s.name}</div>
                <div style={{fontSize:11,opacity:.7}}>{s.region} · {s.id}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Time mode panel */}
        <div className="card" style={{marginBottom:14}}>
          <div style={{display:"flex",alignItems:"flex-start",gap:24,flexWrap:"wrap"}}>
            <div>
              <div style={{fontSize:11,color:"#69819b",letterSpacing:2,marginBottom:8}}>TIME MODE</div>
              <div style={{display:"flex"}}>
                <button className={`seg${timeMode==="live"?" on":""}`} onClick={()=>{setTimeMode("live");setStorm(null);setSelectedEvent(null);}}>● LIVE</button>
                <button className={`seg${timeMode==="historic"?" on":""}`} onClick={()=>{
                  if(histBegin<"2020-01-01"||histEnd>"2025-12-31"){
                    setHistBegin("2025-12-25");
                    setHistEnd("2025-12-31");
                  }
                  setTimeMode("historic");
                }}>◷ HISTORIC</button>
              </div>
            </div>
            {timeMode==="historic"&&(<>
              <div>
                <div style={{fontSize:11,color:"#69819b",letterSpacing:2,marginBottom:8}}>DATE RANGE (max 31 days)</div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <input type="date" value={histBegin} max={today} onChange={e=>{setHistBegin(e.target.value);setStorm(null);setSelectedEvent(null);}}/>
                  <span style={{fontSize:11,color:"#446677"}}>→</span>
                  <input type="date" value={histEnd} max={today} onChange={e=>{setHistEnd(e.target.value);setStorm(null);setSelectedEvent(null);}}/>
                  <button className="btn" onClick={loadData} disabled={loading.data} style={{marginLeft:4}}>
                    {loading.data?<><span className="spin" style={{width:10,height:10}}/> Loading…</>:"▶ LOAD PERIOD"}
                  </button>
                </div>
              </div>
              {presets.length>0&&(
                <div style={{flex:1}}>
                  <div style={{fontSize:11,color:"#69819b",letterSpacing:2,marginBottom:8}}>HISTORICAL EVENT LIBRARY</div>
                  {presets.some(p=>p.kind==="da")&&<>
                    <div style={{fontSize:11,color:"#7040a0",letterSpacing:1.3,margin:"0 0 5px"}}>DA STORM REPLAYS · 2020–2025</div>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:7}}>
                      {presets.filter(p=>p.kind==="da").map(p=>(
                        <button key={p.name} className={`chip${storm===p.name?" on":""}`} onClick={()=>applyPreset(p)} title={`${p.note}. Replay includes 72 hours of pre-event issuances.`}>
                          🔵 {p.name} <span style={{opacity:.5}}>({p.begin.slice(0,4)})</span>
                        </button>
                      ))}
                    </div>
                  </>}
                  {presets.some(p=>p.kind==="analog")&&<>
                    <div style={{fontSize:11,color:"#2a6070",letterSpacing:1.3,margin:"0 0 5px"}}>OBSERVED HISTORICAL ANALOGS · NO DA CLAIM</div>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                      {presets.filter(p=>p.kind==="analog").map(p=>(
                        <button key={p.name} className={`chip${storm===p.name?" on":""}`} onClick={()=>applyPreset(p)} title={p.note}>
                          ◷ {p.name} <span style={{opacity:.5}}>({p.begin.slice(0,4)})</span>
                        </button>
                      ))}
                    </div>
                  </>}
                  {selectedEvent&&<div style={{fontSize:11,color:selectedEvent.kind==="da"?"#8060aa":"#3a7080",marginTop:7}}>
                    {selectedEvent.note} · {selectedEvent.kind==="da"?"Includes 72 h of pre-event forecast issuances.":"Observed water level, surge, hazard, and impact only."}
                  </div>}
                </div>
              )}
            </>)}
          </div>
        </div>

        {timeMode==="historic"&&waterData.length>0&&(
          <div className="banner banner-hist">
            ◷ HISTORIC MODE · {periodLabel} · {waterData.length} observations ·
            {waterProduct==="hourly_height"?" NOAA verified hourly-height fallback":selectedEvent?.kind==="analog"?" observed historical analog · no DA evaluation":" read-only DA replay"}
          </div>
        )}
        {error&&<div style={{background:"#180008",border:"1px solid #480020",padding:"10px 16px",borderRadius:2,marginBottom:14,fontSize:11,color:"#ff5577"}}>⚠ {error}</div>}

        {/* Key metrics — 4 cards */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:14}}>
          {[
            {label:"WATER LEVEL",unit:timeMode==="live"?"m MLLW (latest)":"m MLLW (peak)",
              value:timeMode==="live"?(latestWL!==null?latestWL.toFixed(3):"—"):(peakWL!==null?peakWL.toFixed(3):"—"),
              color:"#32bad2",cls:"metric",
              sub:timeMode==="historic"&&waterData.length?`mean ${(waterData.reduce((a,b)=>a+b.v,0)/waterData.length).toFixed(2)} m`:(latestWL!==null?latestWL>1.5?"↑ ELEVATED":latestWL<0?"↓ BELOW DATUM":"NORMAL":"loading…")},
            {label:"SURGE RESIDUAL",unit:timeMode==="live"?"m (latest)":"m (peak)",
              value:timeMode==="live"?(latestRes!==null?(latestRes>0?"+":"")+latestRes.toFixed(3):"—"):(peakRes!==null?(peakRes>0?"+":"")+peakRes.toFixed(3):"—"),
              color:(timeMode==="live"?latestRes:peakRes)>0.3?"#ff8800":"#32bad2",cls:"metric",
              sub:(timeMode==="live"?latestRes:peakRes)>0.6?"⚠ SIGNIFICANT":(timeMode==="live"?latestRes:peakRes)>0.3?"ELEVATED":"TIDAL NORMAL"},
            {label:"EXTREME-AWARE DA PEAK",unit:mlResult?`+${mlPeakLT}h · ensemble prior`:"run ⚡ Forecast",
              value:mlPeak!==null?(mlPeak>0?"+":"")+mlPeak.toFixed(3):"—",
              color:mlPeak!==null?surgeColor(mlPeak):"#3a5568",cls:"metric",
              sub:mlPeak!==null?<span style={{background:surgeColor(mlPeak),color:"#fff",padding:"1px 8px",borderRadius:1,fontSize:11,letterSpacing:1.5,fontWeight:700}}>{riskLabel(mlPeak)}</span>:backend?.ok===false?"Backend offline":featureCols.length?`${featureCols.length} features`:"—"},
            {label:"PROBABILISTIC SURGE (+6h)",unit:enkfResult?`σ=±${(enkfResult.std[0]*100).toFixed(0)}cm · ${mlResult?.da_active?.[0]?"DA ACTIVE":"ENSEMBLE RETAINED"}`:"run forecast",
              value:enkfBestSurge!==null?(enkfBestSurge>0?"+":"")+enkfBestSurge.toFixed(3):"—",
              color:enkfBestSurge!==null?surgeColor(enkfBestSurge):"#5a3a88",cls:"metric-enkf",
              sub:enkfResult!==null?<span style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                <span style={{background:surgeColor(enkfBestSurge),color:"#fff",padding:"1px 8px",borderRadius:1,fontSize:11,letterSpacing:1.5,fontWeight:700}}>{riskLabel(enkfBestSurge)}</span>
                <span style={{fontSize:11,color:mlResult?.da_active?.[0]?"#71a8f0":"#00cc77"}}>{mlResult?.da_active?.[0]?"DA ACTIVE":"ENSEMBLE RETAINED"}</span>
              </span>:"—"},
          ].map(m=>(
            <div key={m.label} className={m.cls}>
              <div style={{fontSize:11,color:m.cls==="metric-enkf"?"#3a1a55":"#1e4055",letterSpacing:2,marginBottom:5}}>{m.label}</div>
              <div className="num" style={{color:m.color,fontSize:26}}>{m.value}</div>
              <div style={{fontSize:11,color:m.cls==="metric-enkf"?"#3a1a55":"#1e4055",marginTop:2}}>{m.unit}</div>
              <div style={{fontSize:11,color:"#446677",marginTop:6}}>{m.sub}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={{borderBottom:"1px solid #0e1e2a",marginBottom:14,display:"flex"}}>
          {allTabs.map(t=>(
            <button key={t}
              className={`tab${tab===t?((t.includes("probabilistic")||t.includes("historical da"))?" on-enkf":t.includes("forecast")?" on-ml":" on"):""}`}
              onClick={()=>setTab(t)}>
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        {/* ── OVERVIEW ── */}
        {tab==="overview"&&(
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
            <div className="card">
              <div style={{fontSize:11,color:"#1e4055",letterSpacing:2,marginBottom:9}}>WATER LEVEL · {periodLabel}</div>
              <Sparkline data={waterData} color="#32bad2" h={52}/>
              <div style={{display:"flex",justifyContent:"space-between",marginTop:5}}>
                <span style={{fontSize:11,color:"#1e4055"}}>MIN {waterData.length?Math.min(...waterData.map(d=>d.v)).toFixed(2):"—"} m</span>
                <span style={{fontSize:11,color:"#1e4055"}}>MAX {waterData.length?Math.max(...waterData.map(d=>d.v)).toFixed(2):"—"} m</span>
              </div>
            </div>
            <div className="card">
              <div style={{fontSize:11,color:"#1e4055",letterSpacing:2,marginBottom:9}}>SURGE RESIDUAL (OBS − TIDE) · {periodLabel}</div>
              <Sparkline label="Surge residual" unit="m" data={residuals} color={(timeMode==="live"?latestRes:peakRes)>0.3?"#ff8800":"#44aadd"} h={52} showZero/>
              <div style={{display:"flex",justifyContent:"space-between",marginTop:5}}>
                <span style={{fontSize:11,color:"#1e4055"}}>PEAK {residuals.length?Math.max(...residuals.map(d=>d.v)).toFixed(3):"—"} m</span>
                <span style={{fontSize:11,color:"#1e4055"}}>MEAN {residuals.length?(residuals.reduce((a,b)=>a+b.v,0)/residuals.length).toFixed(3):"—"} m</span>
              </div>
            </div>
            <div className="card" style={{gridColumn:"1/-1"}}>
              <div style={{fontSize:11,color:"#1e4055",letterSpacing:2,marginBottom:8}}>SESSION INFO</div>
              {[
                ["STATION",       `${station.name} (${station.id})`],
                ["MODE",          timeMode==="live"?"LIVE — real-time 24h rolling":`HISTORIC — ${periodLabel}`],
                ["OBSERVATIONS",  `${waterData.length} data points`],
                ["WATER PRODUCT", waterProduct==="hourly_height"?"NOAA verified hourly height (historical fallback)":"NOAA six-minute water level"],
                ["TIDE PREDS",    `${tideData.length} hourly predictions`],
                ["PEAK WL",       peakWL!==null?`${peakWL.toFixed(3)} m MLLW`:"—"],
                ["PEAK RESIDUAL", residuals.length?`${Math.max(...residuals.map(r=>r.v)).toFixed(3)} m`:"—"],
                ["EXTREME-AWARE DA",  mlResult?`${activeLeadCount}/5 lead gates active · ${mlResult.state_updates.reduce((a,b)=>a+b,0)} matured updates`:"Run forecast to evaluate gates"],
                ["ENSEMBLE",      mlResult?`N=${mlResult.ensemble_size} · ${mlResult.ensemble_strategy}`:"Forecast-conditioned Gaussian marginals"],
                ["BACKEND",       backend===null?"Checking…":backend.ok?`Online (${ML_BASE})`:"Temporarily unavailable — please retry"],
                ["SURGE PEAK",    mlResult?`${mlPeak>=0?"+":""}${mlPeak.toFixed(3)} m at +${mlPeakLT}h`:"—"],
                ["DATA SOURCES",  "NOAA CO-OPS · GFS forecasts · NWS weather · USGS/AWS terrain · Census 2020"],
              ].map(([k,v])=><DRow key={k} k={k} v={v}/>)}
            </div>
          </div>
        )}

        {/* ── TIMESERIES ── */}
        {tab==="timeseries"&&(
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div className="card">
              <div style={{fontSize:11,color:"#1e4055",letterSpacing:2,marginBottom:10}}>WATER LEVEL vs PREDICTED TIDE · {periodLabel}</div>
              {waterData.length||tideData.length
                ?<TideChart observed={waterData} predicted={tideData} isHistoric={timeMode==="historic"} label={periodLabel}/>
                :<div style={{color:"#1e4055",fontSize:11,padding:"20px 0"}}>No data — click Load / Refresh</div>}
              <div style={{fontSize:11,color:"#1e4055",marginTop:8}}>Datum: MLLW · Units: metres · NOAA CO-OPS {station.id}</div>
            </div>
            <div className="card">
              <div style={{fontSize:11,color:"#1e4055",letterSpacing:2,marginBottom:10}}>SURGE RESIDUAL (OBS − TIDE) · {periodLabel}</div>
              <Sparkline label="Surge residual" unit="m" data={residuals} color="#ff8800" h={72} showZero/>
              <div style={{fontSize:11,color:"#1e4055",marginTop:8}}>Peak {residuals.length?Math.max(...residuals.map(r=>r.v)).toFixed(3):"—"} m · Positive = meteorological surge above astronomical tide</div>
            </div>
          </div>
        )}

        {/* ── WEATHER ── */}
        {tab==="weather"&&timeMode==="live"&&(
          <div className="card">
            <div style={{fontSize:11,color:"#1e4055",letterSpacing:2,marginBottom:10}}>NWS HOURLY FORECAST · NEXT 24H</div>
            {!wxData.length&&<div style={{color:"#3a5568",fontSize:11,padding:"20px 0"}}>No forecast data.</div>}
            {wxData.slice(0,24).map((w,i)=>{
              const spd=parseWind(w.windSpeed),wc=spd>30?"#ff4466":spd>18?"#ff8800":"#32bad2";
              return(<div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:"1px solid #0e1e2a"}}>
                <span style={{fontSize:11,color:"#3a5568",width:46}}>{String(w.startTime||"").slice(11,16)}</span>
                <span style={{fontSize:11,color:"#88aacc",flex:1,paddingLeft:10}}>{w.shortForecast}</span>
                <span style={{fontSize:11,color:wc,width:80,textAlign:"right"}}>{w.windDirection} {w.windSpeed}</span>
                <span style={{fontSize:11,color:"#3a5568",width:44,textAlign:"right"}}>{w.temperature}°{w.temperatureUnit}</span>
              </div>);
            })}
          </div>
        )}

        {/* ── ⚡ FORECAST ── */}
        {tab==="⚡ forecast"&&(
          <div style={{display:"flex",flexDirection:"column",gap:14,animation:"fadeUp .35s ease"}}>
            {backend?.ok===false&&(
              <div className="banner banner-err">⚠ The forecasting service is temporarily unavailable. Please refresh or retry shortly.</div>
            )}
            {backend?.ok&&!stationInBackend&&(
              <div className="banner banner-err">⚠ The forecast model for this station is temporarily unavailable. Please retry shortly.</div>
            )}
            {backend?.ok&&stationInBackend&&timeMode==="live"&&!mlResult&&(
              <div className="banner banner-ml">● Backend online · {station.name} ready · {featureCols.length} features · Click ⚡ Run Forecast</div>
            )}
            {backend?.ok&&stationInBackend&&timeMode==="historic"&&!historicalReplay&&(
              <div className="banner banner-enkf">◷ Read-only rolling-origin replay ready · Select a date range within 2020–2025</div>
            )}
            <div className="card-ml">
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:12,marginBottom:10}}>
                <div>
                  <div style={{fontSize:11,color:timeMode==="live"?"#aacc66":"#71a8f0",letterSpacing:1}}>
                    {timeMode==="live"?"PROBABILISTIC SURGE FORECAST":"HISTORICAL DA REPLAY: 2020–2025"} · {station.name}
                  </div>
                  <div style={{fontSize:11,color:timeMode==="live"?"#4a6a20":"#5a3a88",marginTop:3}}>
                    {timeMode==="live"
                      ?"Four-model meta-stack prior · extreme-aware error-state EnKF · causal matured-error updates"
                      :"Precomputed annual rolling-origin evaluation · read-only · live operational state remains unchanged"}
                  </div>
                </div>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  {timeMode==="historic"&&<div style={{fontSize:11,color:"#8060aa",padding:"4px 9px",border:"1px solid #3a1a55",borderRadius:2}}>AVAILABLE 2020-01-01 → 2025-12-31</div>}
                  <button
                    className={timeMode==="live"?"btn-ml":"btn-enkf"}
                    onClick={timeMode==="live"?runML:runHistoricalReplay}
                    disabled={loading.ml||loading.replay||!backend?.ok||!stationInBackend}>
                    {timeMode==="live"
                      ?(loading.ml?<><span className="spin-ml" style={{width:10,height:10}}/> {mlStat}</>:"⚡ RUN FORECAST")
                      :(loading.replay?<><span className="spin-enkf" style={{width:10,height:10}}/> Loading replay…</>:"◷ LOAD HISTORICAL DA REPLAY")}
                  </button>
                </div>
              </div>
              {timeMode==="live"&&mlErr&&<div style={{background:"#100800",border:"1px solid #3a2000",borderRadius:2,padding:"8px 12px",fontSize:11,color:"#cc8844",marginTop:6}}>⚠ {mlErr}</div>}
              {timeMode==="historic"&&historicalReplayError&&<div style={{background:"#100800",border:"1px solid #3a2000",borderRadius:2,padding:"8px 12px",fontSize:11,color:"#cc8844",marginTop:6}}>⚠ {historicalReplayError}</div>}
              {timeMode==="live"&&!mlResult&&!loading.ml&&!mlErr&&<div style={{textAlign:"center",padding:"28px 0",color:"#2a3a18",fontSize:11}}>Run the forecast to generate probabilistic surge predictions at +6h, +12h, +24h, +48h, and +72h</div>}
              {timeMode==="historic"&&!historicalReplay&&!loading.replay&&!historicalReplayError&&<div style={{textAlign:"center",padding:"28px 0",color:"#4a2a66",fontSize:11}}>Load the selected period to inspect observed, meta-stack, and extreme-aware-DA trajectories at all five lead times.</div>}
              {loading.ml&&<div style={{display:"flex",gap:10,padding:"18px 0",color:"#5a7a30",fontSize:11,alignItems:"center"}}><div className="spin-ml"/> {mlStat}</div>}
              {loading.replay&&<div style={{display:"flex",gap:10,padding:"18px 0",color:"#8060aa",fontSize:11,alignItems:"center"}}><div className="spin-enkf"/> Loading read-only replay…</div>}
            </div>
            {timeMode==="live"&&mlResult&&(<>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {LEAD_TIMES.map((lt,i)=>{
                  const s=mlResult.surge_m[i],t=tideAtLeadV5(tideFc72,lt,mlResult.issued_at),col=surgeColor(s);
                  return(<div key={lt} className="lt-card">
                    <div style={{fontSize:11,color:"#3a5030",letterSpacing:2,marginBottom:5}}>+{lt}H LEAD</div>
                    <div style={{fontSize:22,fontWeight:300,color:col,fontFamily:"Inter,system-ui,sans-serif",lineHeight:1}}>{s>=0?"+":""}{s.toFixed(2)}<span style={{fontSize:11,color:"#446654"}}> m surge</span></div>
                    <div style={{fontSize:11,color:mlResult.da_active[i]?"#71a8f0":"#00aa77",marginTop:4}}>{mlResult.da_active[i]?`DA ACTIVE · ${mlResult.gate_name[i]}`:"ENSEMBLE RETAINED"}</div>
                    <div style={{fontSize:11,color:"#446654",marginTop:5}}>Tide: {t.toFixed(2)} m</div>
                    <div style={{fontSize:11,color:"#88aacc",marginTop:2,fontWeight:500}}>WL: {(t+s).toFixed(2)} m</div>
                    {s>=ALERT.low&&<div style={{fontSize:11,color:col,marginTop:5,letterSpacing:1}}>{riskLabel(s)}</div>}
                  </div>);
                })}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"3fr 2fr",gap:14}}>
                <div className="card">
                  <div style={{fontSize:11,color:"#1e4055",letterSpacing:2,marginBottom:10}}>TOTAL WATER LEVEL · Time-aligned Tide + Surge · {station.name}</div>
                  <ForecastChart tideFc={tideFc72} surgeML={mlResult.surge_m} sigma={mlResult.sigma_m} modelName="Extreme-aware DA" issuedAt={mlResult.issued_at}/>
                  <div style={{fontSize:11,color:"#1e4055",marginTop:8}}>WL(h) = NOAA tide(h) + surge(h) · Datum: MLLW · forecast-conditioned uncertainty</div>
                </div>
                <div className="card">
                  <div style={{fontSize:11,color:"#1e4055",letterSpacing:2,marginBottom:10}}>FORECAST DIAGNOSTICS</div>
                  {[
                    ["MODEL",          mlResult.model],
                    ["FEATURES SENT",  `${mlResult.n_features_provided} / ${mlResult.n_features}`],
                    ["DA GATES",       `${activeLeadCount}/5 active · ${mlResult.gate_name.join(", ")}`],
                    ["MATURED UPDATES",`${mlResult.matured_updates.length} this cycle · ${mlResult.state_updates.reduce((a,b)=>a+b,0)} retained`],
                    ["UNCERTAINTY",    `N=${mlResult.ensemble_size} deterministic quantile members`],
                    ["PEAK SURGE",     `${mlPeak>=0?"+":""}${mlPeak?.toFixed(3)} m at +${mlPeakLT}h`],
                    ["SCOPE",          "Water-level uncertainty only"],
                  ].map(([k,v])=><DRow key={k} k={k} v={v}/>)}
                </div>
              </div>
            </>)}
          </div>
        )}

        {/* ── ◷ OBSERVED HISTORICAL ANALOG ── */}
        {tab==="◷ historical analog"&&selectedEvent?.kind==="analog"&&(
          <div style={{display:"flex",flexDirection:"column",gap:14,animation:"fadeUp .35s ease"}}>
            <div className="card">
              <div style={{display:"flex",justifyContent:"space-between",gap:14,flexWrap:"wrap"}}>
                <div>
                  <div style={{fontSize:11,color:"#087f9e",letterSpacing:1}}>OBSERVED HISTORICAL ANALOG · {selectedEvent.name}</div>
                  <div style={{fontSize:11,color:"#3a6070",marginTop:5}}>Measured NOAA water level and tide-residual replay · no out-of-sample DA evaluation</div>
                </div>
                <div style={{fontSize:11,color:"#3a6070",textAlign:"right"}}>
                  <div>{station.name}</div>
                  <div style={{marginTop:3}}>{fmtInput(yyyymmddToDate(selectedEvent.begin))} → {fmtInput(yyyymmddToDate(selectedEvent.end))}</div>
                </div>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
              {[
                ["OBSERVATIONS",`${waterData.length} values`],
                ["NOAA PRODUCT",waterProduct==="hourly_height"?"Verified hourly height":"Six-minute water level"],
                ["PEAK WATER LEVEL",peakWL!==null?`${peakWL.toFixed(3)} m MLLW`:"—"],
                ["PEAK SURGE RESIDUAL",peakRes!==null?`${peakRes>=0?"+":""}${peakRes.toFixed(3)} m`:"—"],
              ].map(([label,value])=><div key={label} className="metric"><div style={{fontSize:11,color:"#1e4055",letterSpacing:1.5}}>{label}</div><div style={{fontSize:17,color:"#087f9e",marginTop:6,fontFamily:"Inter,system-ui,sans-serif"}}>{value}</div></div>)}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
              <div className="card">
                <div style={{fontSize:11,color:"#1e4055",letterSpacing:2,marginBottom:9}}>OBSERVED WATER LEVEL</div>
                <Sparkline data={waterData} color="#32bad2" h={72}/>
              </div>
              <div className="card">
                <div style={{fontSize:11,color:"#1e4055",letterSpacing:2,marginBottom:9}}>OBSERVED SURGE RESIDUAL</div>
                <Sparkline label="Surge residual" unit="m" data={residuals} color="#ff8800" h={72} showZero/>
              </div>
            </div>
            <div className="banner banner-hist" style={{justifyContent:"space-between",flexWrap:"wrap"}}>
              <span>{selectedEvent.note}. This event can drive observed-peak hazard and impact replay, but it is not evidence for DA skill.</span>
              <span style={{display:"flex",gap:7}}>
                <button className="btn" onClick={()=>setTab("timeseries")}>VIEW TIMESERIES</button>
                <button className="btn" onClick={()=>setTab("⚠ impact")}>RUN OBSERVED IMPACT</button>
              </span>
            </div>
          </div>
        )}

        {/* ── 🔵 HISTORICAL DA REPLAY ── */}
        {tab==="🔵 historical da replay"&&(
          <div style={{display:"flex",flexDirection:"column",gap:14,animation:"fadeUp .35s ease"}}>
            {historicalReplayError&&(
              <div className="banner banner-err">⚠ {historicalReplayError}</div>
            )}
            {!historicalReplay&&(
              <div className="card-enkf">
                <div style={{fontSize:11,color:"#71a8f0",letterSpacing:1}}>HISTORICAL DA REPLAY: 2020–2025</div>
                <div style={{fontSize:11,color:"#5a3a88",marginTop:5,lineHeight:1.7}}>
                  Select a period of up to 31 days, then load the precomputed annual rolling-origin evaluation.
                  The replay reads saved results only and never changes the live EnKF state.
                </div>
                <button className="btn-enkf" style={{marginTop:12}} onClick={runHistoricalReplay} disabled={loading.replay||!backend?.ok||!stationInBackend}>
                  {loading.replay?<><span className="spin-enkf" style={{width:10,height:10}}/> Loading replay…</>:"◷ LOAD SELECTED PERIOD"}
                </button>
              </div>
            )}
            {historicalReplay&&(
              <HistoricalReplayPanelV2
                replay={historicalReplay}
                event={selectedEvent?.kind==="da"?selectedEvent:null}
                leadHours={historicalReplayLead}
                onLeadChange={setHistoricalReplayLead}
                selectedIndex={historicalReplayIndex}
                onIndexChange={setHistoricalReplayIndex}
                lm={lm}
              />
            )}
          </div>
        )}

        {/* ── 🔵 PROBABILISTIC TAB ── */}
        {tab==="🔵 probabilistic"&&(
          <div style={{display:"flex",flexDirection:"column",gap:14,animation:"fadeUp .35s ease"}}>
            {!mlResult&&(
              <div className="banner banner-enkf">Run the forecast first. The backend will evaluate the extreme gates, assimilate any matured forecast errors, and return 101 probabilistic members.</div>
            )}
            {mlResult&&(<>
              <div className="card-enkf">
                <div style={{display:"flex",justifyContent:"space-between",gap:14,flexWrap:"wrap"}}>
                  <div>
                    <div style={{fontSize:11,color:"#71a8f0",letterSpacing:1}}>EXTREME-AWARE META-STACK-CENTERED ERROR-STATE EnKF</div>
                    <div style={{fontSize:11,color:"#5a3a88",marginTop:4}}>The ensemble forecast is retained in normal conditions; only matured, causal forecast errors update the lead-specific bias states.</div>
                  </div>
                  <div style={{textAlign:"right",fontSize:11,color:"#5a3a88"}}>
                    <div>{activeLeadCount}/5 GATES ACTIVE</div>
                    <div style={{marginTop:3}}>UPDATED {enkfLastUpdated?.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</div>
                  </div>
                </div>
              </div>

              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {LEAD_TIMES.map((lt,j)=>{
                  const s=enkfResult.mean[j], sigma=enkfResult.std[j];
                  const p10=enkfResult.p10[j], p90=enkfResult.p90[j];
                  const col=surgeColor(s);
                  const tide=tideAtLeadV5(tideFc72,lt,mlResult.issued_at);
                  return(
                    <div key={lt} className="enkf-lt-card">
                      <div style={{fontSize:11,color:"#3a1a55",letterSpacing:2,marginBottom:5}}>+{lt}H LEAD</div>
                      <div style={{fontSize:20,fontWeight:300,color:col,fontFamily:"Inter,system-ui,sans-serif",lineHeight:1}}>
                        {s>=0?"+":""}{s.toFixed(2)}<span style={{fontSize:11,color:"#5a3a88"}}> m</span>
                      </div>
                      <div style={{fontSize:11,color:"#5a3a88",marginTop:4}}>σ = ±{(sigma*100).toFixed(0)} cm</div>
                      <div style={{fontSize:11,color:"#4a2a55",marginTop:2}}>p10: {p10.toFixed(2)} | p90: {p90.toFixed(2)}</div>
                      <div style={{fontSize:11,color:mlResult.da_active[j]?"#71a8f0":"#00aa77",marginTop:3}}>{mlResult.da_active[j]?`ACTIVE · ${mlResult.gate_name[j]}`:"ENSEMBLE RETAINED"}</div>
                      <div style={{fontSize:11,color:"#4a2a55",marginTop:2}}>correction {mlResult.da_correction_m[j]>=0?"+":""}{mlResult.da_correction_m[j].toFixed(3)} m · updates {mlResult.state_updates[j]}</div>
                      {tide>0&&<div style={{fontSize:11,color:"#5a3a88",marginTop:2}}>WL: {(tide+s).toFixed(2)} m</div>}
                      {/* Uncertainty bar */}
                      <div style={{height:3,background:"#1a0a2a",borderRadius:1,margin:"7px 0 4px",position:"relative"}}>
                        <div style={{height:3,position:"absolute",left:`${Math.max(0,(p10/1.5+0.5)*50)}%`,width:`${Math.min(((p90-p10)/1.5)*50,100)}%`,background:"#71a8f0",borderRadius:1,opacity:0.7}}/>
                        <div style={{height:3,width:`${Math.min(Math.abs(s)/1.5*50+50,100)}%`,background:col,borderRadius:1,opacity:0.5}}/>
                      </div>
                      {s>=ALERT.low&&<div style={{fontSize:11,color:col,letterSpacing:1}}>{riskLabel(s)}</div>}
                    </div>
                  );
                })}
              </div>

              <div style={{display:"grid",gridTemplateColumns:"3fr 2fr",gap:14}}>
                <div className="card-enkf">
                  <div style={{fontSize:11,color:"#3a1a55",letterSpacing:2,marginBottom:10}}>
                    PROBABILISTIC TOTAL WATER LEVEL · {station.name}
                  </div>
                  <EnKFForecastChart tideFc={tideFc72} enkfResult={enkfResult} mlResult={{surge_m:mlResult.ml_surge_m}} issuedAt={mlResult.issued_at}/>
                  <div style={{fontSize:11,color:"#3a1a55",marginTop:8}}>
                    Purple = extreme-aware-DA mean and p10–p90 · Orange dashed = meta-stack prior · tide and surge are aligned by valid lead time
                  </div>
                </div>
                <div className="card-enkf">
                  <div style={{fontSize:11,color:"#3a1a55",letterSpacing:2,marginBottom:12}}>OPERATIONAL STATE</div>
                  <div>
                    {[
                      ["ENSEMBLE PRIOR",    "Four-model meta-stack"],
                      ["ACTIVE LEADS",      `${activeLeadCount} of 5`],
                      ["MEMBERS",           `${mlResult.ensemble_size} reproducible quantiles`],
                      ["COUPLING",          "Conservative common-rank across leads"],
                      ["PARAMETER VINTAGE", mlResult.parameter_vintage],
                      ["LATEST UPDATES",    `${mlResult.matured_updates.length} matured errors`],
                      ["UNCERTAINTY SCOPE", "Forecast water level only"],
                    ].map(([k,v])=><DRow key={k} k={k} v={v} vCol="#88aacc"/>)}
                  </div>
                </div>
              </div>
            </>)}
          </div>
        )}

        {/* ── ⚠ IMPACT ── */}
        {tab==="⚠ impact"&&(
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div className="card">
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,flexWrap:"wrap",gap:12}}>
                <div style={{display:"flex",alignItems:"flex-start",gap:20,flexWrap:"wrap"}}>
                  <div>
                    <div style={{fontSize:11,color:"#88aacc",letterSpacing:1}}>FLOOD IMPACT ASSESSMENT</div>
                    <div style={{fontSize:11,color:"#1e4055",marginTop:2}}>
                      AWS/USGS terrain · MSCC or c-HAND · Census 2020 · HAZUS depth-damage
                    </div>
                  </div>
                  <div>
                    <div style={{fontSize:11,color:"#1e4055",letterSpacing:2,marginBottom:5}}>DEM RESOLUTION</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:2}}>
                      <button className={`seg${demRes==="17m"?" on":""}`} onClick={()=>setDemRes("17m")} title="AWS Terrarium z13 ~17m — fastest, wide area">17m AWS</button>
                      <button className={`seg${demRes==="8m"?" on":""}`}  onClick={()=>setDemRes("8m")}  title="AWS Terrarium z14 ~8m — good detail">8m AWS</button>
                      <button className={`seg${demRes==="3m"?" on":""}`}  onClick={()=>setDemRes("3m")}  title="USGS 3DEP ⅓ arc-sec ~3m — high quality, slower">3m USGS</button>
                      <button className={`seg${demRes==="1m"?" on":""}`}  onClick={()=>setDemRes("1m")}  title="USGS 3DEP 1m lidar — best quality, coverage may vary">1m USGS</button>
                    </div>
                    <div style={{fontSize:11,color:"#1e4055",marginTop:3,opacity:0.7}}>
                      {demRes==="17m"?"AWS · wide bbox · fastest":demRes==="8m"?"AWS · detail bbox · fast":demRes==="3m"?"USGS 3DEP · tiled requests · ~30s":demRes==="1m"?"USGS 3DEP lidar · where available · ~60s":""}
                    </div>
                  </div>
                  <div>
                    <div style={{fontSize:11,color:"#1e4055",letterSpacing:2,marginBottom:5}}>FLOOD MODEL</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:2}}>
                      <button className={`seg${floodMethod==="hand_connectivity"?" on":""}`} onClick={()=>{
                        setFloodMethod("hand_connectivity");setBtub(null);setImpact(null);setProbImpact(null);
                      }} title="Terrain below the water surface with four-neighbor coastal connectivity">MSCC</button>
                      <button className={`seg${floodMethod==="c_hand"?" on":""}`} onClick={()=>{
                        setFloodMethod("c_hand");setBtub(null);setImpact(null);setProbImpact(null);
                      }} title="Alternative coastal HAND connectivity formulation">c-HAND</button>
                    </div>
                    <div style={{fontSize:11,color:"#1e4055",marginTop:3,opacity:0.7}}>
                      {floodMethod==="hand_connectivity"?"Four-neighbor boundary-connected flood mask":"Connectivity-aware alternative"}
                    </div>
                  </div>
                </div>
                <button className="btn" onClick={runImpact} disabled={loading.impact}>
                  {loading.impact?<><span className="spin" style={{width:10,height:10}}/> {impStat}</>:"▶ RUN IMPACT"}
                </button>
              </div>

              {/* ── IMPACT SOURCE RADIO SWITCH ── */}
              <div style={{background:lm?"#f4f8fc":"#07101a",border:`1px solid ${lm?"#c0d4e4":"#0e2030"}`,borderRadius:3,padding:"10px 14px",marginBottom:12}}>
                <div style={{fontSize:11,color:"#1e4055",letterSpacing:2,marginBottom:8}}>IMPACT WATER LEVEL SOURCE</div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {[
                    {
                      value:"live",
                      label:timeMode==="historic"?"Observed Event Peak":"Live Data",
                      icon:timeMode==="historic"?"◷":"📡",
                      desc:`NOAA ${waterProduct==="hourly_height"?"hourly ":""}obs peak · ${peakWL!=null?peakWL.toFixed(3)+" m":"-"}`,
                      available: waterData.length>0,
                      color:"#087f9e",
                    },
                    {
                      value:"ml",
                      label:"Ensemble Baseline",
                      icon:"⚡",
                      desc: impactForecast?"Meta-stack time-aligned deterministic peak":"Load or run forecast first",
                      available: !!impactForecast,
                      color:"#35bfd2",
                    },
                    {
                      value:"prob",
                      label:"Extreme-aware DA",
                      icon:"🔵",
                      desc: impactForecast?`${impactForecast.ensemble_size} members · ${impactForecast.da_active?.some(Boolean)?"active correction":"ML retained"} · conditional p10–p90 impacts`:"Load or run forecast first",
                      available: !!impactForecast,
                      color:"#71a8f0",
                    },
                  ].map(src=>(
                    <label key={src.value} style={{
                      display:"flex",alignItems:"flex-start",gap:9,
                      padding:"8px 12px",borderRadius:3,cursor:src.available?"pointer":"not-allowed",
                      border:`1px solid ${!src.available?(lm?"#d6e2ef":"#0e2030"):impactSource===src.value?src.color:(lm?"#d6e2ef":"#1e3040")}`,
                      background:!src.available?(lm?"#f4f4f4":"#04080c"):impactSource===src.value?(lm?`${src.color}18`:`${src.color}12`):(lm?"#ffffff":"#10233f"),
                      opacity:src.available?1:0.45,
                      transition:"all .15s",
                      flex:"1 1 180px",
                      minWidth:160,
                    }}>
                      <input
                        type="radio"
                        name="impactSource"
                        value={src.value}
                        checked={impactSource===src.value}
                        disabled={!src.available}
                        onChange={()=>{
                          if(src.available){
                            setImpactSource(src.value);
                            setScenario(null);
                            // Show a representative water level immediately. Run Impact
                            // performs the full member-wise probabilistic propagation.
                            if(Boolean(elevGrid)&&census&&(src.value==="live"||tideFc72.length)){
                              let wl;
                              if(src.value==="prob"&&impactForecast){
                                const members=peakWaterLevelMembersV5(impactForecast,tideFc72);
                                wl=quantileV5(members,0.50);
                              } else if(src.value==="ml"&&impactForecast?.ml_surge_m){
                                wl=Math.max(...totalWaterLevelAtLeadsV5(
                                  impactForecast.ml_surge_m,LEAD_TIMES,tideFc72,impactForecast.issued_at
                                ));
                              } else {
                                wl=Math.max(peakWL??0,0);
                              }
                              rerunFlood(wl);
                            }
                          }
                        }}
                        style={{marginTop:2,accentColor:src.color,cursor:src.available?"pointer":"not-allowed"}}
                      />
                      <div>
                        <div style={{fontSize:11,color:src.available?(impactSource===src.value?src.color:(lm?"#3a5870":"#88aacc")):(lm?"#8aacbc":"#2a4050"),fontWeight:500,letterSpacing:.5}}>
                          {src.icon} {src.label}
                        </div>
                        <div style={{fontSize:11,color:src.available?(lm?"#5a7888":"#3a6070"):(lm?"#8aacbc":"#1e3040"),marginTop:2}}>
                          {src.desc}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {Boolean(elevGrid)&&(
                <div style={{marginTop:8}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                    <span style={{fontSize:11,color:"#1e4055",letterSpacing:1}}>TOTAL WATER SURFACE (MLLW)</span>
                    <span style={{fontSize:11,color:"#32bad2",fontFamily:"Inter,system-ui,sans-serif"}}>{(scenario!==null?scenario:displayWL).toFixed(2)} m</span>
                  </div>
                  <input type="range" min={0} max={5} step={0.05}
                    value={scenario!==null?scenario:Math.min(displayWL,5)}
                    disabled={loading.impact} onChange={e=>{const v=parseFloat(e.target.value);setScenario(v);clearTimeout(impactTimer.current);impactTimer.current=setTimeout(()=>rerunFlood(v),350);}}/>
                  <div style={{display:"flex",justifyContent:"space-between",marginTop:3}}>
                    <span style={{fontSize:11,color:"#1e4055"}}>0 m</span>
                    <span style={{fontSize:11,color:"#ff8800"}}>2.5 m (major)</span>
                    <span style={{fontSize:11,color:"#ff2244"}}>5.0 m (catastrophic)</span>
                  </div>
                </div>
              )}
              {!btub&&!loading.impact&&(
                <div style={{textAlign:"center",padding:"28px 0",color:"#1e4055",fontSize:11}}>
                  {impactForecast?"🔵 Extreme-aware-DA forecast loaded — click Run Impact to propagate all members":"Load or run a forecast, then click Run Impact"}
                </div>
              )}
              {loading.impact&&<div style={{display:"flex",gap:10,padding:"14px 0",color:"#3a5568",fontSize:11,alignItems:"center"}}><div className="spin"/> {impStat}</div>}
            </div>

            {btub&&impact&&census&&(<>
              <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10}}>
                {[
                  {label:"AFFECTED POPULATION",value:Math.round(probImpact?.impact.affectedPopulation.p50??impact.affPop).toLocaleString(),unit:"people",color:"#ff8800",sub:probImpact?`p10–p90: ${Math.round(probImpact.impact.affectedPopulation.p10).toLocaleString()}–${Math.round(probImpact.impact.affectedPopulation.p90).toLocaleString()}`:`of ${census.totalPop.toLocaleString()} county total`},
                  {label:"DEEP-FLOOD POPULATION PROXY (>1m)",value:Math.round(probImpact?.impact.displacedPopulation.p50??impact.displaced).toLocaleString(),unit:"county-scaled exposure indicator",color:"#ff4466",sub:probImpact?`p10–p90: ${Math.round(probImpact.impact.displacedPopulation.p10).toLocaleString()}–${Math.round(probImpact.impact.displacedPopulation.p90).toLocaleString()}`:"uniform population allocation"},
                  {label:"HOUSING UNITS AT RISK",value:Math.round(probImpact?.impact.housingUnitsAtRisk.p50??impact.affUnits).toLocaleString(),unit:"units",color:"#ffcc00",sub:probImpact?`p10–p90: ${Math.round(probImpact.impact.housingUnitsAtRisk.p10).toLocaleString()}–${Math.round(probImpact.impact.housingUnitsAtRisk.p90).toLocaleString()}`:`of ${census.totalUnits.toLocaleString()} county total`},
                  {label:"VALUE-WEIGHTED DAMAGE RATIO",value:`${(probImpact?.impact.meanDamageRatioPct.p50??impact.avgDamage).toFixed(1)}%`,unit:"HAZUS depth-damage",color:"#4d88d6",sub:probImpact?`p10–p90: ${probImpact.impact.meanDamageRatioPct.p10.toFixed(1)}–${probImpact.impact.meanDamageRatioPct.p90.toFixed(1)}%`:"local NSI depths and structure values"},
                  {label:"PROPERTY DAMAGE",value:`$${((probImpact?.impact.propertyDamageUsd.p50??impact.damage)/1e6).toFixed(1)}M`,unit:"USD (HAZUS × NSI)",color:"#ff6644",sub:probImpact?`p10–p90: $${(probImpact.impact.propertyDamageUsd.p10/1e6).toFixed(1)}M–$${(probImpact.impact.propertyDamageUsd.p90/1e6).toFixed(1)}M`:`${(impact.floodedRecords??0).toLocaleString()} flooded NSI residential records`},
                ].map(m=>(
                  <div key={m.label} className="metric">
                    <div style={{fontSize:11,color:"#1e4055",letterSpacing:2,marginBottom:5}}>{m.label}</div>
                    <div className="num" style={{color:m.color}}>{m.value}</div>
                    <div style={{fontSize:11,color:"#1e4055",marginTop:2}}>{m.unit}</div>
                    <div style={{fontSize:11,color:"#446677",marginTop:5}}>{m.sub}</div>
                  </div>
                ))}
              </div>
              {/* Full-width inundation map */}
              <div className="card">
                <div style={{fontSize:11,color:"#1e4055",letterSpacing:2,marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span>INUNDATION MAP · {station.city} · WL={btub.wl.toFixed(2)} m MLLW
                    {probImpact&&scenario===null&&<span style={{color:"#5481bd"}}> · predictive p50 peak</span>}
                    {probImpact&&scenario!==null&&<span style={{color:"#5481bd"}}> · p90 planning scenario</span>}
                  </span>
                  <span style={{display:"flex",gap:6,alignItems:"center"}}>
                    {probImpact&&<>
                      <button className="btn-enkf" onClick={()=>{
                        setScenario(null);
                        setBtub(probImpact.representativeP50);
                        setImpact(probImpact.impactP50);
                      }}>P50 MAP</button>
                      <button className="btn-enkf" onClick={()=>{
                        setScenario(probImpact.peakWaterLevelM.p90);
                        setBtub(probImpact.representativeP90);
                        setImpact(probImpact.impactP90);
                      }}>P90 PLANNING MAP</button>
                    </>}
                    <span style={{fontSize:11,color:"#69819b",letterSpacing:1}}>pan, zoom or tap to inspect</span>
                  </span>
                </div>
                <FloodMap grid={elevGrid} floodResult={btub} probabilityPng={probImpact?.probability_png} station={station} dark={!lm}/>
              </div>

              {probImpact&&(
                <div className="card-enkf">
                  <div style={{fontSize:11,color:"#3a1a55",letterSpacing:2,marginBottom:12}}>PROBABILISTIC HAZARD SUMMARY</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
                    <DRow k="PEAK WATER LEVEL" v={`${probImpact.peakWaterLevelM.p50.toFixed(2)} m p50 · ${probImpact.peakWaterLevelM.p10.toFixed(2)}–${probImpact.peakWaterLevelM.p90.toFixed(2)} m p10–p90`}/>
                    <DRow k="FLOOD EXTENT" v={`${probImpact.hazard.floodKm2.p50.toFixed(2)} km² p50 · ${probImpact.hazard.floodKm2.p10.toFixed(2)}–${probImpact.hazard.floodKm2.p90.toFixed(2)} km²`}/>
                    <DRow k="LIKELY FLOOD CELLS" v={`${(probImpact.previewCounts?.likelyFloodCells??0).toLocaleString()} map samples with P(flood) ≥ 0.5`}/>
                    <DRow k="HIGH-CONFIDENCE DEEP" v={`${(probImpact.previewCounts?.highConfidenceDeep??0).toLocaleString()} map samples with P(depth > 1 m) ≥ 0.9`}/>
                    <DRow k="DA STATUS" v={probImpact.daActiveLeads.length?`Active at +${probImpact.daActiveLeads.join("h, +")}h`:"Gates inactive · meta-stack retained"}/>
                    <DRow k="FLOOD MODEL" v={probImpact.representativeP50.modelInfo}/>
                  </div>
                  <div style={{fontSize:11,color:"#5a3a88",marginTop:10}}>{probImpact.uncertaintyScope}</div>
                </div>
              )}

              {/* Stats row below map */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
                <div className="card">
                  <div style={{fontSize:11,color:"#1e4055",letterSpacing:2,marginBottom:12}}>FLOOD DEPTH DISTRIBUTION</div>
                  <DepthBar label="Shallow  0–0.3 m"    count={btub.shallow}   total={btub.totalCells} color="#00aadd"/>
                  <DepthBar label="Moderate 0.3–1.0 m"  count={btub.moderate}  total={btub.totalCells} color="#ff8800"/>
                  <DepthBar label="Deep  >1.0 m" count={btub.deep}      total={btub.totalCells} color="#ff2244"/>
                  <DepthBar label="Dry land"             count={btub.totalCells-btub.floodedCells} total={btub.totalCells} color="#2a6030"/>
                </div>
                <div className="card">
                  <div style={{fontSize:11,color:"#1e4055",letterSpacing:2,marginBottom:12}}>FLOOD STATISTICS</div>
                  {[
                    ["FLOOD EXTENT",    probImpact?`${probImpact.hazard.floodKm2.p50.toFixed(2)} km² p50 (${probImpact.hazard.floodKm2.p10.toFixed(2)}–${probImpact.hazard.floodKm2.p90.toFixed(2)})`:`${btub.floodKm2.toFixed(2)} km²`],
                    ["FLOOD FRACTION",  `${(btub.floodFrac*100).toFixed(1)}%`],
                    ["MEAN DEPTH",      `${btub.meanDepth.toFixed(2)} m`],
                    ["MAX DEPTH",       `${btub.maxDepth.toFixed(2)} m`],
                    ["ELEV RANGE",      `${btub.elevMin.toFixed(2)} – ${btub.elevMax.toFixed(2)} m MLLW`],
                    ["WATER SURFACE",   `${btub.wl.toFixed(3)} m MLLW`],
                    ["FLOOD MODEL",     btub?.modelInfo??"MSCC"],
                    ["SURGE SOURCE",    impactSource==="prob"&&probImpact&&scenario===null?"Extreme-aware DA (p50 map)":impactSource==="ml"&&impactForecast&&scenario===null?"Meta-stack time-aligned peak":scenario!==null?"Custom slider":timeMode==="historic"?"Observed event peak":"Live observed"],
                    ["COUNTY POP",      census.totalPop.toLocaleString()],
                    ["COUNTY HOUSING",  `${census.totalUnits.toLocaleString()} units`],
                    ["EXPOSURE BASIS", "Census 2020 county totals"],
                  ].map(([k,v])=><DRow key={k} k={k} v={v}/>)}
                </div>
              </div>
            </>)}
          </div>
        )}

        <div style={{marginTop:24,paddingTop:12,borderTop:`1px solid ${lm?"#d6e2ef":"#0a1820"}`,display:"flex",justifyContent:"space-between"}}>
          <span style={{fontSize:11,color:lm?"#8aacbc":"#0e2030"}}>ACHILLEUS · UTC-aligned NOAA observations and GFS forecasts · four-model meta-stack · extreme-aware error-state EnKF · MSCC / c-HAND · Census 2020 · HAZUS/NSI</span>
          <span style={{fontSize:11,color:lm?"#8aacbc":"#0e2030"}}>{station.name} · {periodLabel}</span>
        </div>
      </div>
    </div>
  );
}
