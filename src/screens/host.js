/* host.js
   The host console: the operator's surface. Topbar, the Setup / Play / Rules
   tabs, the flow card that drives a question, the quick-adjust rail, and the
   setup wizard.

   This is the only surface that changes game state directly; the TV and the
   phones render from what the host has already committed. */

import { LEVEL_MONEY, LIFELINE_DEFS } from '../core/constants.js';
import { hasSupabase } from '../core/db.js';
import { saveLobby } from '../core/lobby.js';
import { currentLobbyCode, editingPhrase, editingQuestion, hostTab, lastWheelSeen, mode, seenWagerIds, setActiveHostTab, setLastWheelSeen, setSetupStep, setupStep } from '../core/session.js';
import { state } from '../core/state.js';
import { debounce, esc, letterFor, money } from '../core/util.js';
import { loadTestData } from '../dev/testdata.js';
import { advanceLevelNoMoney, changeHotSeatPick, confirmBombWheel, confirmHotSeatReveal, confirmWheelWinner, dismissDefendedSteal, flowAdvance, getNextInLine, hostDrawQuestion, hostSelectAnswer, hostSetStealVote, lockStealAnswer, markCorrect, raceSwapAfterMiss, rerollQuestion, resolveSteal, retryDoubleDip, revealCorrectAnswer, unlockStealAnswer } from '../rules/flow.js';
import { activeLevel, elapsedMinutes, hotSeatPlayer, levelDiff, levelMoney, levelType, opposingTeam, teamName } from '../rules/ladder.js';
import { spinWheel, undoLifeline, useLifeline } from '../rules/lifelines.js';
import { addPlayer, deletePlayer, setHotSeat, startHosting, togglePlayerTeam } from '../rules/players.js';
import { correctDisplayIdx } from '../rules/pool.js';
import { exportQuestionsMarkdown, importQuestionsMarkdown } from '../rules/porting.js';
import { pausePuzzleTimer, puzzleSolved, resumePuzzleTimer, swapPuzzleHotSeat, triggerPuzzle } from '../rules/puzzle.js';
import { cancelEditPhrase, cancelEditQuestion, deletePhrase, deleteQuestion, resetAllUsedFlags, savePhraseFromForm, saveQuestionFromForm, startEditPhrase, startEditQuestion } from '../rules/questions.js';
import { applyAdjustment, newGame } from '../rules/score.js';
import { finalizeWager, revealWagerQuestion } from '../rules/wager.js';
import { resolvedOutcomeFor, wheelOutcomeResultText } from '../rules/wheel.js';
import { diffPill, ladderStripHTML } from '../ui/atoms.js';
import { chairIconSVG } from '../ui/icons.js';
import { setPendingModal, showModal, showPicker } from '../ui/modal.js';
import { buildBoardHTML, buildKeyboardHTML, puzzleTimerHTML, startPuzzleTimerRAF } from '../ui/puzzle-view.js';
import { animateWheel, buildWheelHTML, wheelResultText } from '../ui/wheel-view.js';
import { renderEndScreen } from './entry.js';

