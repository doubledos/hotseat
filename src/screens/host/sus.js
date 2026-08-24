/* host/sus.js
   The operator's panel for Sus mode.

   One card, driven by state.sus.stage, with exactly one primary action at any
   moment. The host is running this in front of a room, so the panel's job is
   to answer "what do I press now" without being read.

   It also carries the information the TV deliberately withholds: how many
   answers are in, how the vote is going. The TV cannot show those without
   telling the room things the game depends on keeping quiet. */

import { state } from '../../core/state.js';
import { esc } from '../../core/util.js';
import { playerById } from '../../rules/ladder.js';
/* Only what this module calls directly. The action functions behind the
   onclick attributes below are reached through the window barrel in main.js at
   runtime, not through imports - see CLAUDE.md. */
import { susPassCount, susVoteTally, isSuspended } from '../../rules/sus.js';

const nameOf = (pid) => { const p = playerById(pid); return p ? esc(p.name) : 'Unknown'; };

/* The round tracker: one pip per round, filled in as results land. */
function susTrackerHTML(){
  const s = state.sus;
  const pips = Array.from({length:s.totalRounds}, (_,i)=>{
    const r = s.results[i];
    const cls = r ? (r.passed ? 'is-pass' : 'is-fail') : (i===s.round-1 ? 'is-now' : '');
    return `<span class="sus-pip ${cls}" title="Round ${i+1}">${r ? (r.passed?'✓':'✕') : i+1}</span>`;
  }).join('');
  const passes = susPassCount();
  return `<div class="sus-tracker">
    <div class="sus-tracker-pips">${pips}</div>
    <div class="sus-tracker-score">${passes} / ${s.passesNeeded} needed</div>
  </div>`;
}

function stageCard(label, todo, tone, bodyHTML, actionHTML){
  return `<div class="flow-card tone-${tone}">
    <div class="flow-stage tone-${tone}">
      <div class="flow-stage-main">
        <div class="flow-stage-label">${label}</div>
        ${todo?`<div class="flow-stage-todo">${todo}</div>`:''}
      </div>
    </div>
    ${bodyHTML||''}
    ${actionHTML||''}
  </div>`;
}

