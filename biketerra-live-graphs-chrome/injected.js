(function(){
  const UPDATE_INTERVAL=500; // ms
  const intervalSec = UPDATE_INTERVAL / 1000; 
  let fullDataPower=[], fullDataHR=[], fullDataCad=[], fullDataSpeed=[], fullDataDraft=[];
  let maxPoints = Math.round(120 / intervalSec); // huvudgraf 120 s
  const ridersMaxPoints = 30*2; // rider-graf 30 s
  let ftp=250;
  let statsHiddenByUser=false;
  const ridersData={};

  let maxSinceStart = { power: 0, hr: 0, cad: 0, speed: 0 };

  const savedFTP=localStorage.getItem('overlayFTP'); if(savedFTP) ftp=parseFloat(savedFTP);

  function getPower(){const row=document.querySelector('.stat-row.name-power .stat-value.monospace'); if(!row) return null; const val=parseFloat(row.textContent); return isNaN(val)?null:val;}
  function getHR(){const row=document.querySelector('.stat-row .ico-hr')?.closest('.stat-row')?.querySelector('.stat-value.monospace'); if(!row) return null; const val=parseFloat(row.textContent); return isNaN(val)?null:val;}
  function getCadence(){const row=document.querySelector('.stat-row .ico-cadence')?.closest('.stat-row')?.querySelector('.stat-value.monospace'); if(!row) return null; const val=parseFloat(row.textContent); return isNaN(val)?null:val;}
  function getSpeed(){const rows=document.querySelectorAll('.stat-row'); for(const row of rows){const lbl=row.querySelector('.stat-label'); if(lbl&&lbl.textContent.trim()==='kph'){const val=parseFloat(row.querySelector('.stat-value.monospace').textContent); return isNaN(val)?null:val;}} return null;}
  function getDraftPercent(){const el=document.querySelector('.stat-circle-value.svelte-1wfcwp8'); if(!el) return 0; const val=parseFloat(el.textContent); return isNaN(val)?0:val;}
  function getPowerColor(value){
    if(value==null) return 'rgba(255,255,255,0.2)';
    const pct=value/ftp;
    if(pct<0.6) return '#808080';
    if(pct<0.76) return '#0070FF';
    if(pct<0.90) return '#00C000';
    if(pct<1.05) return '#FFFF00';
    if(pct<1.18) return '#FF8000';
    return '#FF0000';
  }

  // ===== Overlay: Huvud =====
  const overlay=document.createElement('div');
  overlay.style.cssText=`position:fixed; width:650px; height:250px; min-width:200px; min-height:150px; max-width:800px; max-height:600px; background:rgba(0,0,0,0.7); color:white; z-index:9999; padding:10px; border-radius:12px; box-sizing:border-box; resize:both; cursor:move; display:flex; flex-direction:column; font-family:sans-serif; font-size:14px;`;
  const statsDiv=document.createElement('div'); statsDiv.style.cssText='color:#888; margin-bottom:6px; font-size:13px;'; overlay.appendChild(statsDiv);
  const canvas=document.createElement('canvas'); canvas.id='chart'; canvas.style.flex='1 1 auto'; overlay.appendChild(canvas);

  // ===== Controls =====
  const controlsDiv=document.createElement('div');
  controlsDiv.style.cssText='position:absolute; top:8px; right:40px; background:rgba(0,0,0,0.5); padding:4px 8px; border-radius:8px; display:none; align-items:center; gap:10px;';

  const resetBtn=document.createElement('button'); resetBtn.textContent='Reset Data';
  Object.assign(resetBtn.style,{padding:'2px 6px',border:'none',borderRadius:'6px',background:'rgba(255,255,255,0.2)',color:'white',cursor:'pointer',fontSize:'12px'});
  controlsDiv.appendChild(resetBtn);

  const simBtn=document.createElement('button'); simBtn.textContent='Simulate';
  Object.assign(simBtn.style,{padding:'2px 6px',border:'none',borderRadius:'6px',background:'rgba(255,255,255,0.2)',color:'white',cursor:'pointer',fontSize:'12px'});
  controlsDiv.appendChild(simBtn);

  const hideSideBtn=document.createElement('button'); hideSideBtn.textContent='Hide Side';
  Object.assign(hideSideBtn.style,{padding:'2px 6px',border:'none',borderRadius:'6px',background:'rgba(255,255,255,0.2)',color:'white',cursor:'pointer',fontSize:'12px'});
  controlsDiv.appendChild(hideSideBtn);

  const timeSelect=document.createElement('select');
  [{label:'60 sec',value:60},{label:'3 min',value:180},{label:'5 min',value:300},{label:'20 min',value:1200},{label:'60 min',value:3600}].forEach(o=>{
    const el=document.createElement('option'); el.textContent=o.label; el.value=o.value; timeSelect.appendChild(el);
  });
  controlsDiv.appendChild(timeSelect);

  const ftpLabel=document.createElement('label'); ftpLabel.textContent='FTP:'; controlsDiv.appendChild(ftpLabel);
  const ftpInput=document.createElement('input'); ftpInput.type='number'; ftpInput.value=ftp; ftpInput.style.width='60px'; controlsDiv.appendChild(ftpInput);
  ftpInput.addEventListener('change',()=>{ const val=parseFloat(ftpInput.value); if(!isNaN(val)&&val>0){ftp=val; localStorage.setItem('overlayFTP',ftp);}});

  overlay.appendChild(controlsDiv);

  const toggleBtn=document.createElement('button'); toggleBtn.textContent='≡';
  Object.assign(toggleBtn.style,{position:'absolute',top:'8px',right:'8px',padding:'2px 6px',border:'none',borderRadius:'6px',background:'rgba(255,255,255,0.2)',color:'white',fontWeight:'bold',cursor:'pointer',zIndex:10000});
  overlay.appendChild(toggleBtn);
  document.body.appendChild(overlay);
  toggleBtn.addEventListener('click',()=>{controlsDiv.style.display=(controlsDiv.style.display==='none')?'flex':'none';});

  // ===== Overlay: Maxvärde =====
  const statsOverlay=document.createElement('div');
  statsOverlay.style.cssText='position:fixed; width:260px; background:rgba(0,0,0,0.7); color:white; z-index:9999; padding:8px 10px; border-radius:12px; box-sizing:border-box; font-family:sans-serif; font-size:14px; display:flex; flex-direction:column; gap:4px; justify-content:center; align-items:flex-start; box-shadow:0 2px 8px rgba(0,0,0,0.5);';
  const statsTable=document.createElement('div'); statsOverlay.appendChild(statsTable); document.body.appendChild(statsOverlay);

  // ===== Overlay: Ryttare =====
  const ridersOverlay=document.createElement('div');
  ridersOverlay.style.cssText='position:fixed; width:400px; height:250px; background:rgba(0,0,0,0.7); color:white; z-index:9999; padding:10px; border-radius:12px; box-sizing:border-box; font-family:sans-serif; font-size:12px; display:flex; flex-direction:column;';
  const ridersCanvas=document.createElement('canvas'); ridersOverlay.appendChild(ridersCanvas); document.body.appendChild(ridersOverlay);

  const ridersTitle=document.createElement('div');
  ridersTitle.textContent='W/kg last 30sec';
  ridersTitle.style.cssText='color:#ccc; font-size:12px; text-align:center; margin-top:4px;';
  ridersOverlay.appendChild(ridersTitle);

// ===== Overlay: Draft =====
const draftOverlay = document.createElement('div');
draftOverlay.style.cssText = `
  position:fixed; width:60px; height:200px; bottom:12px; left:12px; 
  background:rgba(0,0,0,0.7); border-radius:12px; overflow:hidden; z-index:9999; cursor:grab;
  padding:6px; box-sizing:border-box;
`;

const draftBar = document.createElement('div');
draftBar.style.cssText = `
  position:absolute; bottom:0; left:0; width:100%; height:0%; background:#00FF00; border-radius:4px; transition:height 0.3s;
`;
draftOverlay.appendChild(draftBar);

// Text som visar aktuellt draft-värde
const draftValueLabel = document.createElement('div');
draftValueLabel.style.cssText = `
  position:absolute; left:50%; transform:translateX(-50%);
  color:#fff; font-weight:bold; font-size:12px; text-shadow:0 0 4px black;
  bottom:0; transition:bottom 0.3s;
`;
draftOverlay.appendChild(draftValueLabel);

// Draft etiketter & linjer
for (let i = 1; i <= 5; i++) {
  const y = i * 20;
  const line = document.createElement('div');
  line.style.cssText = `position:absolute; left:0; width:100%; height:1px; background:rgba(255,255,255,0.3); bottom:${y}%;`;
  draftOverlay.appendChild(line);
  const tick = document.createElement('div');
  tick.textContent = y + '%';
  tick.style.cssText = `position:absolute; left:100%; transform:translateX(2px); bottom:${y}%; color:#aaa; font-size:10px;`;
  draftOverlay.appendChild(tick);
}

document.body.appendChild(draftOverlay);

  // ===== Flyttbara overlays =====
  function makeDraggable(el,storageKey){
    let dragging=false, offsetX=0, offsetY=0;
    const savedLeft = localStorage.getItem(storageKey+'Left');
    const savedTop = localStorage.getItem(storageKey+'Top');
    if(savedLeft && savedTop){ el.style.left=savedLeft+'px'; el.style.top=savedTop+'px'; el.style.right='auto'; el.style.bottom='auto'; }
    else { el.style.left='12px'; el.style.top='12px'; }
    el.addEventListener('mousedown',e=>{if(e.target===el){dragging=true; offsetX=e.clientX-el.offsetLeft; offsetY=e.clientY-el.offsetTop; el.style.cursor='grabbing'; e.preventDefault();}});
    document.addEventListener('mousemove',e=>{if(dragging){el.style.left=(e.clientX-offsetX)+'px'; el.style.top=(e.clientY-offsetY)+'px'; el.style.right='auto'; el.style.bottom='auto';}});
    document.addEventListener('mouseup',()=>{if(dragging){dragging=false; el.style.cursor='grab'; localStorage.setItem(storageKey+'Left',el.offsetLeft); localStorage.setItem(storageKey+'Top',el.offsetTop);}});
  }
  makeDraggable(overlay,'overlay');
  makeDraggable(statsOverlay,'statsOverlay');
  makeDraggable(ridersOverlay,'ridersOverlay');
  makeDraggable(draftOverlay,'draftOverlay');

  // ===== Hide Side-knapp =====
  hideSideBtn.addEventListener('click',()=>{
    const newDisplay=(statsOverlay.style.display!=='none')?'none':'flex';
    statsOverlay.style.display=newDisplay;
    ridersOverlay.style.display=newDisplay;
    draftOverlay.style.display=newDisplay;
    hideSideBtn.textContent=(newDisplay==='none')?'Show Side':'Hide Side';
    statsHiddenByUser=(newDisplay==='none');
  });

  // ===== Simulation =====
  let sim=false, simInterval=null;
  simBtn.addEventListener('click',()=>{
    sim=!sim;
    if(sim){
      simBtn.textContent='Stop Sim'; 
      simInterval=setInterval(simulateData,UPDATE_INTERVAL);
    } else{
      simBtn.textContent='Simulate'; 
      clearInterval(simInterval); simInterval=null;
    }
  });

  function simulateData(){
    const time = Date.now()/1000;
    const p = 200 + Math.sin(time/2)*40 + Math.random()*10;
    const h = 140 + Math.sin(time/3)*5;
    const c = 85 + Math.sin(time/1.5)*3;
    const s = 38 + Math.sin(time/2.5)*1;
    const d = 50 + Math.sin(time/4)*15;

    fullDataPower.push(p); fullDataHR.push(h); fullDataCad.push(c); fullDataSpeed.push(s); fullDataDraft.push(d);

    if(fullDataPower.length>maxPoints) fullDataPower.shift();
    if(fullDataHR.length>maxPoints) fullDataHR.shift();
    if(fullDataCad.length>maxPoints) fullDataCad.shift();
    if(fullDataSpeed.length>maxPoints) fullDataSpeed.shift();
    if(fullDataDraft.length>ridersMaxPoints) fullDataDraft.shift();

    const wkg=Math.round(p/ftp*3*10)/10;
    if(!ridersData['Test']) ridersData['Test']=[];
    ridersData['Test'].push(wkg);
    if(ridersData['Test'].length>ridersMaxPoints) ridersData['Test'].shift();
  }

  // ===== Chart.js =====
  let chart,ridersChart;
  loadChart(()=>{
    const ctx=canvas.getContext('2d');
    chart=new Chart(ctx,{type:'line',data:{labels:Array.from({length:maxPoints},(_,i)=>i-maxPoints+1),datasets:[
      {label:'HR',data:fullDataHR,borderColor:'red',fill:false,tension:0.25,pointRadius:0},
      {label:'Cadence',data:fullDataCad,borderColor:'#00ffff',fill:false,tension:0.25,pointRadius:0},
      {label:'Speed',data:fullDataSpeed,borderColor:'orange',fill:false,tension:0.25,pointRadius:0},
      {label:'Power',data:fullDataPower,borderColor:ctx=>getPowerColor(ctx.raw),backgroundColor:ctx=>getPowerColor(ctx.raw).replace(')',',0.3)'),fill:true,tension:0.25,pointRadius:0,segment:{borderColor:ctx=>getPowerColor(ctx.p0.parsed.y),backgroundColor:ctx=>getPowerColor(ctx.p0.parsed.y).replace(')',',0.3)')}}]},
      options:{animation:false,responsive:true,maintainAspectRatio:false,plugins:{legend:{display:true,labels:{font:{size:10},color:'#aaa'}}},layout:{padding:{left:10,right:10,top:5,bottom:20}},scales:{x:{display:false,offset:true},y:{beginAtZero:true,ticks:{color:'#777'}}}}
    });

    const rctx=ridersCanvas.getContext('2d');
    ridersChart=new Chart(rctx,{type:'line',data:{labels:Array.from({length:ridersMaxPoints},(_,i)=>i-ridersMaxPoints+1),datasets:[]},options:{animation:false,responsive:true,maintainAspectRatio:false,plugins:{legend:{display:true,labels:{font:{size:10},color:'#aaa'}}},scales:{x:{display:false},y:{beginAtZero:true,ticks:{color:'#777'}}}}});

    setInterval(updateAll,UPDATE_INTERVAL);
  });

  function updateAll(){
    if(!sim){
      const newPower=getPower(), newHR=getHR(), newCad=getCadence(), newSpeed=getSpeed(), newDraft=getDraftPercent();
      fullDataPower.push(newPower); fullDataHR.push(newHR); fullDataCad.push(newCad); fullDataSpeed.push(newSpeed); fullDataDraft.push(newDraft);

      if(fullDataPower.length>maxPoints) fullDataPower.shift();
      if(fullDataHR.length>maxPoints) fullDataHR.shift();
      if(fullDataCad.length>maxPoints) fullDataCad.shift();
      if(fullDataSpeed.length>maxPoints) fullDataSpeed.shift();
      if(fullDataDraft.length>ridersMaxPoints) fullDataDraft.shift();

      if(newPower!=null) maxSinceStart.power = Math.max(maxSinceStart.power,newPower);
      if(newHR!=null) maxSinceStart.hr = Math.max(maxSinceStart.hr,newHR);
      if(newCad!=null) maxSinceStart.cad = Math.max(maxSinceStart.cad,newCad);
      if(newSpeed!=null) maxSinceStart.speed = Math.max(maxSinceStart.speed,newSpeed);

      const riders=document.querySelectorAll('.riders-main .rider');
      riders.forEach(r=>{
        const name=r.querySelector('.rider-name')?.textContent?.trim();
        const wkgStr=r.querySelector('.rider-stats .rider-stat-value')?.textContent;
        if(!name || !wkgStr) return;
        const wkg=parseFloat(wkgStr);
        if(isNaN(wkg)) return;
        if(!ridersData[name]) ridersData[name]=[];
        ridersData[name].push(wkg);
        if(ridersData[name].length>ridersMaxPoints) ridersData[name].shift();
      });
    } else simulateData();

    const hasData=[...fullDataPower,...fullDataHR,...fullDataCad,...fullDataSpeed].some(v=>v!=null);
    overlay.style.display=hasData?'flex':'none';
    if(hasData && !statsHiddenByUser){statsOverlay.style.display='flex'; ridersOverlay.style.display='flex'; draftOverlay.style.display='flex';} 
    else {statsOverlay.style.display='none'; ridersOverlay.style.display='none'; draftOverlay.style.display='none';}

    chart.data.datasets[0].data=fullDataHR.slice(-maxPoints);
    chart.data.datasets[1].data=fullDataCad.slice(-maxPoints);
    chart.data.datasets[2].data=fullDataSpeed.slice(-maxPoints);
    chart.data.datasets[3].data=fullDataPower.slice(-maxPoints);
    chart.update('none');

    const datasets=Object.entries(ridersData).filter(([k,v])=>v.length).map(([name,data],idx)=>({label:name,data:data.slice(-ridersMaxPoints),borderColor:['#FF0000','#00FF00','#0070FF','#FFFF00','#FF8000','#00FFFF','#FF00FF','#C0C0C0','#FFA500','#800080'][idx%10],fill:false,tension:0.25,pointRadius:0}));
    ridersChart.data.datasets=datasets;
    ridersChart.update('none');

    updatePowerStats();
    updateStatsOverlay();

// Update draft bar + text
if (fullDataDraft.length) {
  const avgDraft = fullDataDraft.reduce((a, b) => a + b, 0) / fullDataDraft.length;
  const clamped = Math.min(Math.max(avgDraft, 0), 100);

  draftBar.style.height = clamped + '%';
  draftValueLabel.textContent = clamped.toFixed(0) + '%';
  draftValueLabel.style.bottom = `calc(${clamped}% + 2px)`;

  // Färgjustering för kontrast
  draftValueLabel.style.color = clamped > 60 ? '#000' : '#fff';
}

  }

  function calcAvg(data,sec){if(!data.length) return 0; const slice=data.slice(-Math.round(sec/intervalSec)); const vals=slice.filter(v=>v!=null); if(!vals.length) return 0; return Math.round(vals.reduce((a,b)=>a+b,0)/vals.length);}
  function calcTSS(data,ftp){if(!data.length) return 0; const valid=data.filter(v=>v!=null); if(!valid.length) return 0; const avg=valid.reduce((a,b)=>a+b,0)/valid.length; return Math.round((avg/ftp)**2*valid.length/3600*100);}
  function updatePowerStats(){const p3=calcAvg(fullDataPower,3); const p60=calcAvg(fullDataPower,60); const p300=calcAvg(fullDataPower,300); const p1200=calcAvg(fullDataPower,1200); const p3600=calcAvg(fullDataPower,3600); statsDiv.textContent=`Power 3s:${p3} | 1min:${p60} | 5min:${p300} | 20min:${p1200} | 60min:${p3600}`;}
  function updateStatsOverlay(){
    const maxPower = Math.max(...fullDataPower,0);
    const maxHR = Math.max(...fullDataHR,0);
    const maxCad = Math.max(...fullDataCad,0);
    const maxSpeed = Math.max(...fullDataSpeed,0);
    const tss = calcTSS(fullDataPower,ftp);
    statsTable.innerHTML=`Max Power: ${maxPower.toFixed(0)}<br>Max HR: ${maxHR.toFixed(0)}<br>Max Cadence: ${maxCad.toFixed(0)}<br>Max Speed: ${maxSpeed.toFixed(1)}<br>TSS: ${tss}`;
  }

  resetBtn.addEventListener('click',()=>{
    fullDataPower=[]; fullDataHR=[]; fullDataCad=[]; fullDataSpeed=[]; fullDataDraft=[];
    for(const k in ridersData) ridersData[k]=[];
    maxSinceStart = { power:0, hr:0, cad:0, speed:0 };
    updateStatsOverlay();
  });

  timeSelect.addEventListener('change',()=>{
    const sec = parseInt(timeSelect.value);
    maxPoints = Math.round(sec*2 / intervalSec); // alla tidsval dubblas
    if(chart){ chart.data.labels = Array.from({length:maxPoints}, (_, i) => i - maxPoints + 1); chart.update('none'); }
  });

  function loadChart(cb){if(window.Chart) return cb(); const s=document.createElement('script'); s.src='https://cdn.jsdelivr.net/npm/chart.js'; s.onload=cb; document.head.appendChild(s);}

// ===== Elevation Cursor med robust vänt och debug =====
let routeLength = parseFloat(localStorage.getItem('overlayRouteLength')) || 10;

// Skapa cursor-overlay
const elevCursor = document.createElement('div');
elevCursor.style.cssText = `
  position:absolute;
  width:2px;
  height:100%;
  background:red;
  top:0;
  left:0;
  pointer-events:none;
  z-index:10000;
  display:none;
`;
document.body.appendChild(elevCursor);

function parseDistance(str) {
  if (!str) return 0;
  str = str.trim().toLowerCase();
  const match = str.match(/[-+]?\d*\.?\d+/);
  if (!match) return 0;
  let num = parseFloat(match[0]);
  if (str.includes('m')) num /= 1000;
  return num;
}

function getToGoKm() {
  const container = document.querySelector('.stat-row-split.stat-avg.svelte-1wfcwp8');
  if (!container) return null;
  const valueEl = container.querySelector('.avg-value.svelte-1wfcwp8');
  if (!valueEl) return null;
  const txt = valueEl.textContent;
  return parseDistance(txt);
}

function getLeaderGapKm() {
  const el = document.querySelector('.riders-main .rider:first-child .rider-stat-value');
  if (!el) return 0;
  const txt = el.textContent;
  return parseDistance(txt);
}

function updateElevCursor() {
  const path = document.querySelector('.pathsvg');
  const ridersMain = document.querySelector('.riders-main');
  if (!path || !ridersMain || !routeLength) {
    // console.log('Väntar på pathsvg eller riders-main...');
    elevCursor.style.display = 'none';
    return;
  }

  const rect = path.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const toGo = getToGoKm();
  const gap = getLeaderGapKm();

  // debug
  console.log('toGo', toGo, 'gap', gap, 'rect', rect);

  if (toGo == null || isNaN(toGo)) {
    elevCursor.style.display = 'none';
    return;
  }

  const myPos = routeLength - toGo;
  const leaderPos = myPos + gap;
  const posRatio = Math.max(0, Math.min(leaderPos / routeLength, 1));

  elevCursor.style.display = 'block';
  elevCursor.style.left = `${rect.left + posRatio * rect.width}px`;
  elevCursor.style.top = `${rect.top}px`;
  elevCursor.style.height = `${rect.height}px`;
}

// Vänta tills båda finns, uppdatera sedan
const waitForElements = setInterval(() => {
  if (document.querySelector('.pathsvg') && document.querySelector('.riders-main')) {
    clearInterval(waitForElements);
    console.log('Elements ready, start elev cursor');
    setInterval(updateElevCursor, UPDATE_INTERVAL);
  } else {
    console.log('Waiting for elements...');
  }
}, 200);


})();