export function renderHost(){
  if(mode!=='host') return;
  const root=document.getElementById('app-root');
  // preserve input values
  const preserve=['q-text','q-opt-a','q-opt-b','q-opt-c','q-opt-d','phrase-cat','phrase-text','player-name-input','setup-team-a','setup-team-b','adjust-amount','adjust-reason'];
  const saved={};
  preserve.forEach(id=>{ const el=document.getElementById(id); if(el) saved[id]=el.value; });
  const savedTeamSel=document.getElementById('player-team-input')?.value;
  const savedDiff=document.getElementById('q-diff')?.value;
  const savedAdjTarget=document.getElementById('adjust-target')?.value;

  const syncWarn=hasSupabase?'':
    `<div class="sync-warning">⚠ Supabase not configured — running in single-device mode. Phone voting and multi-device sync require Supabase. Add your credentials to the file.</div>`;

  // Topbar
  const hp=hotSeatPlayer();
  const ll=state.lifelines[state.hotSeatTeam];
  const teamAPlayers=state.players.filter(p=>p.team==='A');
  const teamBPlayers=state.players.filter(p=>p.team==='B');
  const setupLocked=state.gamePhase==='setup';
  const activeHostTab=setupLocked&&hostTab!=='rules'?'setup':hostTab;

  const topbar=`<div class="topbar">
    <span class="topbar-brand" style="display:inline-flex;align-items:center;">
      <span style="width:30px;height:auto;flex-shrink:0;">${chairIconSVG()}</span>
    </span>
    <span class="topbar-code">${esc(state.lobbyName||currentLobbyCode)}</span>
    <div class="tabs">
      <button class="tab-btn ${activeHostTab==='setup'?'active':''}" onclick="setHostTab('setup')">1 · Setup</button>
      <button class="tab-btn ${activeHostTab==='game'?'active':''}" ${setupLocked?'disabled title="Finish setup and Start Hosting first"':''} onclick="setHostTab('game')">2 · Play</button>
      <button class="tab-btn ${activeHostTab==='rules'?'active':''}" onclick="setHostTab('rules')">Rules</button>
    </div>
    <div style="margin-left:auto;display:flex;gap:8px;align-items:center;position:relative;">
      <button class="btn btn-ghost btn-sm" onclick="openDisplay()">Display</button>
      <div style="position:relative;">
        <button class="btn btn-ghost btn-sm" onclick="togglePlayerLinkPopover()">Players</button>
        <div id="player-link-popover" class="link-popover">
          <input type="text" id="player-link-input" class="input" readonly onclick="this.select()">
          <button class="btn btn-primary btn-sm" id="player-link-copy-btn" onclick="copyPlayerLinkFromPopover()">Copy</button>
        </div>
      </div>
      <div style="width:1px;height:22px;background:var(--c-border);margin:0 2px;"></div>
      <button class="btn btn-ghost btn-sm btn-icon" onclick="openHostMoreMenu()" title="More">⋯</button>
    </div>
  </div>`;

  // Reference strip — secondary info (teams/scores + ladder + pacing), not primary controls
  const isRaceMode=state.gameMode==='race';
  const ladderBar=state.gamePhase==='live'||state.gamePhase==='wager'||state.gamePhase==='puzzle'?
    `<div class="ref-strip">
      <div class="team-strip" style="row-gap:6px;">
        <span class="team-label">${esc(state.teamAName)}</span>
        ${isRaceMode?`<span class="money-sm">Level ${activeLevel('A')}</span>`:`<span class="money-sm">${money(state.teamABank)}</span>`}
        ${teamAPlayers.map(p=>`<button class="player-chip ${state.hotSeatPlayerId===p.id?'is-hot':''}" onclick="setHotSeat('${p.id}')">${esc(p.name)}${isRaceMode?'':`<span class="chip-bank">${money(p.personalBank)}</span>`}</button>`).join('')}
        <div class="ref-strip-divider"></div>
        <span class="team-label">${esc(state.teamBName)}</span>
        ${isRaceMode?`<span class="money-sm">Level ${activeLevel('B')}</span>`:`<span class="money-sm">${money(state.teamBBank)}</span>`}
        ${teamBPlayers.map(p=>`<button class="player-chip ${state.hotSeatPlayerId===p.id?'is-hot':''}" onclick="setHotSeat('${p.id}')">${esc(p.name)}${isRaceMode?'':`<span class="chip-bank">${money(p.personalBank)}</span>`}</button>`).join('')}
      </div>
      <div class="ref-strip-ladder">
        ${isRaceMode?`
          <span style="font-size:11px;color:var(--c-muted);text-transform:uppercase;letter-spacing:0.08em;font-weight:700;margin-right:4px;">${esc(state.teamAName)}</span>
          ${ladderStripHTML('A')}
          <span style="font-size:11px;color:var(--c-muted);text-transform:uppercase;letter-spacing:0.08em;font-weight:700;margin:0 4px 0 10px;">${esc(state.teamBName)}</span>
          ${ladderStripHTML('B')}
        `:`
          <span style="font-size:11px;color:var(--c-muted);text-transform:uppercase;letter-spacing:0.08em;font-weight:700;margin-right:4px;">Level</span>
          ${ladderStripHTML()}
          <span class="money-sm" style="margin-left:8px;">${money(levelMoney(state.ladderCurrent))} up</span>
        `}
        ${state.hostingStartedAt?`<span class="pacing-badge" title="Time since hosting started">⏱ ${elapsedMinutes()}m in</span>`:''}
      </div>
    </div>`:'';

  let body='';
  if(hostTab==='rules'){
    body=renderRulesTab();
  } else if(state.gamePhase==='setup'||hostTab==='setup'){
    body=renderSetupTab();
  } else if(state.gamePhase==='ended'){
    body=renderEndedHost();
  } else if(state.gamePhase==='wager'){
    body=renderWagerTab();
  } else {
    body=renderGameTab();
  }

  root.innerHTML=`${topbar}${ladderBar}
    <div class="main-content">
      ${syncWarn}
      ${body}
    </div>`;

  // Restore inputs
  preserve.forEach(id=>{ const el=document.getElementById(id); if(el&&saved[id]!==undefined) el.value=saved[id]; });
  if(savedTeamSel){ const el=document.getElementById('player-team-input'); if(el) el.value=savedTeamSel; }
  if(savedDiff){ const el=document.getElementById('q-diff'); if(el) el.value=savedDiff; }
  if(savedAdjTarget){ const el=document.getElementById('adjust-target'); if(el) el.value=savedAdjTarget; }

  // Wire team name inputs
  const ta=document.getElementById('setup-team-a');
  const tb=document.getElementById('setup-team-b');
  if(ta) ta.addEventListener('input', debounce(e=>{ state.teamAName=e.target.value; saveLobby(); },400));
  if(tb) tb.addEventListener('input', debounce(e=>{ state.teamBName=e.target.value; saveLobby(); },400));

  // Wheel animation (only once it's actually been spun)
  if(state.wheel&&state.wheel.spunAt&&state.wheel.spunAt!==lastWheelSeen){
    setLastWheelSeen(state.wheel.spunAt);
    animateWheel(state.wheel,'host');
  } else if(state.wheel&&state.wheel.spunAt){
    const disc=document.getElementById('wheel-disc-host');
    if(disc){ const n=state.wheel.names.length,seg=360/n; disc.style.transition='none'; disc.style.transform=`rotate(${360*6+(360-(state.wheel.winnerIdx*seg+seg/2))}deg)`; }
    const res=document.getElementById('wheel-result-host');
    if(res) res.textContent=state.wheel.outcomes?wheelOutcomeResultText(resolvedOutcomeFor(state.wheel)):wheelResultText(state.wheel);
  }

  // Puzzle timer RAF
  if(state.puzzle.active&&!state.puzzle.timerPaused) startPuzzleTimerRAF();
}

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

