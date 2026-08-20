/* wheel-view.js
   Rendering and spinning the Wildcard wheel: bulbs, slice markup, the zoom
   card, and the physics-driven landing animation. */

import { esc } from '../core/util.js';
import { buildBombWheelOutcomes, resolvedOutcomeFor, wheelMoneyLabel, wheelOutcomeLabel, wheelOutcomeResultText, wheelSliceColor, wheelSliceVisual } from '../rules/wheel.js';
import { money } from '../core/util.js';
import { tvIcon } from './icons.js';

export function buildWheelBulbs(size){
  const n=26; const r=size/2+7;
  let html='';
  for(let i=0;i<n;i++){
    const deg=i*(360/n);
    const delay=(i%6)*0.15;
    html+=`<div class="wheel-bulb" style="transform:rotate(${deg}deg) translateY(-${r}px);animation-delay:${delay}s;"></div>`;
  }
  return html;
}
export const WHEEL_FIJI_IMG='https://upload.wikimedia.org/wikipedia/commons/3/3f/Sunset_with_coconut_palm_tree%2C_Fiji.jpg';
export function wheelZoomVisual(o){
  if(!o) return {text:'',dark:false,bgImage:''};
  if(o.type==='win') return {text:money(o.amount), dark:o.tier===3, bgImage:''};
  if(o.type==='bankrupt') return {text:'BANKRUPT', dark:false, bgImage:''};
  if(o.type==='swap') return {text:'SEAT SWAP', dark:false, bgImage:''};
  if(o.type==='vacation') return {text:'FIJI', dark:false, bgImage:WHEEL_FIJI_IMG};
  if(o.type==='mystery') return {text:'?', dark:false, bgImage:''};
  return {text:'',dark:false,bgImage:''};
}
export function showWheelZoom(idSuffix, outcome, pulse){
  const el=document.getElementById('wheel-zoom-'+idSuffix);
  if(!el||!outcome) return;
  const vis=wheelZoomVisual(outcome);
  el.style.background=vis.bgImage
    ? `linear-gradient(rgba(0,0,0,0.18),rgba(0,0,0,0.5)), url('${vis.bgImage}') center/cover no-repeat, ${wheelSliceColor(outcome)}`
    : wheelSliceColor(outcome);
  el.innerHTML=`<div class="wheel-zoom-text ${vis.dark?'dark':''}">${esc(vis.text)}</div>`;
  if(pulse){ el.classList.remove('show'); void el.offsetWidth; }
  el.classList.add('show');
}
export function buildWheelHTML(wheel, idSuffix, opts){
  opts=opts||{};
  const size=opts.size||(idSuffix==='tv'?560:320);
  const n=wheel.names.length;
  const seg=360/n;
  const outcomes=wheel.outcomes||[];
  const stops=outcomes.length
    ? outcomes.map((o,i)=>`${wheelSliceColor(o)} ${i*seg}deg ${(i+1)*seg}deg`).join(', ')
    : wheel.names.map((_,i)=>`${['#8a5c0d','#d94a1f','#f06a3d','#b97e22'][i%4]} ${i*seg}deg ${(i+1)*seg}deg`).join(', ');
  const r=size/2;
  const bandInner=r*0.32;
  const bandOuter=r*0.92;
  const midR=(bandInner+bandOuter)/2;
  const radialSpan=bandOuter-bandInner;
  const tangentThick=Math.max(34, Math.round(size*0.1));
  const isHost=idSuffix==='host';
  const labels=wheel.names.map((name,i)=>{
    const o=outcomes[i];
    const angle=i*seg+seg/2;
    const vis=o?wheelSliceVisual(o):{text:name,dark:false,cls:'',icon:'',isWord:false};
    const isWin=o&&o.type==='win';
    const text=isWin?money(o.amount):vis.text;
    const fontSize=vis.cls==='mystery'?Math.round(size*0.13):(isWin?Math.round(size*0.052):Math.round(size*0.058));
    const useIcon=isHost&&vis.isWord;
    const content=useIcon
      ? `<div class="wheel-slice-icon">${tvIcon(vis.icon,'1.5em')}</div>`
      : `<div class="wheel-slice-text" style="font-size:${fontSize}px;">${esc(text)}</div>`;
    return `<div class="wheel-slice" style="transform:rotate(${angle}deg) translateY(-${midR}px);">
      <div class="wheel-slice-inner ${vis.dark?'dark':''} ${vis.cls}" style="width:${radialSpan}px;height:${tangentThick}px;">
        ${content}
      </div>
    </div>`;
  }).join('');
  return `<div class="wheel-wrap">
    <div class="wheel-outer" style="width:${size}px;height:${size}px;">
      ${buildWheelBulbs(size)}
      <div class="wheel-pointer" id="wheel-pointer-${idSuffix}"></div>
      <div class="wheel-disc" id="wheel-disc-${idSuffix}" style="background:conic-gradient(from 0deg, ${stops});">
        <div style="position:relative;width:100%;height:100%;">${labels}</div>
      </div>
      <div class="wheel-hub"></div>
      <div class="wheel-zoom" id="wheel-zoom-${idSuffix}"></div>
    </div>
  </div>`;
}

