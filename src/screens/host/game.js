/* host/game.js
   The Play tab: the flow card that drives a question from draw to steal, the
   steal and Wildcard wheels, the puzzle controls, and the quick-adjust rail
   down the right-hand side. */

import { state } from '../../core/state.js';
import { LIFELINE_DEFS } from '../../core/constants.js';
import { esc, letterFor, money } from '../../core/util.js';
import { advanceLevelNoMoney, changeHotSeatPick, confirmBombWheel, confirmHotSeatReveal, confirmWheelWinner, dismissDefendedSteal, flowAdvance, getNextInLine, hostDrawQuestion, hostSelectAnswer, hostSetStealVote, lockStealAnswer, markCorrect, raceSwapAfterMiss, rerollQuestion, resolveSteal, retryDoubleDip, revealCorrectAnswer, unlockStealAnswer } from '../../rules/flow.js';
import { activeLevel, hotSeatPlayer, levelDiff, levelMoney, levelType, opposingTeam, teamName } from '../../rules/ladder.js';
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

  /* A wheel or an undecided steal is an interruption: the flow card is still
     on screen underneath it, but it is not what to do next. Marking it queued
     keeps exactly one control on the page reading as the next action. */
  const interrupted=!!(state.wheel||(state.steal&&state.steal.outcome==='defended'));

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
    html+=renderFlowCard(isPuzzleLevel,interrupted);
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

/* ============================================================
   The stage bar.

   The host is performing, not browsing. Mid-round they glance at this screen
   for a fraction of a second and need three answers: what stage am I in, who
   is on the clock, and what is the one thing I do next. Everything below is
   derived from state.flow.stage — no behaviour, no new handlers.
   ============================================================ */

/* A keycap. Only ever rendered next to a control that handleHostKeydown in
   main.js is actually listening for at this stage, so an absent cap means
   "no shortcut here" rather than "we forgot". */
function kbd(key,onAccent){ return `<kbd class="kbd${onAccent?' kbd-accent':''}">${key}</kbd>`; }

/* tone drives the colour of the bar and the card border:
   read = nothing is waiting on you, act = the room is waiting on your tap,
   steal = the other team is in play, good = money moves, warn = a miss. */
function stageBrief(stage){
  const f=state.flow, s=state.steal, q=state.currentQuestion;
  const hp=hotSeatPlayer();
  const who=hp?hp.name:'Hot seat';
  const whoTeam=teamName(state.hotSeatTeam);
  const nil=s?getNextInLine(s.panelTeam):null;
  const stealWho=nil?nil.name:'Their next in line';
  const stealTeam=s?teamName(s.panelTeam):'';
  const pick=f.hotSeatAnswer>=0?letterFor(f.hotSeatAnswer):'';
  const optCount=q?q.options.length:0;
  switch(stage){
    case 'idle':
      return {tone:'read',label:'Question drawn',todo:`Read it to the room, then reveal it for ${esc(who)}.`};
    case 'question':
      return {tone:'read',label:'Question is up',
        todo:optCount>1?'Reveal the options one at a time.':'Hidden answer — reveal when they commit.'};
    case 'options':
      return {tone:'read',label:`Options ${f.optionsRevealed} of ${optCount} shown`,todo:'Keep revealing until they are all up.'};
    case 'selecting':
      return {tone:'act',label:`${esc(who)} is answering`,todo:`Tap the answer ${esc(who)} says out loud.`};
    case 'revealing':
      return {tone:'act',label:`${esc(who)} locked in ${pick}`,todo:'Hold the room, then reveal whether it is right.'};
    case 'revealed':
      return {tone:'good',label:'Correct',todo:`Bank it for ${esc(who)} and ${esc(whoTeam)}, then climb a level.`};
    case 'doubledip-miss':
      return {tone:'warn',label:'Wrong — Double Dip covers it',todo:`${esc(who)} gets one more guess. No steal yet.`};
    case 'race-miss':
      return {tone:'warn',label:'Wrong — the seat passes',todo:`Hand the hot seat to ${esc(teamName(opposingTeam(state.hotSeatTeam)))}.`};
    case 'steal-peek':
      return {tone:'steal',label:`Steal — ${esc(stealWho)} · ${esc(stealTeam)}`,
        todo:`${esc(stealWho)} answers for the steal. Tap their answer, or wait for their phone.`};
    case 'steal-locked':
      return {tone:'steal',label:`Steal locked — ${esc(stealWho)}`,todo:'Reveal the correct answer.'};
    case 'steal-reveal':{
      const vote=nil&&s?s.votes[nil.id]:undefined;
      const got=q&&vote===correctDisplayIdx(q);
      return got
        ?{tone:'good',label:`Stolen by ${esc(stealWho)}`,todo:`${esc(stealTeam)} takes the money and the hot seat.`}
        :{tone:'warn',label:'Nobody got it',todo:`${esc(who)} keeps the seat. No money this level — the ladder still climbs.`};
    }
    default:
      return {tone:'read',label:'In play',todo:''};
  }
}