export function renderGameTab(){
  const lt=levelType(activeLevel());
  const isPuzzleLevel=lt==='puzzle';
  const hp=hotSeatPlayer();
  let html='';

  // Puzzle active
  if(state.puzzle.active){
    html+=renderPuzzleControls();
  }
  // Steal / wheel
  else if(state.wheel){
    html+=state.wheel.kind==='bomb'?renderBombWheel():renderStealWheel();
  } else if(state.steal&&state.steal.outcome==='defended'){
    html+=`<div class="steal-box">
      <div class="steal-title">Nobody stole it</div>
      <p style="font-size:14px;margin-bottom:14px;">${esc(hp?hp.name:'Hot seat player')} keeps the seat. Drawing a fresh question at the same level.</p>
      <button class="btn btn-primary" onclick="dismissDefendedSteal()">Continue — New Question</button>
    </div>`;
  }
  // Wager active handled by renderWagerTab
  // Normal question flow - always show flow card unless puzzle active
  if(!state.puzzle.active){
    html+=renderFlowCard(isPuzzleLevel);
  }
  return `<div class="play-layout"><div>${html}</div>${renderQuickAdjustRail()}</div>`;
}

export function renderQuickAdjustRail(){
  const step=25;
  const teamRows=[
    {label:state.teamAName,target:'teamA',value:state.teamABank},
    {label:state.teamBName,target:'teamB',value:state.teamBBank},
  ].map(t=>`<div class="qa-row">
    <span class="qa-name">${esc(t.label)}</span>
    <span class="qa-amount">${money(t.value)}</span>
    <span class="qa-steppers">
      <button class="qa-btn" onclick="quickAdjust('${t.target}',null,-${step})" title="-${money(step)}">−</button>
      <button class="qa-btn" onclick="quickAdjust('${t.target}',null,${step})" title="+${money(step)}">+</button>
    </span>
  </div>`).join('');
  const playerRows=state.players.map(p=>`<div class="qa-row">
    <span class="qa-name">${esc(p.name)}</span>
    <span class="qa-amount">${money(p.personalBank)}</span>
    <span class="qa-steppers">
      <button class="qa-btn" onclick="quickAdjust('player','${p.id}',-${step})" title="-${money(step)}">−</button>
      <button class="qa-btn" onclick="quickAdjust('player','${p.id}',${step})" title="+${money(step)}">+</button>
    </span>
  </div>`).join('');
  return `<div class="quick-adjust-rail">
    <div class="qa-title">Quick Adjust</div>
    <div class="qa-section-label">Teams</div>
    ${teamRows}
    <div class="qa-section-label">Players</div>
    ${playerRows}
    <button class="btn-link" onclick="openAdjustModal()">Custom amount / reason…</button>
  </div>`;
}

export async function quickAdjust(targetType,targetId,amount){
  await applyAdjustment(targetType,targetId,amount,'Quick adjust');
}

