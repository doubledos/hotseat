/* wheel.js
   The Wildcard wheel's outcome pool and how a landed slice is described.

   Pure description of outcomes - building the pool, labelling, colouring and
   resolving which slice a spin landed on. The spinning animation and DOM live
   in ui/wheel-view.js. */

import { state } from '../core/state.js';
import { money } from '../core/util.js';
import { activeLevel, levelMoney, teamName } from './ladder.js';
import { shuffleArray } from '../core/util.js';

export function wheelMoneyLabel(n){
  if(n>=1000000) return '$'+(n/1000000).toFixed(n%1000000===0?0:1)+'M';
  if(n>=1000) return '$'+Math.round(n/1000)+'K';
  return money(n);
}
export function buildBombWheelOutcomes(){
  const lvl=state.ladderCurrent; const base=levelMoney(lvl);
  const amounts=[Math.round(base*0.5), base, Math.round(base*1.5), base*2];
  const pool=[];
  const pushWin=(tier,count)=>{ for(let i=0;i<count;i++) pool.push({type:'win',amount:amounts[tier],tier}); };
  pushWin(0,1); pushWin(1,3); pushWin(2,1); pushWin(3,1);
  for(let i=0;i<1;i++) pool.push({type:'bankrupt'});
  for(let i=0;i<1;i++) pool.push({type:'swap'});
  for(let i=0;i<1;i++) pool.push({type:'vacation',amount:Math.round(base*0.75)});
  for(let i=0;i<1;i++){
    const roll=Math.random();
    const resolved = roll<0.34 ? {type:'bankrupt'} : roll<0.67 ? {type:'swap'} : {type:'win',amount:amounts[Math.floor(Math.random()*4)]};
    pool.push({type:'mystery', resolved});
  }
  return shuffleArray(pool);
}
export function wheelOutcomeLabel(o){
  if(o.type==='win') return money(o.amount);
  if(o.type==='bankrupt') return 'BANKRUPT';
  if(o.type==='swap') return 'SWAP SEAT';
  if(o.type==='vacation') return 'FIJI';
  if(o.type==='mystery') return 'MYSTERY';
  return '';
}
export function wheelSliceColor(o){
  if(!o) return '#8a5c0d';
  if(o.type==='win') return ['#8a5c0d','#d94a1f','#f06a3d','#ffd700'][o.tier||0];
  if(o.type==='bankrupt') return '#0a0a0a';
  if(o.type==='swap') return '#6b3fa0';
  if(o.type==='vacation') return '#178a72';
  if(o.type==='mystery') return '#241242';
  return '#8a5c0d';
}
export function wheelSliceVisual(o){
  if(o.type==='win') return {text:wheelMoneyLabel(o.amount), dark:o.tier===3, cls:'', icon:'', isWord:false};
  if(o.type==='bankrupt') return {text:'BUST', dark:false, cls:'', icon:'cross', isWord:true};
  if(o.type==='swap') return {text:'SWAP', dark:false, cls:'', icon:'shuffle', isWord:true};
  if(o.type==='vacation') return {text:'FIJI', dark:false, cls:'', icon:'sun', isWord:true};
  if(o.type==='mystery') return {text:'?', dark:false, cls:'mystery', icon:'', isWord:false};
  return {text:'', dark:false, cls:'', icon:'', isWord:false};
}
export function wheelOutcomeResultText(o){
  if(!o) return '';
  if(o.type==='win') return money(o.amount);
  if(o.type==='vacation') return `Fiji Getaway ${money(o.amount)}`;
  if(o.type==='bankrupt') return 'BANKRUPT';
  if(o.type==='swap') return 'Seat Swap';
  return '';
}
export function resolvedOutcomeFor(wheel){
  if(!wheel||!wheel.outcomes) return null;
  const o=wheel.outcomes[wheel.winnerIdx];
  return o&&o.type==='mystery' ? o.resolved : o;
}
