/* player-sus.js
   The phone in Sus mode.

   A player's phone is the only place two things are ever shown: their own role,
   and their own question. Both arrive in rows addressed to this player rather
   than in the shared state blob, because every surface polls that blob and
   anything in it is readable from dev tools.

   The role is fetched once per game and held in session, not game state, so a
   repaint cannot leak it and another player's phone has nothing to read. */

import { state } from '../core/state.js';
import { esc } from '../core/util.js';
import { myPlayerId, currentLobbyCode, susMyRole, setSusMyRole, susAnsweredRound, susVotedRound } from '../core/session.js';
import { playerById } from '../rules/ladder.js';
import { isSuspended, susPassCount, susRoleKey, susQKey } from '../rules/sus.js';
import { dbGet } from '../core/db.js';
import { R } from '../ui/rerender.js';

/* Cache per round so a repaint every poll does not refetch the same row. */
let cachedQ = null, cachedQRound = -1, fetching = false;

export function susPhoneReset(){ cachedQ = null; cachedQRound = -1; }

/* Both of these fetch in the background and repaint when they land, because
   render is synchronous. */
function ensureRole(){
  if(susMyRole || fetching || !myPlayerId || !currentLobbyCode) return;
  fetching = true;
  dbGet(susRoleKey(myPlayerId)).then(res=>{
    fetching = false;
    if(res && res.value){ setSusMyRole(res.value); R.player(); }
  }).catch(()=>{ fetching = false; });
}
function ensureQuestion(round){
  if(cachedQRound === round || !myPlayerId || !currentLobbyCode) return;
  cachedQRound = round;
  dbGet(susQKey(round, myPlayerId)).then(res=>{
    if(res && res.value){
      try{ cachedQ = JSON.parse(res.value); }catch(e){ cachedQ = null; }
      R.player();
    }
  }).catch(()=>{});
}

function roleCard(){
  const isSus = susMyRole === 'sus';
  if(!susMyRole) return `<div class="card"><div class="ph-card-title">Getting your role…</div></div>`;
  return `<div class="card ph-role ${isSus?'is-sus':'is-good'}">
    <div class="ph-role-label">${isSus?'You are SUS':'You are a good guy'}</div>
    <div class="ph-role-sub">${isSus
      ? 'Answer wrong to make the group fail — but not so often they catch you. You are not told the right answer.'
      : 'Answer honestly. Work out who keeps getting theirs wrong.'}</div>
  </div>`;
}

function trackerCard(){
  const s = state.sus;
  const pips = s.results.map(r=>`<span class="ph-pip ${r.passed?'is-pass':'is-fail'}">${r.passed?'✓':'✕'}</span>`).join('');
  return `<div class="card">
    <div class="ph-card-title">Round ${s.round} of ${s.totalRounds}</div>
    <div class="ph-pips">${pips||'<span class="ph-dim">No rounds played yet</span>'}</div>
    <div class="ph-dim">${susPassCount()} passed · ${s.passesNeeded} needed to win</div>
  </div>`;
}

export function renderSusPlayer(me){
  const s = state.sus;
  ensureRole();

  if(!s.active && s.stage!=='ended'){
    return `<div class="card"><div class="ph-card-title">Waiting for the host</div>
      <div class="ph-dim">The game has not started yet.</div></div>`;
  }

  if(s.stage==='ended'){
    const won = s.outcome==='team';
    const wasSus = s.susRevealId===myPlayerId;
    const susName = s.susRevealId ? (playerById(s.susRevealId)||{}).name : null;
    return `<div class="card ph-role ${won?'is-good':'is-sus'}">
      <div class="ph-role-label">${won?'The group wins':'Sus wins'}</div>
      <div class="ph-role-sub">${susPassCount()} of ${s.totalRounds} rounds passed, ${s.passesNeeded} needed.</div>
      <div class="ph-role-sub"><b>${wasSus?'You were Sus.':`Sus was ${esc(susName||'unknown')}.`}</b></div>
    </div>`;
  }

  if(isSuspended(myPlayerId)){
    return `${roleCard()}
      <div class="card ph-suspended">
        <div class="ph-card-title">You are suspended</div>
        <div class="ph-dim">You sit out round ${s.round}. No question, no vote, and you are not
        counted for or against the group this round. You are back next round.</div>
      </div>
      ${trackerCard()}`;
  }

  /* Answering */
  if(s.stage==='answering'){
    ensureQuestion(s.round);
    const done = susAnsweredRound===s.round;
    if(done){
      return `${roleCard()}
        <div class="card"><div class="ph-card-title">Answer locked in</div>
        <div class="ph-dim">Waiting for everyone else. Results go up on the TV.</div></div>
        ${trackerCard()}`;
    }
    if(!cachedQ){
      return `${roleCard()}
        <div class="card"><div class="ph-card-title">Getting your question…</div></div>`;
    }
    const opts = (cachedQ.options||[]).map((o,i)=>
      `<button class="ph-opt" onclick="phoneSubmitSusAnswer(${i})">
         <span class="ph-opt-letter">${String.fromCharCode(65+i)}</span>${esc(o)}
       </button>`).join('');
    return `${roleCard()}
      <div class="card">
        <div class="ph-card-title">Your question</div>
        <div class="ph-question">${esc(cachedQ.text)}</div>
        <div class="ph-opts">${opts}</div>
        <div class="ph-dim">This is yours alone — everyone has a different one.</div>
      </div>`;
  }

  /* Voting */
  if(s.stage==='voting'){
    const voted = susVotedRound===s.round;
    if(voted){
      return `<div class="card"><div class="ph-card-title">Vote cast</div>
        <div class="ph-dim">Waiting for the rest of the group.</div></div>${trackerCard()}`;
    }
    const others = state.players.filter(p=>p.id!==myPlayerId);
    const rows = others.map(p=>
      `<button class="ph-opt" onclick="phoneSubmitSusVote('${p.id}')">${esc(p.name)}</button>`).join('');
    return `<div class="card">
        <div class="ph-card-title">Who is Sus?</div>
        <div class="ph-dim">A majority suspends them for one round. No majority, nobody sits out.</div>
        <div class="ph-opts">${rows}</div>
        <button class="ph-opt ph-skip" onclick="phoneSubmitSusVote('skip')">Skip — no vote</button>
      </div>${trackerCard()}`;
  }

  /* Reveal and the round verdict both play out on the TV; the phone should not
     pull eyes off it. */
  const last = s.results[s.results.length-1];
  return `${roleCard()}
    <div class="card">
      <div class="ph-card-title">${s.stage==='reveal'?'Watch the TV':'Round '+s.round}</div>
      <div class="ph-dim">${
        s.stage==='reveal' ? 'Answers are being revealed one at a time.'
        : s.stage==='round-result' && last ? `${last.correct} of ${last.eligible} correct — the round ${last.passed?'passed':'failed'}.`
        : 'Waiting for the host.'}</div>
    </div>
    ${trackerCard()}`;
}