export function renderSusTab(){
  const s = state.sus;

  /* The bank could not cover a full round, so nothing was dealt. Say what is
     missing and how to fix it - the host is mid-game and needs an action, not
     an error. */
  if(s.dealError){
    return stageCard('Not enough questions to deal round '+(s.round+1),
      `${s.dealError.needed} needed for the players still in, only ${s.dealError.got} unused left in the bank.`,
      'bad',
      `<div class="sus-note">Nothing was dealt, so no round was scored. Add at least
        ${s.dealError.needed - s.dealError.got} more question${s.dealError.needed-s.dealError.got===1?'':'s'}
        on the Setup tab, then deal again. Every player needs their own question and none repeat.</div>
       ${susTrackerHTML()}`,
      `<button class="btn btn-ghost btn-lg" onclick="setHostTab('setup')">Go to the question bank</button>
       <button class="btn btn-primary btn-lg" onclick="dealSusRound()">Try again</button>`);
  }

  if(!s.active && s.stage!=='ended'){
    return stageCard('Sus mode ready',
      `${state.players.length} players. One of them will be told they are Sus.`,
      'neutral', susTrackerHTML(),
      `<button class="btn btn-primary btn-lg" onclick="startSusGame()">Start Sus Game</button>`);
  }

  if(s.stage==='idle'){
    return stageCard('Roles dealt',
      'Everyone can see their role on their phone. Deal the first round when the room is ready.',
      'neutral', susTrackerHTML(),
      `<button class="btn btn-primary btn-lg" onclick="dealSusRound()">Deal Round 1</button>`);
  }

  if(s.stage==='answering'){
    const inCount = s.submitted.length, total = s.eligible.length;
    const all = inCount>=total;
    const list = s.eligible.map(pid=>`<div class="sus-row ${s.submitted.includes(pid)?'is-in':''}">
      <span class="sus-row-name">${nameOf(pid)}</span>
      <span class="sus-row-state">${s.submitted.includes(pid)?'answered':'waiting'}</span>
    </div>`).join('');
    const sat = state.players.filter(p=>isSuspended(p.id)).map(p=>nameOf(p.id));
    return stageCard(`Round ${s.round} — answering`,
      `Everyone answers on their own phone. ${inCount} of ${total} in.`,
      all?'good':'neutral',
      `${susTrackerHTML()}<div class="sus-list">${list}</div>
       ${sat.length?`<div class="sus-note">Suspended this round: ${sat.join(', ')} — no question, no vote, not counted.</div>`:''}`,
      `<button class="btn ${all?'btn-primary':'btn-ghost'} btn-lg" onclick="beginSusReveal()">
         ${all?'Reveal the answers':`Reveal anyway (${total-inCount} still out)`}
       </button>`);
  }

  if(s.stage==='reveal'){
    const row = s.reveal[s.revealIdx];
    if(!row) return stageCard('Reveal','Nothing to show.','neutral',susTrackerHTML(),
      `<button class="btn btn-primary btn-lg" onclick="tallySusRound()">Score the round</button>`);
    const right = row.pickedIdx===row.correctIdx;
    const last = s.revealIdx >= s.reveal.length-1;
    return stageCard(`Revealing ${s.revealIdx+1} of ${s.reveal.length}`,
      'The TV is showing this one. Read it out, then move on.',
      right?'good':'bad',
      `${susTrackerHTML()}
       <div class="sus-reveal-card">
         <div class="sus-reveal-name">${nameOf(row.playerId)} — ${right?'correct':'wrong'}</div>
         <div class="sus-reveal-q">${esc(row.text)}</div>
         <div class="sus-reveal-a">Answered: ${row.pickedIdx<0?'<em>no answer</em>':esc(row.options[row.pickedIdx])}</div>
         ${right?'':`<div class="sus-reveal-a">Correct: ${esc(row.options[row.correctIdx])}</div>`}
       </div>`,
      `<button class="btn btn-primary btn-lg" onclick="susRevealNext()">${last?'Score the round':'Next player'}</button>`);
  }

  if(s.stage==='round-result'){
    const r = s.results[s.results.length-1];
    const pct = r&&r.eligible ? Math.round(100*r.correct/r.eligible) : 0;
    return stageCard(r&&r.passed?`Round ${s.round} passed`:`Round ${s.round} failed`,
      r?`${r.correct} of ${r.eligible} correct — ${pct}%, needed ${Math.round(s.threshold*100)}%.`:'',
      r&&r.passed?'good':'bad',
      susTrackerHTML(),
      `<button class="btn btn-primary btn-lg" onclick="openSusVoting()">Open the vote</button>`);
  }

  if(s.stage==='voting'){
    const {counts, voters, suspendId} = susVoteTally();
    const cast = Object.keys(s.votes).length;
    const rows = state.players.map(p=>{
      const n = counts[p.id]||0;
      return `<div class="sus-row ${suspendId===p.id?'is-out':''}">
        <span class="sus-row-name">${esc(p.name)}</span>
        <span class="sus-row-state">${n} vote${n===1?'':'s'}</span>
      </div>`;
    }).join('');
    return stageCard(`Round ${s.round} — voting`,
      `${cast} of ${voters} votes in. A strict majority suspends someone for one round.`,
      'neutral',
      `${susTrackerHTML()}<div class="sus-list">${rows}</div>`,
      `<button class="btn btn-primary btn-lg" onclick="closeSusVoting()">Close the vote</button>`);
  }

  if(s.stage==='vote-result'){
    const out = s.lastSuspendedId;
    const done = s.round >= s.totalRounds;
    return stageCard(out?`${nameOf(out)} is suspended`:'Nobody was suspended',
      out?`They sit out round ${s.round+1} entirely — no question, no vote, and they do not count towards the ${Math.round(s.threshold*100)}%.`
         :'No majority. Everyone plays the next round.',
      out?'bad':'neutral',
      susTrackerHTML(),
      done?`<button class="btn btn-primary btn-lg" onclick="endSusGame()">See the result</button>`
          :`<button class="btn btn-primary btn-lg" onclick="nextSusRound()">Deal round ${s.round+1}</button>`);
  }

  if(s.stage==='ended'){
    const won = s.outcome==='team';
    return stageCard(won?'The group wins':'Sus wins',
      `${susPassCount()} of ${s.totalRounds} rounds passed, needed ${s.passesNeeded}. Sus was ${s.susRevealId?nameOf(s.susRevealId):'unknown'}.`,
      won?'good':'bad',
      susTrackerHTML(),
      `<button class="btn btn-ghost btn-lg" onclick="newGame()">New game</button>`);
  }

  return stageCard('Sus mode', '', 'neutral', susTrackerHTML(), '');
}