export function renderFlowCard(isPuzzleLevel){
  const q=state.currentQuestion; const f=state.flow;
  const ll=state.lifelines[state.hotSeatTeam]; const s=state.steal;

  if(isPuzzleLevel&&!state.puzzle.active&&!q) return `<div class="flow-card">
    <div class="flow-level">Level ${activeLevel()} — Puzzle Round</div>
    <div class="flow-controls"><button class="btn btn-primary" onclick="triggerPuzzle()">Trigger the Glitch</button></div>
  </div>`;

  if(!q){
    const avail=state.questions.filter(x=>!x.used).length;
    return `<div class="flow-card">
      <div class="flow-level">Level ${activeLevel()} — ${diffPill(levelDiff(activeLevel()))}</div>
      <p style="font-size:14px;color:var(--c-muted);margin-bottom:16px;">${avail} unused question${avail===1?'':'s'}.</p>
      <div class="flow-controls"><button class="btn btn-primary" onclick="hostDrawQuestion()">Draw Question</button></div>
    </div>`;
  }

  const isMC=q.options.length>1;
  const correctIdx=correctDisplayIdx(q);
  const stage=f.stage;

  // Determine what's visible/active at each stage
  const qRevealed = stage!=='idle';
  // optsRevealed means ALL options are shown (post-options stage)
  const allOptsShown = ['selecting','revealing','revealed','doubledip-miss','race-miss','steal-peek','steal-locked','steal-reveal'].includes(stage);

  // QUESTION SLOT
  let questionSlot='';
  if(stage==='idle'){
    questionSlot=`<button class="flow-reveal-btn" onclick="flowAdvance()">▶ Reveal Question</button>`;
  } else {
    questionSlot=`<div class="flow-q" style="margin:0;">${esc(q.text)}</div>`;
  }

  // OPTIONS SLOTS — each slot is either a reveal button, a content div, or a tap-to-pick button
  let optSlots='';
  if(isMC){
    optSlots='<div class="flow-opts" style="margin-top:10px;">'+q.displayOrder.map((origIdx,di)=>{
      const isCorrect=origIdx===0;
      const isHSPick=f.hotSeatAnswer===di;
      // Is this option revealed yet?
      const thisRevealed=(stage==='options'&&di<f.optionsRevealed)||allOptsShown;
      // Is this the NEXT slot to reveal?
      const nextToReveal=(stage==='options'&&di===f.optionsRevealed)||(stage==='question'&&di===0);

      if(!qRevealed){
        return `<div class="flow-opt" style="opacity:0.1;height:44px;"></div>`;
      }
      if(!thisRevealed){
        if(nextToReveal){
          return `<button class="flow-reveal-btn" onclick="flowAdvance()">▶ Reveal ${letterFor(di)}</button>`;
        }
        return `<div class="flow-opt" style="opacity:0.1;height:44px;"></div>`;
      }
      // Option is revealed
      const isDDMiss=f.doubleDipMissIdx===di;
      if(stage==='selecting'){
        if(isDDMiss){
          return `<div class="flow-opt wrong-pick"><span class="flow-opt-letter">${letterFor(di)})</span>${esc(q.options[origIdx])} <span style="font-size:11px;">— already wrong</span></div>`;
        }
        return `<button class="flow-opt" style="cursor:pointer;text-align:left;width:100%;border-color:var(--c-border2);" onclick="hostSelectAnswer(${di})">
          <span class="flow-opt-letter">${letterFor(di)})</span>${esc(q.options[origIdx])}
        </button>`;
      }
      if(stage==='steal-peek'){
        if(isHSPick||isDDMiss){
          return `<div class="flow-opt dim" style="opacity:0.35;"><span class="flow-opt-letter">${letterFor(di)})</span>${esc(q.options[origIdx])} <span style="font-size:11px;">— already wrong</span></div>`;
        }
        const stealNil=s?getNextInLine(s.panelTeam):null;
        const stealVote=stealNil?s.votes[stealNil.id]:undefined;
        const isPicked=stealVote===di;
        return `<button class="flow-opt${isPicked?' answer-flash':''}" style="cursor:pointer;text-align:left;width:100%;${isPicked?'border-color:var(--c-gold);':'border-color:var(--c-border2);'}" onclick="hostSetStealVote(${di})">
          <span class="flow-opt-letter">${letterFor(di)})</span>${esc(q.options[origIdx])}
        </button>`;
      }
      if(stage==='steal-locked'){
        if(isHSPick||isDDMiss){
          return `<div class="flow-opt dim" style="opacity:0.35;"><span class="flow-opt-letter">${letterFor(di)})</span>${esc(q.options[origIdx])} <span style="font-size:11px;">— already wrong</span></div>`;
        }
        const stealNil=s?getNextInLine(s.panelTeam):null;
        const stealVote=stealNil?s.votes[stealNil.id]:undefined;
        const isPicked=stealVote===di;
        return `<div class="flow-opt${isPicked?' answer-flash':''}"><span class="flow-opt-letter">${letterFor(di)})</span>${esc(q.options[origIdx])}</div>`;
      }
      // Post-selection display
      const stealNil2=s?getNextInLine(s.panelTeam):null;
      const stealVote2=stealNil2?s.votes[stealNil2.id]:undefined;
      const isStealPick=stage==='steal-reveal'&&stealVote2===di;
      let cls='flow-opt';
      if(isHSPick&&(stage==='revealing'||stage==='revealed'||stage==='race-miss')) cls+=' answer-flash';
      if(isHSPick&&stage==='doubledip-miss') cls+=' wrong-pick';
      if(isDDMiss&&!isHSPick) cls+=' wrong-pick';
      if(isStealPick) cls+=isCorrect?' correct':' wrong-pick';
      else if(stage==='steal-reveal'&&isHSPick) cls+=' wrong-pick';
      if(stage==='steal-reveal'&&isCorrect&&!isHSPick&&!isStealPick) cls+=' correct';
      if((stage==='revealed'||stage==='doubledip-miss'||stage==='race-miss')&&!isHSPick&&!isDDMiss) cls+=' dim';
      if(stage==='steal-reveal'&&!isCorrect&&!isHSPick&&!isStealPick&&!isDDMiss) cls+=' dim';
      return `<div class="${cls}"><span class="flow-opt-letter">${letterFor(di)})</span>${esc(q.options[origIdx])}${isCorrect&&stage==='steal-reveal'?' ✓':''}</div>`;
    }).join('')+'</div>';
  } else if(qRevealed){
    optSlots=`<div style="margin:10px 0;padding:10px 14px;background:var(--c-surface2);border:1px solid var(--c-border);border-radius:8px;font-size:14px;">
      ${stage==='steal-reveal'?`<b style="color:var(--c-green-light);">${esc(q.options[0])}</b>`:'<span style="color:var(--c-muted);">Hidden answer</span>'}
    </div>`;
  }

  // POST-OPTIONS ACTION SLOT
  let actionSlot='';
  if(stage==='revealing'){
    actionSlot=`<button class="btn btn-primary btn-block" style="margin-top:6px;" onclick="confirmHotSeatReveal()">▶ Reveal Answer</button>
      <button class="btn-changepick" onclick="changeHotSeatPick()">✎ Misheard? Change pick</button>`;
  } else if(stage==='revealed'){
    if(f.hotSeatAnswer===correctIdx){
      actionSlot=`<button class="btn btn-success btn-block" style="margin-top:6px;" onclick="markCorrect()">✓ Correct — Bank &amp; Advance</button>
      <button class="btn-changepick" onclick="changeHotSeatPick()">✎ Misheard? Change pick</button>`;
    }
  } else if(stage==='doubledip-miss'){
    actionSlot=`<div style="font-size:13px;color:var(--c-gold);margin-top:6px;padding:8px;background:var(--c-surface2);border-radius:8px;text-align:center;">Double Dip! One more guess — no steal risk yet.</div>
      <button class="btn btn-primary btn-block" style="margin-top:6px;" onclick="retryDoubleDip()">Try Again</button>
      <button class="btn-changepick" onclick="changeHotSeatPick()">✎ Misheard? Change pick</button>`;
  } else if(stage==='race-miss'){
    const other=opposingTeam(state.hotSeatTeam);
    actionSlot=`<div style="font-size:13px;color:var(--c-muted);margin-top:6px;padding:8px;background:var(--c-surface2);border-radius:8px;text-align:center;">Miss — the seat passes to ${esc(teamName(other))}.</div>
      <button class="btn btn-primary btn-block" style="margin-top:6px;" onclick="raceSwapAfterMiss()">Swap to ${esc(teamName(other))} →</button>
      <button class="btn-changepick" onclick="changeHotSeatPick()">✎ Misheard? Change pick</button>`;
  } else if(stage==='steal-peek'){
    const stealNilA=s?getNextInLine(s.panelTeam):null;
    const stealVoteA=stealNilA?s.votes[stealNilA.id]:undefined;
    actionSlot=(stealVoteA!==undefined
      ?`<button class="btn btn-primary btn-block" style="margin-top:6px;" onclick="lockStealAnswer()">▶ Lock In Their Answer</button>`
      :`<div style="font-size:13px;color:var(--c-muted);padding:8px;background:var(--c-surface2);border-radius:8px;text-align:center;margin-top:6px;">Tap their answer above</div>`)
      +`<button class="btn-changepick" onclick="changeHotSeatPick()">✎ Misheard the original answer? Change pick</button>`;
  } else if(stage==='steal-locked'){
    actionSlot=`<button class="btn btn-primary btn-block" style="margin-top:6px;" onclick="revealCorrectAnswer()">▶ Reveal Correct Answer</button>
      <button class="btn-changepick" onclick="unlockStealAnswer()">✎ Change their pick</button>`;
  } else if(stage==='steal-reveal'){
    const nil=s?getNextInLine(s.panelTeam):null;
    const theirVote=nil?s.votes[nil.id]:undefined;
    actionSlot=theirVote===correctIdx
      ?`<button class="btn btn-success btn-block" style="margin-top:6px;" onclick="resolveSteal()">✓ Steal — Hand Over Seat</button>`
      :`<button class="btn btn-error btn-block" style="margin-top:6px;" onclick="advanceLevelNoMoney()">Nobody Got It — Next Level</button>`;
  }

  // Vote status (shown before a wrong pick creates the steal — placeholder line, no vote possible yet)
  let voteStatus='';
  if(['question','options','selecting','revealing'].includes(stage)&&s){
    const nil=getNextInLine(s.panelTeam);
    if(nil){
      const voted=s.votes[nil.id]!==undefined;
      voteStatus=`<div style="font-size:12px;color:var(--c-muted);padding:6px 0;border-top:1px dashed var(--c-border);margin-top:8px;">
        ${esc(nil.name)} — ${voted?'<span style="color:var(--c-green-light);">locked in ✓</span>':'waiting…'}
      </div>`;
    }
  }

  const showLL=['question','options','selecting'].includes(stage);
  const kbHints={idle:'⌨ Space to reveal',question:isMC?'⌨ Space for next option':'⌨ Space to reveal',options:'⌨ Space for next option',selecting:'⌨ 1–4 to pick',
    revealed:(f.hotSeatAnswer===correctIdx?'⌨ Space to bank & advance':''),'doubledip-miss':'⌨ Space to try again','race-miss':'⌨ Space to swap teams','steal-peek':'⌨ 1–4 for their pick','steal-locked':'⌨ Space to reveal'};
  const kbHint=kbHints[stage]||'';

  return `<div class="flow-card">
    <div class="flow-level" style="display:flex;align-items:center;justify-content:space-between;">
      <span>Level ${q.level} — ${diffPill(q.difficulty)}</span>
      ${stage==='idle'||stage==='question'?`<button class="btn btn-ghost btn-sm" onclick="rerollQuestion()">Reroll</button>`:''}
    </div>
    <div class="flow-slot">${questionSlot}</div>
    ${optSlots}
    ${actionSlot}
    ${voteStatus}
    ${showLL?`<div class="flow-lifelines" style="margin-top:10px;">${LIFELINE_DEFS.filter(({key})=>!(state.gameMode==='race'&&(key==='bomb'||key==='doubleDip'))).map(({key,label,icon})=>
      ll[key]
        ? `<button class="btn btn-ghost btn-sm" style="opacity:0.35;" disabled>${label}</button><button class="btn btn-ghost btn-sm" title="Undo (testing)" onclick="undoLifeline('${key}')" style="padding:6px 8px;">↺</button>`
        : `<button class="btn btn-ghost btn-sm" onclick="useLifeline('${key}')">${label}</button>`
    ).join('')}</div>`:''}
    ${kbHint?`<div class="kb-hint">${kbHint}</div>`:''}
  </div>`;
}


