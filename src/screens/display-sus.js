/* display-sus.js
   The TV in Sus mode.

   Read from across a room, so each stage commits to one big thing rather than
   laying out everything at once. The reveal is the centrepiece: one player at
   a time, their question, what they answered, and whether it stood up.

   What this surface must never show: who Sus is, and any correct answer before
   every phone has locked in. Those only reach shared state at reveal time,
   after answering has closed, and the Sus identity only when the game ends. */

import { state } from '../core/state.js';
import { esc } from '../core/util.js';
import { playerById } from '../rules/ladder.js';
import { susPassCount, isSuspended } from '../rules/sus.js';

const nameOf = (pid) => { const p = playerById(pid); return p ? esc(p.name) : '—'; };

/* One pip per round: the group's whole history in a glance. */
function trackerHTML(){
  const s = state.sus;
  const pips = Array.from({length:s.totalRounds}, (_,i)=>{
    const r = s.results[i];
    const cls = r ? (r.passed?'is-pass':'is-fail') : (i===s.round-1?'is-now':'');
    return `<span class="tv-sus-pip ${cls}">${r ? (r.passed?'✓':'✕') : ''}</span>`;
  }).join('');
  return `<div class="tv-sus-tracker">
    <div class="tv-sus-pips">${pips}</div>
    <div class="tv-sus-count">${susPassCount()} of ${s.passesNeeded} needed</div>
  </div>`;
}

export function renderSusDisplay(){
  const s = state.sus;

  if(!s.active && s.stage!=='ended'){
    return `<div class="tv-sus-stage">
      <div class="tv-level-badge">SUS MODE</div>
      <div class="tv-sus-headline">Waiting to start</div>
      <div class="tv-sus-sub">${state.players.length} players. One of them is not on your side.</div>
    </div>`;
  }

  if(s.stage==='idle'){
    return `<div class="tv-sus-stage">
      <div class="tv-level-badge">SUS MODE</div>
      <div class="tv-sus-headline">Roles are in</div>
      <div class="tv-sus-sub">Check your phone. Tell nobody.</div>
    </div>`;
  }

  if(s.stage==='answering'){
    const done = s.submitted.length, total = s.eligible.length;
    const dots = s.eligible.map(pid=>`<div class="tv-sus-player ${s.submitted.includes(pid)?'is-in':''}">
      <div class="tv-sus-player-name">${nameOf(pid)}</div>
      <div class="tv-sus-player-state">${s.submitted.includes(pid)?'in':'…'}</div>
    </div>`).join('');
    const sat = state.players.filter(p=>isSuspended(p.id));
    return `<div class="tv-sus-stage">
      ${trackerHTML()}
      <div class="tv-level-badge">ROUND ${s.round}</div>
      <div class="tv-sus-headline">Answer on your phone</div>
      <div class="tv-sus-sub">Everyone has a different question. ${done} of ${total} in.</div>
      <div class="tv-sus-players">${dots}</div>
      ${sat.length?`<div class="tv-sus-sat">${sat.map(p=>esc(p.name)).join(', ')} suspended this round</div>`:''}
    </div>`;
  }

  if(s.stage==='reveal'){
    const row = s.reveal[s.revealIdx];
    if(!row) return `<div class="tv-sus-stage"><div class="tv-sus-headline">…</div></div>`;
    const right = row.pickedIdx===row.correctIdx;
    return `<div class="tv-sus-stage">
      ${trackerHTML()}
      <div class="tv-level-badge">${s.revealIdx+1} of ${s.reveal.length}</div>
      <div class="tv-sus-revealed ${right?'is-right':'is-wrong'}">
        <div class="tv-sus-who">${nameOf(row.playerId)}</div>
        <div class="tv-sus-q">${esc(row.text)}</div>
        <div class="tv-sus-answer">${row.pickedIdx<0?'No answer':esc(row.options[row.pickedIdx])}</div>
        <div class="tv-sus-verdict">${right?'CORRECT':'WRONG'}</div>
        ${right?'':`<div class="tv-sus-sub">Answer was ${esc(row.options[row.correctIdx])}</div>`}
      </div>
    </div>`;
  }

  if(s.stage==='round-result'){
    const r = s.results[s.results.length-1];
    if(!r) return `<div class="tv-sus-stage"><div class="tv-sus-headline">…</div></div>`;
    const pct = r.eligible ? Math.round(100*r.correct/r.eligible) : 0;
    return `<div class="tv-sus-stage">
      ${trackerHTML()}
      <div class="tv-level-badge">ROUND ${s.round}</div>
      <div class="tv-sus-verdict-big ${r.passed?'is-pass':'is-fail'}">${r.passed?'PASSED':'FAILED'}</div>
      <div class="tv-sus-sub">${r.correct} of ${r.eligible} correct — ${pct}%, needed ${Math.round(s.threshold*100)}%</div>
    </div>`;
  }

  if(s.stage==='voting'){
    return `<div class="tv-sus-stage">
      ${trackerHTML()}
      <div class="tv-level-badge">ROUND ${s.round}</div>
      <div class="tv-sus-headline">Who is Sus?</div>
      <div class="tv-sus-sub">Vote on your phone. A majority suspends them for one round.</div>
      <div class="tv-sus-votecount">${Object.keys(s.votes).length} of ${s.eligible.length} voted</div>
    </div>`;
  }

  if(s.stage==='vote-result'){
    const out = s.lastSuspendedId;
    return `<div class="tv-sus-stage">
      ${trackerHTML()}
      <div class="tv-level-badge">ROUND ${s.round}</div>
      <div class="tv-sus-headline">${out?`${nameOf(out)} is suspended`:'No majority'}</div>
      <div class="tv-sus-sub">${out?`They sit out round ${s.round+1}.`:'Everybody plays the next round.'}</div>
    </div>`;
  }

  if(s.stage==='ended'){
    const won = s.outcome==='team';
    return `<div class="tv-sus-stage">
      ${trackerHTML()}
      <div class="tv-sus-verdict-big ${won?'is-pass':'is-fail'}">${won?'THE GROUP WINS':'SUS WINS'}</div>
      <div class="tv-sus-sub">${susPassCount()} of ${s.totalRounds} rounds passed, ${s.passesNeeded} needed</div>
      <div class="tv-sus-reveal-name">Sus was ${s.susRevealId?nameOf(s.susRevealId):'—'}</div>
    </div>`;
  }

  return `<div class="tv-sus-stage"><div class="tv-sus-headline">Sus Mode</div></div>`;
}
