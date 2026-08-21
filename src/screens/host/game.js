/* host/game.js
   The Play tab: the flow card that drives a question from draw to steal, the
   steal and Wildcard wheels, the puzzle controls, and the quick-adjust rail
   down the right-hand side. */

import { state } from '../../core/state.js';
import { LIFELINE_DEFS } from '../../core/constants.js';
import { esc, letterFor, money } from '../../core/util.js';
import { advanceLevelNoMoney, changeHotSeatPick, confirmBombWheel, confirmHotSeatReveal, confirmWheelWinner, dismissDefendedSteal, flowAdvance, getNextInLine, hostDrawQuestion, hostSelectAnswer, hostSetStealVote, lockStealAnswer, markCorrect, raceSwapAfterMiss, rerollQuestion, resolveSteal, retryDoubleDip, revealCorrectAnswer, unlockStealAnswer } from '../../rules/flow.js';
import { activeLevel, hotSeatPlayer, levelDiff, levelType, opposingTeam, teamName } from '../../rules/ladder.js';
import { spinWheel, undoLifeline, useLifeline } from '../../rules/lifelines.js';
import { correctDisplayIdx } from '../../rules/pool.js';
import { pausePuzzleTimer, puzzleSolved, resumePuzzleTimer, swapPuzzleHotSeat, triggerPuzzle } from '../../rules/puzzle.js';
import { applyAdjustment } from '../../rules/score.js';
import { openAdjustModal } from './adjust.js';
import { diffPill } from '../../ui/atoms.js';
import { buildBoardHTML, buildKeyboardHTML, puzzleTimerHTML } from '../../ui/puzzle-view.js';
import { buildWheelHTML } from '../../ui/wheel-view.js';

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