export function renderStealWheel(){
  return `<div class="steal-box">
    <div class="steal-title">Tie-breaker — Multiple correct answers</div>
    ${buildWheelHTML(state.wheel,'host')}
    <div class="flow-controls" style="justify-content:center;margin-top:14px;">
      <button class="btn btn-primary" onclick="confirmWheelWinner()">Confirm Winner</button>
    </div>
  </div>`;
}

export function renderBombWheel(){
  return `<div class="steal-box" style="border-color:var(--c-purple);">
    <div class="steal-title" style="color:#c070f0;">Wildcard — Spin the Chance Wheel</div>
    ${buildWheelHTML(state.wheel,'host')}
    <div class="flow-controls" style="justify-content:center;margin-top:14px;">
      ${!state.wheel.spunAt
        ?`<button class="btn btn-primary" onclick="spinWheel()">Spin!</button><div class="hint" style="width:100%;text-align:center;margin-top:6px;">Or let a player spin from their phone.</div>`
        :`<button class="btn btn-primary" onclick="confirmBombWheel()">Confirm Result</button>`}
    </div>
  </div>`;
}

export function renderPuzzleControls(){
  const puz=state.puzzle;
  return `<div class="flow-card" style="border-color:var(--c-purple);">
    <div class="flow-level">Puzzle — ${esc(teamName(puz.currentGuessingTeam))} is guessing</div>
    ${puz.category?`<div style="text-align:center;color:var(--c-gold);font-size:13px;text-transform:uppercase;letter-spacing:0.14em;margin-bottom:10px;">${esc(puz.category)}</div>`:''}
    <div class="puzzle-board">${buildBoardHTML(puz)}</div>
    ${buildKeyboardHTML(puz)}
    ${(puz.timerStartedAt||puz.timerElapsed)?puzzleTimerHTML(puz,'host'):'<div class="hint text-center">Timer starts after first letter.</div>'}
    <div class="hint" style="margin-top:8px;">Answer: <b style="color:var(--c-gold-light);">${esc(puz.phrase)}</b></div>
    <div class="flow-controls" style="margin-top:14px;">
      <button class="btn btn-success" onclick="puzzleSolved()">✓ Solved — Next Level</button>
      ${puz.timerPaused&&puz.timerStartedAt?`<button class="btn btn-ghost btn-sm" onclick="resumePuzzleTimer()">▶ Resume</button>`:''}
      ${!puz.timerPaused?`<button class="btn btn-ghost btn-sm" onclick="pausePuzzleTimer()">⏸ Pause</button>`:''}
      <button class="btn btn-ghost btn-sm" onclick="swapPuzzleHotSeat()">Swap Hot Seat</button>
    </div>
  </div>`;
}

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

