/* host/wager.js
   The Final Wager tab. */

import { seenWagerIds } from '../../core/session.js';
import { state } from '../../core/state.js';
import { esc, letterFor, money } from '../../core/util.js';
import { finalizeWager, revealWagerQuestion } from '../../rules/wager.js';

export function renderWagerTab(){
  const w=state.wager;
  const allIn=state.players.every(p=>w.wagers[p.id]!==undefined);
  const wagerRows=state.players.map(p=>{
    const amount=w.wagers[p.id];
    const justArrived=amount!==undefined&&!seenWagerIds.has(p.id);
    if(amount!==undefined) seenWagerIds.add(p.id);
    return `<div class="wager-row${justArrived?' vote-flash':''}">
      <span>${esc(p.name)} <span class="text-muted">(${money(p.personalBank)} available)</span></span>
      <span style="font-weight:700;color:${amount!==undefined?'var(--c-gold)':'var(--c-muted)'};">${amount!==undefined?money(amount):'waiting…'}</span>
    </div>`;
  }).join('');
  if(!w.revealed){
    return `<div class="wager-box">
      <div class="wager-title">Final Wager — Level 15</div>
      <p class="hint" style="margin-bottom:12px;">All players set their wager on their phones before seeing the question. Wager from personal bank only.</p>
      <div class="wager-rows">${wagerRows}</div>
      <button class="btn btn-primary" style="margin-top:12px;" onclick="revealWagerQuestion()">Reveal Question${allIn?'':' (not everyone has wagered yet)'}</button>
    </div>`;
  }
  const q=w.question;
  const answers=w.answers||{};
  const answeredCount=state.players.filter(p=>answers[p.id]!==undefined).length;
  const optsHtml=q&&q.options.length>1?`<div class="flow-opts" style="margin-top:10px;">${q.displayOrder.map((origIdx,di)=>{
    const isCorrect=origIdx===0;
    const pickers=state.players.filter(p=>answers[p.id]===di).map(p=>p.name);
    return `<div class="flow-opt${isCorrect?' correct':''}">
      <span class="flow-opt-letter">${letterFor(di)})</span>${esc(q.options[origIdx])}
      ${pickers.length?`<span style="float:right;font-size:11px;color:var(--c-muted);">${pickers.map(esc).join(', ')}</span>`:''}
    </div>`;
  }).join('')}</div>`:(q?`<div class="flow-q" style="margin-top:10px;color:var(--c-green-light);">${esc(q.options[0])}</div>`:'');
  return `<div class="wager-box">
    <div class="wager-title">Final Wager — Level 15</div>
    <div class="wager-rows">${wagerRows}</div>
    ${q?`<div class="flow-q" style="margin-top:12px;">${esc(q.text)}</div>`:'<div class="text-muted">No question drawn.</div>'}
    ${optsHtml}
    <div class="hint" style="margin-top:8px;text-align:center;">${answeredCount}/${state.players.length} answered</div>
    <div class="flow-controls" style="margin-top:14px;">
      <button class="btn btn-primary btn-block" onclick="finalizeWager()">▶ Reveal Correct Answer &amp; End Game</button>
    </div>
  </div>`;
}
