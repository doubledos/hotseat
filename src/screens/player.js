/* player.js
   The phone surface. A player claims a seat, then may vote on a steal, submit
   a wager, and request a lifeline. Requests are proposals - the host applies
   them. */

import { LIFELINE_DEFS } from '../core/constants.js';
import { currentLobbyCode, mode, myPlayerId, phonePromoteMenuOpen, phoneSpinRequestedFor, phoneWagerSubmitted, setPhonePromoteMenuOpen, setPhoneSpinRequestedFor } from '../core/session.js';
import { state } from '../core/state.js';
import { esc, letterFor, money } from '../core/util.js';
import { hotSeatPlayer, opposingTeam, playerById, teamName } from '../rules/ladder.js';
import { phoneRequestLifeline, requestSpinWheel } from '../rules/lifelines.js';
import { phoneSubmitWager, phoneSubmitWagerAnswer, phoneVote, unclaimPlayer } from '../rules/phone.js';
import { resolvedOutcomeFor, wheelOutcomeResultText } from '../rules/wheel.js';
import { renderLobbyEntry, renderPlayerClaim } from './entry.js';
import { R } from '../ui/rerender.js';
import { animateWheel, buildWheelHTML, wheelResultText } from '../ui/wheel-view.js';

/* Surface-local render bookkeeping: what this surface last drew, so it can
   tell a real change from a repaint. Owned here because nothing else reads it. */
let lastPhoneWheelSeen = 0;

export function setPromoteMenu(open, rerender=true){ setPhonePromoteMenuOpen(open); if(rerender) R.player(); }