export function renderSetupTab(){
  const players=state.players;
  const aCount=players.filter(p=>p.team==='A').length;
  const bCount=players.filter(p=>p.team==='B').length;
  const qCount=state.questions.length;
  const hardFail=players.length<2||aCount<1||bCount<1;
  const checks=[
    {ok:players.length>=2,text:`Players: ${players.length} added (need ≥2)`},
    {ok:aCount>=1&&bCount>=1,text:`Both teams have players (${state.teamAName}: ${aCount}, ${state.teamBName}: ${bCount})`},
    {ok:qCount>=15,level:qCount>=15?'ok':qCount>=5?'warn':'bad',text:`Questions: ${qCount} in pool (recommend ≥15)`},
  ];

  const playersBody=`
    ${state.players.length===0&&state.questions.length===0?`<div class="quickstart-row">
      <span>Just want to try it out?</span>
      <button class="btn btn-ghost btn-sm" onclick="loadTestData()">Load Test Data</button>
    </div>`:''}
    <div class="field" style="margin-bottom:16px;">
      <label>Game Mode</label>
      <div class="mode-toggle">
        <button class="mode-opt ${state.gameMode==='classic'?'is-active':''}" onclick="setGameMode('classic')">
          <b>Classic</b><span>Shared ladder, team money, steals &amp; Final Wager</span>
        </button>
        <button class="mode-opt ${state.gameMode==='race'?'is-active':''}" onclick="setGameMode('race')">
          <b>Race Mode</b><span>Separate ladders — first team to level 15 wins, no money</span>
        </button>
      </div>
    </div>
    <div class="two-col">
      <div>
        <div class="field"><label>Name</label><input type="text" class="input" id="player-name-input" placeholder="Player name"></div>
        <div class="field"><label>Team</label><select class="input" id="player-team-input"><option value="A">${esc(state.teamAName)}</option><option value="B">${esc(state.teamBName)}</option></select></div>
        <button class="btn btn-primary btn-sm" onclick="addPlayer()">+ Add Player</button>
        <hr class="divider">
        <div class="field"><label>Team A name</label><input type="text" class="input" id="setup-team-a" value="${esc(state.teamAName)}"></div>
        <div class="field"><label>Team B name</label><input type="text" class="input" id="setup-team-b" value="${esc(state.teamBName)}"></div>
      </div>
      <div class="q-list">
        ${players.length===0?'<div class="hint">No players yet.</div>':players.map(p=>`
          <div class="q-row">
            <div class="q-row-text"><b>${esc(p.name)}</b><div class="q-row-sub">${esc(teamName(p.team))}</div></div>
            <div class="q-row-actions">
              <button class="btn btn-ghost btn-sm" onclick="togglePlayerTeam('${p.id}')">Switch Team</button>
              <button class="btn btn-danger btn-sm" onclick="showModal('','Remove ${esc(p.name)}?','Remove',()=>deletePlayer('${p.id}'))">✕</button>
            </div>
          </div>`).join('')}
      </div>
    </div>`;

  const levelRow=l=>`
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <span style="width:20px;font-weight:700;font-size:13px;color:var(--c-muted);">${l}</span>
        <span class="money-sm" style="width:76px;">${money(LEVEL_MONEY[l-1])}</span>
        <button class="btn btn-ghost btn-sm" style="min-width:72px;${state.levelTypes[l-1]==='puzzle'?'border-color:var(--c-purple);color:#c070f0;':''}" onclick="toggleLevelType(${l})">
          ${state.levelTypes[l-1]==='puzzle'?'Puzzle':'Trivia'}
        </button>
      </div>`;
  const levelBody=`<div class="hint" style="margin-bottom:10px;">All levels default to Easy unless changed. Set a level to Puzzle to use a word puzzle instead of a question.</div>
    <div class="two-col">
      <div>${Array.from({length:8},(_,i)=>i+1).map(levelRow).join('')}</div>
      <div>${Array.from({length:7},(_,i)=>i+9).map(levelRow).join('')}</div>
    </div>`;

  const phraseBody=`
    <div class="row">
      <div class="field"><label>Category</label><input type="text" class="input" id="phrase-cat" placeholder="Movie Title"></div>
      <div class="field w2"><label>${editingPhrase?'Editing phrase':'Phrase'}</label><input type="text" class="input" id="phrase-text" placeholder="THE FULL ANSWER IN CAPS"></div>
    </div>
    <div class="row">
      <button class="btn btn-primary btn-sm" onclick="savePhraseFromForm()">${editingPhrase?'Save Changes':'Add Phrase'}</button>
      ${editingPhrase?'<button class="btn btn-ghost btn-sm" onclick="cancelEditPhrase()">Cancel</button>':''}
    </div>
    <div class="q-list">
      ${state.phraseBank.length===0?'<div class="hint">No phrases yet.</div>':state.phraseBank.map(p=>`
        <div class="q-row ${editingPhrase===p.id?'editing':''}">
          <div class="q-row-text">${p.category?`<span class="diff-puzzle" style="margin-right:6px;">${esc(p.category)}</span>`:''}${esc(p.phrase)}</div>
          <div class="q-row-actions">
            ${p.used?'<span class="used-tag">Used</span>':''}
            <button class="btn btn-ghost btn-sm" onclick="startEditPhrase('${p.id}')">Edit</button>
            <button class="btn btn-danger btn-sm" onclick="showModal('','Delete this phrase?','Delete',()=>deletePhrase('${p.id}'))">✕</button>
          </div>
        </div>`).join('')}
    </div>`;

  const readyBody=`
    <div class="checklist">
      ${checks.map(c=>`<div class="check-item"><span class="${c.ok?'check-ok':'check-bad'}">${c.ok?'✓':'✗'}</span>${esc(c.text)}</div>`).join('')}
    </div>
    <button class="btn btn-primary btn-block mt-12" ${hardFail?'disabled':''} onclick="startHosting()">Start Hosting</button>
    ${hardFail?'<div class="hint mt-8">Fix issues above to start.</div>':''}`;

  const steps=[
    {key:'players', num:1, icon:'', label:'Players & Teams', body:playersBody},
    {key:'questions', num:2, icon:'', label:'Questions', body:renderQuestionsTab()},
    {key:'levels', num:3, icon:'', label:'Levels & Puzzles', body:levelBody+'<hr class="divider">'+phraseBody},
    {key:'ready', num:4, icon:'', label:'Ready Check', body:readyBody},
  ];
  if(!steps.some(s=>s.key===setupStep)) setSetupStep('players');
  const idx=steps.findIndex(s=>s.key===setupStep);
  const cur=steps[idx];

  const stepRail=`<div class="setup-steps">
    ${steps.map(s=>`<button class="setup-step-pill ${s.key===setupStep?'active':''}" onclick="goSetupStep('${s.key}')">
      <span class="setup-step-num">${s.num}</span>${s.label}
    </button>`).join('')}
  </div>`;

  const prevBtn=idx>0?`<button class="btn btn-ghost" onclick="goSetupStep('${steps[idx-1].key}')">← Back</button>`:'<span></span>';
  const nextBtn=idx<steps.length-1?`<button class="btn btn-primary" onclick="goSetupStep('${steps[idx+1].key}')">Next →</button>`:'<span></span>';

  return `${stepRail}
    <div class="card" style="max-width:1100px;margin:0 auto;">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.1em;color:var(--c-gold);font-weight:700;margin-bottom:14px;">${cur.label}</div>
      ${cur.body}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:20px;padding-top:16px;border-top:1px solid var(--c-border);">
        ${prevBtn}${nextBtn}
      </div>
    </div>`;
}
export function goSetupStep(step){ setSetupStep(step); renderHost(); }
export async function setGameMode(m){
  if(state.gamePhase!=='setup') return; // locked once hosting has started
  state.gameMode=m;
  await saveLobby(); renderHost();
}

