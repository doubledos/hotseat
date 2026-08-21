/* host/adjust.js
   Manual score correction: the custom adjust modal and the one-tap rail. */

import { state } from '../../core/state.js';
import { esc } from '../../core/util.js';
import { applyAdjustment } from '../../rules/score.js';
import { setPendingModal } from '../../ui/modal.js';

export function openAdjustModal(){
  const targets=[
    {label:`${esc(state.teamAName)} (team)`, value:'teamA'},
    {label:`${esc(state.teamBName)} (team)`, value:'teamB'},
    ...state.players.map(p=>({label:`${esc(p.name)} (personal)`, value:'player:'+p.id}))
  ];
  document.getElementById('modal-icon').style.display='none';
  document.getElementById('modal-message').innerHTML='<b>Manual Adjustment</b>';
  document.getElementById('modal-picker').style.display='none';
  const wrap=document.getElementById('modal-input-wrap');
  wrap.style.display='block';
  wrap.innerHTML=`
    <div class="field" style="text-align:left;margin-bottom:12px;">
      <label>Target</label>
      <select class="input" id="adjust-target">
        ${targets.map(t=>`<option value="${esc(t.value)}">${t.label}</option>`).join('')}
      </select>
    </div>
    <div class="row">
      <div class="field" style="text-align:left;flex:0.6;">
        <label>Amount</label>
        <input type="number" class="input" id="adjust-amount" placeholder="e.g. -100">
      </div>
      <div class="field w2" style="text-align:left;">
        <label>Reason (optional)</label>
        <input type="text" class="input" id="adjust-reason" placeholder="e.g. Shouted answer penalty">
      </div>
    </div>`;
  const confirmBtn=document.getElementById('modal-confirm-btn');
  confirmBtn.style.display='';
  confirmBtn.textContent='Apply';
  setPendingModal(doAdjustment);
  document.getElementById('modal-overlay').classList.add('show');
}

export async function doAdjustment(){
  const target=document.getElementById('adjust-target')?.value;
  const amount=parseInt(document.getElementById('adjust-amount')?.value||'0',10);
  const reason=document.getElementById('adjust-reason')?.value||'';
  if(!target||isNaN(amount)||amount===0) return;
  if(target.startsWith('player:')){
    await applyAdjustment('player',target.slice(7),amount,reason);
  } else {
    await applyAdjustment(target,null,amount,reason);
  }
}

export async function quickAdjust(targetType,targetId,amount){
  await applyAdjustment(targetType,targetId,amount,'Quick adjust');
}