export function wheelResultText(wheel){
  return wheel.kind==='bomb' ? wheel.names[wheel.winnerIdx] : wheel.names[wheel.winnerIdx]+' takes the hot seat!';
}

export function flashWheelResult(baseHex, glowHex){
  let el=document.getElementById('tv-wheel-flash');
  if(!el){
    el=document.createElement('div');
    el.id='tv-wheel-flash';
    el.className='tv-wheel-flash';
    document.body.appendChild(el);
  }
  el.style.background=`radial-gradient(circle at 50% 40%, ${glowHex} 0%, ${baseHex} 65%)`;
  el.classList.remove('fire'); void el.offsetWidth; el.classList.add('fire');
}

export function revealWheelOutcome(outcome, wheel, resultEl, isTV){
  const text=wheel.outcomes ? wheelOutcomeResultText(outcome) : wheelResultText(wheel);
  if(resultEl) resultEl.textContent=text;
  if(!outcome||!isTV) return;
  if(outcome.type==='win'){ flashWheelResult('#3a2306','#ffdd33'); }
  else if(outcome.type==='vacation'){ flashWheelResult('#0c3d33','#39d6b0'); }
  else if(outcome.type==='bankrupt'){ flashWheelResult('#000000','#ff5c4d'); }
  else if(outcome.type==='swap'){ flashWheelResult('#241040','#c070f0'); }
}

export function onWheelLanded(wheel, idSuffix, resultEl){
  const outcome=wheel.outcomes ? wheel.outcomes[wheel.winnerIdx] : null;
  const isTV=idSuffix==='tv';
  if(outcome&&outcome.type==='mystery'){
    if(resultEl) resultEl.textContent='Unlocking the mystery box…';
    showWheelZoom(idSuffix, outcome, false);
    if(isTV){ flashWheelResult('#241242','#a06bff'); }
    setTimeout(()=>{
      showWheelZoom(idSuffix, outcome.resolved, true);
      revealWheelOutcome(outcome.resolved, wheel, resultEl, isTV);
    }, 1300);
  } else {
    showWheelZoom(idSuffix, outcome, false);
    revealWheelOutcome(outcome, wheel, resultEl, isTV);
  }
}

export function animateWheel(wheel, idSuffix){
  const disc=document.getElementById('wheel-disc-'+idSuffix);
  const resultEl=document.getElementById('wheel-result-'+idSuffix);
  const pointerEl=document.getElementById('wheel-pointer-'+idSuffix);
  if(!disc) return;
  const n=wheel.names.length; const seg=360/n;
  const winCenter=wheel.winnerIdx*seg+seg/2;
  const isTV=idSuffix==='tv';
  const extraSpins=isTV?9:7;
  const finalDeg=extraSpins*360+(360-winCenter);
  const duration=isTV?6200:5200;
  const startTime=performance.now();
  const ease=t=>1-Math.pow(1-t,4.2);
  let lastTickAt=0, lastSeg=-1;
  function frame(now){
    const t=Math.min(1,(now-startTime)/duration);
    const deg=finalDeg*ease(t);
    disc.style.transform=`rotate(${deg}deg)`;
    const curSeg=Math.floor(deg/seg);
    if(curSeg!==lastSeg){
      lastSeg=curSeg;
      if(now-lastTickAt>32){
        lastTickAt=now;
        if(!isTV&&navigator.vibrate) navigator.vibrate(9);
      }
    }
    if(t<1){ requestAnimationFrame(frame); }
    else {
      disc.style.transform=`rotate(${finalDeg}deg)`;
      if(pointerEl){ pointerEl.classList.add('impact'); setTimeout(()=>pointerEl.classList.remove('impact'),260); }
      onWheelLanded(wheel, idSuffix, resultEl);
    }
  }
  requestAnimationFrame(frame);
}