export function renderQuestionsTab(){
  const byDiff={easy:[],medium:[],hard:[]};
  state.questions.forEach(q=>{ (byDiff[q.difficulty]||byDiff.easy).push(q); });
  const formHtml=`
    <div class="card card-sm" style="margin-bottom:14px;">
      <div style="font-size:13px;font-weight:700;color:var(--c-gold);margin-bottom:10px;">${editingQuestion?'Editing Question':'New Question'}</div>
      <div class="field"><label>Question</label><textarea class="input" id="q-text" rows="2" placeholder="Question text"></textarea></div>
      <div class="field">
        <label>Answers — <b style="color:var(--c-gold-light);">A is always correct</b>; fill only A for hidden-answer</label>
        <div class="row"><div class="field"><input type="text" class="input" id="q-opt-a" placeholder="A — correct answer"></div><div class="field"><input type="text" class="input" id="q-opt-b" placeholder="B (optional)"></div></div>
        <div class="row"><div class="field"><input type="text" class="input" id="q-opt-c" placeholder="C (optional)"></div><div class="field"><input type="text" class="input" id="q-opt-d" placeholder="D (optional)"></div></div>
      </div>
      <div class="field"><label>Difficulty</label><select class="input" id="q-diff"><option value="easy">Easy (Levels 1-5)</option><option value="medium">Medium (Levels 6-10)</option><option value="hard">Hard (Levels 11-15)</option></select></div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-primary" onclick="saveQuestionFromForm()">${editingQuestion?'Save':'Add Question'}</button>
        ${editingQuestion?'<button class="btn btn-ghost btn-sm" onclick="cancelEditQuestion()">Cancel</button>':''}
      </div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn btn-ghost btn-sm" onclick="exportQuestionsMarkdown()">Export .md</button>
      <label class="btn btn-ghost btn-sm" style="cursor:pointer;">Import .md <input type="file" accept=".md,.txt" style="display:none;" onchange="importQuestionsMarkdown(this.files[0])"></label>
      <button class="btn btn-ghost btn-sm" onclick="showModal('','Reset all used flags for questions and phrases?','Reset All',resetAllUsedFlags)">Reset All Used Flags</button>
    </div>
  `;
  const listHtml=['easy','medium','hard'].map(diff=>{
    const qs=byDiff[diff];
    return `<div style="margin-bottom:16px;">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;margin-bottom:6px;">${diffPill(diff)} — ${qs.length} question${qs.length===1?'':'s'}</div>
      <div class="q-list">
        ${qs.length===0?`<div class="hint">No ${diff} questions yet.</div>`:qs.map(q=>`
          <div class="q-row ${editingQuestion===q.id?'editing':''}">
            <div class="q-row-text">
              ${esc(q.text)}
              <div class="q-row-sub">✓ ${esc((q.options||[])[0]||'')} · ${(q.options||[]).length} option${(q.options||[]).length===1?' (hidden)':'s'}</div>
            </div>
            <div class="q-row-actions">
              ${q.used?'<span class="used-tag">Used</span>':''}
              <button class="btn btn-ghost btn-sm" onclick="startEditQuestion('${q.id}')">Edit</button>
              <button class="btn btn-danger btn-sm" onclick="showModal('','Delete this question?','Delete',()=>deleteQuestion('${q.id}'))">✕</button>
            </div>
          </div>`).join('')}
      </div>
    </div>`;
  }).join('');
  return `<div class="two-col"><div>${formHtml}</div><div>${listHtml}</div></div>`;
}