/* Right-hand side of the bar: the stakes. Level, what the level pays, and how
   hard the question is — the three numbers a host says out loud. */
function stageStakes(level,diff,extra){
  const isRace=state.gameMode==='race';
  return `<div class="flow-stage-meta">
    <span class="flow-stage-level">Level ${level}</span>
    ${isRace?'':`<span class="money-sm">${money(levelMoney(level))}</span>`}
    ${diff?diffPill(diff):''}
    ${extra||''}
  </div>`;
}

function stageBarHTML(brief,level,diff,extra){
  return `<div class="flow-stage tone-${brief.tone}">
    <div class="flow-stage-main">
      <div class="flow-stage-label">${brief.label}</div>
      ${brief.todo?`<div class="flow-stage-todo">${brief.todo}</div>`:''}
    </div>
    ${stageStakes(level,diff,extra)}
  </div>`;
}

export function renderFlowCard(isPuzzleLevel,queued){
  const q=state.currentQuestion; const f=state.flow;
  const ll=state.lifelines[state.hotSeatTeam]; const s=state.steal;
  const qCls=queued?' is-queued':'';

  const hpSeat=hotSeatPlayer();
  const hpName=hpSeat?esc(hpSeat.name):'the hot seat';

  if(isPuzzleLevel&&!state.puzzle.active&&!q) return `<div class="flow-card${qCls}">
    ${stageBarHTML({tone:'read',
      label:queued?'Up next — puzzle round':'Puzzle round',
      todo:queued?'Settle the card above first.':`No question this level — put the letter board on the TV for ${hpName}.`},
      activeLevel(),'puzzle')}
    <div class="flow-controls"><button class="btn btn-primary btn-lg" onclick="triggerPuzzle()">Trigger the Glitch</button></div>
  </div>`;

  if(!q){
    const avail=state.questions.filter(x=>!x.used).length;
    return `<div class="flow-card${qCls}">
      ${stageBarHTML({tone:'read',
        label:queued?'Up next — draw a question':'Ready for the next question',
        todo:queued?'Settle the card above first.':`${hpName} is in the hot seat. ${avail} unused question${avail===1?'':'s'} left in the bank.`},
        activeLevel(),levelDiff(activeLevel()))}
      <div class="flow-controls"><button class="btn btn-primary btn-lg" onclick="hostDrawQuestion()">Draw Question</button></div>
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
    questionSlot=`<button class="flow-reveal-btn" onclick="flowAdvance()"><span>▶ Reveal Question</span>${kbd('Space',true)}</button>`;
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
          return `<button class="flow-reveal-btn" onclick="flowAdvance()"><span>▶ Reveal ${letterFor(di)}</span>${kbd('Space',true)}</button>`;
        }
        return `<div class="flow-opt" style="opacity:0.1;height:44px;"></div>`;
      }
      // Option is revealed
      const isDDMiss=f.doubleDipMissIdx===di;
      if(stage==='selecting'){
        if(isDDMiss){
          return `<div class="flow-opt wrong-pick"><span class="flow-opt-letter">${letterFor(di)})</span>${esc(q.options[origIdx])} <span style="font-size:11px;">— already wrong</span></div>`;
        }
        return `<button class="flow-opt is-pickable" onclick="hostSelectAnswer(${di})">
          <span class="flow-opt-letter">${letterFor(di)})</span><span class="flow-opt-text">${esc(q.options[origIdx])}</span>${kbd(di+1)}
        </button>`;
      }
      if(stage==='steal-peek'){
        if(isHSPick||isDDMiss){
          return `<div class="flow-opt dim" style="opacity:0.35;"><span class="flow-opt-letter">${letterFor(di)})</span>${esc(q.options[origIdx])} <span style="font-size:11px;">— already wrong</span></div>`;
        }
        const stealNil=s?getNextInLine(s.panelTeam):null;
        const stealVote=stealNil?s.votes[stealNil.id]:undefined;
        const isPicked=stealVote===di;
        return `<button class="flow-opt is-pickable${isPicked?' answer-flash':''}" onclick="hostSetStealVote(${di})">
          <span class="flow-opt-letter">${letterFor(di)})</span><span class="flow-opt-text">${esc(q.options[origIdx])}</span>${kbd(di+1)}
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
    actionSlot=`<button class="btn btn-primary btn-block btn-act" onclick="confirmHotSeatReveal()">▶ Reveal Answer${kbd('Space',true)}</button>
      <button class="btn-changepick" onclick="changeHotSeatPick()">✎ Misheard? Change pick</button>`;
  } else if(stage==='revealed'){
    if(f.hotSeatAnswer===correctIdx){
      actionSlot=`<button class="btn btn-success btn-block btn-act" onclick="markCorrect()">✓ Correct — Bank &amp; Advance${kbd('Space',true)}</button>
      <button class="btn-changepick" onclick="changeHotSeatPick()">✎ Misheard? Change pick</button>`;
    }
  } else if(stage==='doubledip-miss'){
    actionSlot=`<button class="btn btn-primary btn-block btn-act" onclick="retryDoubleDip()">Try Again${kbd('Space',true)}</button>
      <button class="btn-changepick" onclick="changeHotSeatPick()">✎ Misheard? Change pick</button>`;
  } else if(stage==='race-miss'){
    const other=opposingTeam(state.hotSeatTeam);
    actionSlot=`<button class="btn btn-primary btn-block btn-act" onclick="raceSwapAfterMiss()">Swap to ${esc(teamName(other))} →${kbd('Space',true)}</button>
      <button class="btn-changepick" onclick="changeHotSeatPick()">✎ Misheard? Change pick</button>`;
  } else if(stage==='steal-peek'){
    const stealNilA=s?getNextInLine(s.panelTeam):null;
    const stealVoteA=stealNilA?s.votes[stealNilA.id]:undefined;
    actionSlot=(stealVoteA!==undefined
      ?`<button class="btn btn-primary btn-block btn-act" onclick="lockStealAnswer()">▶ Lock In Their Answer</button>`
      :`<div class="flow-await">Waiting on ${esc(stealNilA?stealNilA.name:'their panelist')} — tap their answer above, or their phone locks it in</div>`)
      +`<button class="btn-changepick" onclick="changeHotSeatPick()">✎ Misheard the original answer? Change pick</button>`;
  } else if(stage==='steal-locked'){
    actionSlot=`<button class="btn btn-primary btn-block btn-act" onclick="revealCorrectAnswer()">▶ Reveal Correct Answer${kbd('Space',true)}</button>
      <button class="btn-changepick" onclick="unlockStealAnswer()">✎ Change their pick</button>`;
  } else if(stage==='steal-reveal'){
    const nil=s?getNextInLine(s.panelTeam):null;
    const theirVote=nil?s.votes[nil.id]:undefined;
    actionSlot=theirVote===correctIdx
      ?`<button class="btn btn-success btn-block btn-act" onclick="resolveSteal()">✓ Stolen — Hand ${esc(nil?nil.name:'them')} the Seat &amp; the Money</button>`
      :`<button class="btn btn-error btn-block btn-act" onclick="advanceLevelNoMoney()">Nobody Got It — Next Level, No Money</button>`;
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
  const brief=stageBrief(stage);
  const reroll=stage==='idle'||stage==='question'
    ?`<button class="btn btn-ghost btn-sm" onclick="rerollQuestion()">Reroll</button>`:'';

  return `<div class="flow-card tone-${brief.tone}${qCls}">
    ${stageBarHTML(brief,q.level,q.difficulty,reroll)}
    <div class="flow-slot">${questionSlot}</div>
    ${optSlots}
    ${actionSlot}
    ${voteStatus}
    ${showLL?`<div class="flow-lifelines">
      <span class="flow-lifelines-label">${esc(teamName(state.hotSeatTeam))} lifelines</span>
      ${LIFELINE_DEFS.filter(({key})=>!(state.gameMode==='race'&&(key==='bomb'||key==='doubleDip'))).map(({key,label})=>
        ll[key]
          ? `<span class="ll-spent">${label} used<button class="ll-undo" title="Undo — restores a spent lifeline" onclick="undoLifeline('${key}')">↺</button></span>`
          : `<button class="btn btn-ghost btn-sm" onclick="useLifeline('${key}')">${label}</button>`
      ).join('')}
    </div>`:''}
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