export function renderPlayer(){
  if(mode!=='player') return;
  document.body.classList.add('mode-player');
  const root=document.getElementById('app-root');

  // Not in a lobby
  if(!currentLobbyCode){
    root.innerHTML=renderLobbyEntry();
    return;
  }

  // Not identified
  if(!myPlayerId||!playerById(myPlayerId)){
    root.innerHTML=renderPlayerClaim();
    return;
  }

  const me=playerById(myPlayerId);
  const s=state.steal;
  const w=state.wager;
  const q=state.currentQuestion;
  const f=state.flow;
  const iAmPanel=me.team===opposingTeam();
  const inSteal=s&&!s.locked&&!s.resolved;

  let content='';

  // Wager phase
  if(state.gamePhase==='wager'&&w.active){
    const maxWager=me.personalBank||0;
    const wagerSubmitted=phoneWagerSubmitted||w.wagers[myPlayerId]!==undefined;
    if(!wagerSubmitted){
      content=w.revealed
        ?`<div class="card"><div class="ph-status">Wager window closed — you didn't lock one in this round.</div></div>`
        :`<div class="card card-gold">
          <div style="font-size:13px;font-weight:700;color:#c070f0;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px;">💜 Final Wager</div>
          <p class="ph-status">Wager from your personal bank. Max: ${money(maxWager)}.</p>
          <input type="number" class="ph-wager-input" id="ph-wager-input" min="0" max="${maxWager}" placeholder="0" value="">
          <button class="btn btn-primary btn-block mt-12 btn-lg" onclick="submitPhoneWager()">Lock In Wager</button>
        </div>`;
    } else if(!w.revealed){
      content=`<div class="card card-gold" style="text-align:center;">
        <div style="font-size:13px;font-weight:700;color:#c070f0;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px;">💜 Final Wager</div>
        <div class="ph-amount">${money(w.wagers[myPlayerId]||0)}</div>
        <div class="ph-status" style="margin-top:10px;">Wager locked in! Waiting for the question…</div>
      </div>`;
    } else {
      const wq=w.question;
      const myWagerAns=w.answers?w.answers[myPlayerId]:undefined;
      if(!wq){
        content=`<div class="card"><div class="ph-status">No question available.</div></div>`;
      } else if(myWagerAns!==undefined){
        const myOrigIdx=wq.displayOrder[myWagerAns];
        content=`<div class="card" style="border-color:var(--c-gold-dim);text-align:center;">
          <div style="font-size:13px;font-weight:700;color:var(--c-gold);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:16px;">🎯 Locked In</div>
          <div style="font-size:clamp(32px,10vw,60px);font-weight:700;color:var(--c-gold-light);font-family:var(--font-display);letter-spacing:0.05em;">${letterFor(myWagerAns)})</div>
          <div style="font-size:clamp(18px,5vw,28px);font-weight:600;color:var(--c-ink);margin-top:6px;">${esc(wq.options[myOrigIdx])}</div>
          <div style="font-size:13px;color:var(--c-muted);margin-top:16px;">Watch the TV!</div>
        </div>`;
      } else {
        content=`<div class="card card-gold">
          <div style="font-size:13px;font-weight:700;color:#c070f0;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px;">💜 Final Wager</div>
          <div style="font-size:15px;font-weight:600;line-height:1.5;margin-bottom:14px;">${esc(wq.text)}</div>
          <div class="ph-vote-btns">
            ${wq.displayOrder.map((origIdx,di)=>`<button class="ph-vote-btn" onclick="phoneSubmitWagerAnswer(${di})">
              <span class="ph-vote-letter">${letterFor(di)})</span>${esc(wq.options[origIdx])}
            </button>`).join('')}
          </div>
          <div class="ph-status">Pick your final answer.</div>
        </div>`;
      }
    }
  }
  // Voting phase — I'm next-in-line and a question is active
  else if(q&&iAmPanel&&s&&!s.locked&&['idle','question','options','selecting','revealing','revealed','steal-peek','steal-locked'].includes(f.stage)){
    const amNil=s.nextInLineId===myPlayerId; const voted=s.votes[myPlayerId]!==undefined;
    if(amNil){
      if(voted){
        const myVoteIdx=window._myVote!==undefined?window._myVote:-1;
        const myVoteOrigIdx=myVoteIdx>=0?q.displayOrder[myVoteIdx]:-1;
        content=`<div class="card" style="border-color:var(--c-gold-dim);text-align:center;">
          <div style="font-size:13px;font-weight:700;color:var(--c-gold);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:16px;">🎯 Locked In</div>
          <div style="font-size:clamp(32px,10vw,60px);font-weight:700;color:var(--c-gold-light);font-family:var(--font-display);letter-spacing:0.05em;">${myVoteIdx>=0?letterFor(myVoteIdx)+')'+'':''}</div>
          <div style="font-size:clamp(18px,5vw,28px);font-weight:600;color:var(--c-ink);margin-top:6px;">${myVoteOrigIdx>=0?esc(q.options[myVoteOrigIdx]):''}</div>
          <div style="font-size:13px;color:var(--c-muted);margin-top:16px;">Watch the TV!</div>
        </div>`;
      } else {
        content=`<div class="card" style="border-color:var(--c-gold-dim);">
          <div style="font-size:13px;font-weight:700;color:var(--c-gold);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px;">🎯 Your Steal</div>
          <div style="font-size:15px;font-weight:600;line-height:1.5;margin-bottom:14px;">${esc(q.text)}</div>
          <div class="ph-vote-btns">
            ${q.displayOrder.map((origIdx,di)=>{
              if(di===f.hotSeatAnswer||di===f.doubleDipMissIdx){
                return `<div class="ph-vote-btn ph-vote-btn-disabled">
                  <span class="ph-vote-letter">${letterFor(di)})</span>${esc(q.options[origIdx])} <span style="font-size:12px;">— already wrong</span>
                </div>`;
              }
              return `<button class="ph-vote-btn" onclick="phoneVote(${di})">
                <span class="ph-vote-letter">${letterFor(di)})</span>${esc(q.options[origIdx])}
              </button>`;
            }).join('')}
          </div>
          <div class="ph-status">Collaborate with your team and pick.</div>
        </div>`;
      } // end else (not voted)
    } else {
      content=`<div class="card"><div class="ph-status">Your team's next-in-line is voting. Collaborate and watch the TV!</div></div>`;
    }
  }
  // Wildcard wheel — anyone can watch it and spin it from their phone
  else if(state.wheel&&state.wheel.kind==='bomb'){
    const spun=!!state.wheel.spunAt;
    const pending=!spun&&phoneSpinRequestedFor===state.wheel.id;
    content=`<div class="card" style="text-align:center;">
      <div style="font-size:13px;font-weight:700;color:#c070f0;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px;">🎡 Wildcard</div>
      <div style="transform:scale(0.82);margin:-20px 0;">${buildWheelHTML(state.wheel,'ph')}</div>
      <div id="wheel-result-ph" class="ph-status" style="margin-top:4px;"></div>
      ${spun?'':pending
        ?`<div class="ph-status" style="margin-top:12px;">Spinning…</div>`
        :`<button class="btn btn-primary btn-block mt-12 btn-lg" onclick="requestSpinWheel()">Spin!</button>`}
    </div>`;
  }
  // Hot seat player's turn — lifelines available to use from their phone (teammates just watch)
  else if(q&&me.team===state.hotSeatTeam&&me.id===state.hotSeatPlayerId&&state.gamePhase==='live'&&['question','options','selecting'].includes(f.stage)){
    const ll=state.lifelines[me.team]||{};
    const defs=LIFELINE_DEFS.filter(({key})=>!(state.gameMode==='race'&&(key==='bomb'||key==='doubleDip')));
    const teammates=state.players.filter(p=>p.team===me.team&&p.id!==state.hotSeatPlayerId);
    content=`<div class="card">
      <div style="font-size:13px;font-weight:700;color:var(--c-gold);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:10px;">Lifelines</div>
      <div class="ph-status" style="margin-bottom:12px;">You are in the hot seat. Watch the TV — use a lifeline here if needed.</div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${defs.map(({key,label})=>{
          if(ll[key]) return `<button class="btn btn-ghost btn-block" disabled style="opacity:0.35;">${esc(label)}</button>`;
          if(key==='promote'){
            if(!teammates.length) return '';
            if(!phonePromoteMenuOpen){
              return `<button class="btn btn-ghost btn-block" onclick="setPromoteMenu(true)">${esc(label)} ›</button>`;
            }
            return `<div class="ph-submenu">
              <button class="ph-submenu-back" onclick="setPromoteMenu(false)">‹ ${esc(label)}</button>
              ${teammates.map(p=>`<button class="btn btn-ghost btn-block" onclick="setPromoteMenu(false,false);phoneRequestLifeline('promote','${p.id}')">${esc(p.name)}</button>`).join('')}
            </div>`;
          }
          return `<button class="btn btn-ghost btn-block" onclick="phoneRequestLifeline('${key}')">${esc(label)}</button>`;
        }).join('')}
      </div>
    </div>`;
  }
  else if(s&&!s.locked&&!iAmPanel){
    content=`<div class="card"><div class="ph-status">Your team is in the hot seat. Watch the TV!</div></div>`;
  }
  else if(q&&me.team===state.hotSeatTeam&&me.id!==state.hotSeatPlayerId&&state.gamePhase==='live'&&['question','options','selecting'].includes(f.stage)){
    const hp3=hotSeatPlayer();
    content=`<div class="card"><div class="ph-status">${hp3?esc(hp3.name):'Your teammate'} is in the hot seat — only they can use a lifeline. Watch the TV!</div></div>`;
  }
  else {
    content=`<div class="card"><div class="ph-status">Nothing to do right now.<br>Votes and wagers will appear here automatically.</div></div>`;
  }

  root.innerHTML=`<div class="ph-screen">
    <div class="ph-bank-hero">
      <div class="ph-player-name">${esc(me.name)}</div>
      <div class="ph-team">${esc(teamName(me.team))}</div>
      <div class="ph-amount">${money(me.personalBank)}</div>
    </div>
    ${content}
    <button class="btn btn-ghost btn-sm" style="margin-top:auto;" onclick="unclaimPlayer()">Not ${esc(me.name)}?</button>
  </div>`;

  if(state.wheel&&state.wheel.spunAt&&state.wheel.spunAt!==lastPhoneWheelSeen){
    lastPhoneWheelSeen=state.wheel.spunAt;
    animateWheel(state.wheel,'ph');
  } else if(state.wheel&&state.wheel.spunAt){
    const disc=document.getElementById('wheel-disc-ph');
    if(disc){ const n=state.wheel.names.length,seg=360/n; disc.style.transition='none'; disc.style.transform=`rotate(${360*6+(360-(state.wheel.winnerIdx*seg+seg/2))}deg)`; }
    const res=document.getElementById('wheel-result-ph');
    if(res) res.textContent=state.wheel.outcomes?wheelOutcomeResultText(resolvedOutcomeFor(state.wheel)):wheelResultText(state.wheel);
  }
  if(!state.wheel) setPhoneSpinRequestedFor(null);
}

export function submitPhoneWager(){
  const el=document.getElementById('ph-wager-input');
  const me=playerById(myPlayerId);
  const max=me?me.personalBank:0;
  const amount=Math.min(Math.max(0,parseInt(el?.value||'0',10)),max);
  phoneSubmitWager(amount);
}