export function renderRulesTab(){
  return `<div class="card rules-card">
    <div class="rules-body">
    <h2>The Game</h2>
    <p>Two teams. One player sits in the hot seat and climbs a shared 15-level money ladder. Correct answers bank ${money(100)} to ${money(1500)} per level to the hot seat player personally and to their team. The hot seat player only ever wins what they personally banked.</p>
    <h2>Question Flow</h2>
    <p>Host draws a question, reveals it, then reveals answer options one at a time. The hot seat player has unlimited time. Lifelines are available once options are shown, until the player locks in an answer.</p>
    <h2>Getting It Wrong — The Steal</h2>
    <p>The opposing team's next-in-line panelist (rotates person to person each time) gets a shot at the same question — locked in by phone, or tapped in manually by the host. Correct: they steal the hot seat, take that level's money, and the ladder climbs. Wrong: the original hot seat player keeps their seat, nobody earns that level's money, but the ladder still climbs to the next level either way.</p>
    <h2>Puzzle Rounds</h2>
    <p>Any level the host marks as a Puzzle Round (Setup → Level Types) swaps the trivia question for a word-guess board. A glitch takes over the screen, and teams alternate calling letters. Every letter pick — hit or miss — resets a 20-second clock for the currently guessing team to shout the full phrase; if it runs out, the hot seat swaps to the other team. Whoever's in the hot seat when the phrase is solved earns that level's money.</p>
    <h2>Final Wager (before Level 15)</h2>
    <p>All players secretly set a wager from their personal bank on their phones. The host reveals the question. Hot seat player answers. Correct: everyone who wagered wins their wager. Wrong: hot seat bounces to the other team; everyone loses their wager.</p>
    <h2>Lifelines (one set per team per game)</h2>
    ${LIFELINE_DEFS.map(({label,desc})=>`<div class="rules-ll"><div><b>${label}</b>${desc}</div></div>`).join('')}
    <h2>Manual Adjustments</h2>
    <p>Use the Quick Adjust panel during the game to add or subtract money for shouting penalties, corrections, or anything else. Amounts can be negative.</p>
    </div>
  </div>`;
}

export function renderEndedHost(){
  return renderEndScreen();
}

export async function toggleLevelType(l){
  state.levelTypes[l-1]=state.levelTypes[l-1]==='puzzle'?'':'puzzle';
  await saveLobby(); renderHost();
}

export function setHostTab(t){ setActiveHostTab(t); renderHost(); }
export function openDisplay(){
  const url=new URL(location.href); url.searchParams.set('lobby',currentLobbyCode); url.hash='display';
  window.open(url.toString(),'_blank');
}
export function togglePlayerLinkPopover(){
  const pop=document.getElementById('player-link-popover'); if(!pop) return;
  const isOpen=pop.classList.contains('show');
  document.querySelectorAll('.link-popover.show').forEach(p=>p.classList.remove('show'));
  if(!isOpen){
    const url=new URL(location.href); url.searchParams.set('lobby',currentLobbyCode); url.hash='player';
    document.getElementById('player-link-input').value=url.toString();
    pop.classList.add('show');
  }
}
export async function copyPlayerLinkFromPopover(){
  const input=document.getElementById('player-link-input');
  input.select();
  try{ await navigator.clipboard.writeText(input.value); }catch(e){}
  const btn=document.getElementById('player-link-copy-btn');
  if(btn){ const orig=btn.textContent; btn.textContent='Copied'; setTimeout(()=>{ if(btn) btn.textContent=orig; },1200); }
}
document.addEventListener('click',(e)=>{
  const pop=document.getElementById('player-link-popover');
  if(pop&&pop.classList.contains('show')&&!e.target.closest('#player-link-popover')&&e.target.getAttribute('onclick')!=='togglePlayerLinkPopover()'){
    pop.classList.remove('show');
  }
});
export function openHostMoreMenu(){
  showPicker('More actions', [
    {label:'Manual Adjustment', value:'adjust'},
    {label:'New Game', value:'newgame'},
  ], v=>{
    if(v==='adjust') openAdjustModal();
    else if(v==='newgame') newGame();
  });
}

/* ============================================================
   Part 6: TV Display render
   ============================================================ */
