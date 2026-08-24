/* display.js
   The TV surface. Read-only: it renders whatever the host has committed and
   plays the score. Never writes game state. */

import { LEVEL_MONEY } from '../core/constants.js';
import { currentLobbyCode, lastWheelSeen, mode, setLastWheelSeen } from '../core/session.js';
import { state } from '../core/state.js';
import { bounceText, esc, letterFor, money } from '../core/util.js';
import { getNextInLine } from '../rules/flow.js';
import { activeLevel, hotSeatPlayer, teamName } from '../rules/ladder.js';
import { correctDisplayIdx } from '../rules/pool.js';
import { resolvedOutcomeFor, wheelOutcomeResultText } from '../rules/wheel.js';
import { playBigWinThenTheme, playLoop, playOnce, stopLoop } from './display-audio.js';
import { buildLifelinesBar, buildTeamRoster } from '../ui/atoms.js';
import { chairIconSVG, hotSeatLogoImg, teamFlameIcon, teamMidColor, tvIcon } from '../ui/icons.js';
import { buildBoardHTML, puzzleTimerHTML, startPuzzleTimerRAF } from '../ui/puzzle-view.js';
import { animateWheel, buildWheelHTML, wheelResultText } from '../ui/wheel-view.js';
import { renderSusDisplay } from './display-sus.js';

/* Surface-local render bookkeeping: what this surface last drew, so it can
   tell a real change from a repaint. Owned here because nothing else reads it. */
let displayPrevRevealed = new Set();
let lastGlitchSeen = 0;
let lastFlowStage = '';
let lastEndedSeen = false;
let lastAudioSetup = false;
let audioStageToken = 0;

export function renderDisplay(){
  if(mode!=='display') return;
  document.body.classList.add('mode-display');
  const root=document.getElementById('app-root');
  /* Sus mode is its own game with its own stages. Everything below this reads
     the ladder, hot seat, steal and puzzle, none of which it uses. One early
     return keeps the two apart. */
  if(state.gameMode==='sus'){
    root.className='app tv-stage-maroon';
    root.innerHTML=renderSusDisplay();
    return;
  }

  const q=state.currentQuestion; const f=state.flow; const hp=hotSeatPlayer();
  const puz=state.puzzle; const s=state.steal;
  const tvStage=puz.active?'green':((state.gamePhase==='setup'||!hp)?'gold':'maroon');
  const isSetup=state.gamePhase==='setup'||!hp;
  root.className='app tv-stage-'+tvStage;

  // A stage flip normally re-triggers audio, but 'idle' -> 'idle' (setup lobby handing off to
  // the very first live question) never looks like a change unless we also watch isSetup.
  const stageJustChanged=f.stage!==lastFlowStage || (lastFlowStage==='idle'&&f.stage==='idle'&&lastAudioSetup&&!isSetup);
  if(stageJustChanged){
    audioStageToken++;
    const myAudioToken=audioStageToken;
    const delayedQuestionLoop=()=>setTimeout(()=>{ if(audioStageToken===myAudioToken) playLoop('question',{fadeIn:2.5,volume:0.28}); }, 3500);
    if(f.stage==='question'){
      // Lets-play sting, then give the host a couple seconds of dead air to read the
      // question out loud before the tension bed creeps in underneath.
      playOnce('letsPlay',{volume:0.8, onEnded:()=>{ setTimeout(()=>{ if(audioStageToken===myAudioToken) playLoop('question',{fadeIn:2.5,volume:0.28}); }, 2000); }});
    } else if(f.stage==='revealing'||f.stage==='steal-locked'){
      stopLoop(0.8);
      playOnce('finalAnswer',{volume:0.75,solo:true});
    } else if(f.stage==='revealed'&&f.hotSeatAnswer===correctDisplayIdx(q)){
      // Skip the small win sting when this correct answer is about to end the game
      // (Race Mode clinching level 15) — the big-win sting covers that moment instead.
      const isFinalRaceWin=state.gameMode==='race'&&activeLevel(state.hotSeatTeam)===15;
      if(!isFinalRaceWin) playOnce('win',{volume:0.85,solo:true});
    } else if(f.stage==='doubledip-miss'||f.stage==='race-miss'){
      playOnce('lose',{volume:0.85,solo:true});
    } else if(f.stage==='steal-peek'){
      // The original hot seat player's miss
      playOnce('lose',{volume:0.85,solo:true});
      delayedQuestionLoop();
    } else if(f.stage==='steal-reveal'){
      stopLoop(0.7);
      const nil=s?getNextInLine(s.panelTeam):null;
      const theirVote=nil?s.votes[nil.id]:undefined;
      playOnce(theirVote===correctDisplayIdx(q)?'win':'lose',{volume:0.85,solo:true});
    } else if(f.stage==='idle'&&!isSetup&&!state.ended){
      playLoop('mainTheme',{fadeIn:2,volume:0.3});
    } else if(f.stage==='selecting'&&lastFlowStage==='doubledip-miss'){
      // Double Dip retry — same question, second guess. Resume the tension bed instead of dead air.
      delayedQuestionLoop();
    }
    lastFlowStage=f.stage;
  }
  if(state.ended&&!lastEndedSeen){
    stopLoop(0.8);
    playBigWinThenTheme();
    lastEndedSeen=true;
  } else if(!state.ended) lastEndedSeen=false;
  if(isSetup&&!state.ended){
    if(!lastAudioSetup) playLoop('mainTheme',{fadeIn:2,volume:0.4});
    lastAudioSetup=true;
  } else if(!state.ended){
    if(lastAudioSetup) stopLoop(1.2);
    lastAudioSetup=false;
  }

  const showRoster=(state.gamePhase==='live'||state.gamePhase==='wager');
  const levelBadge=state.gamePhase==='wager'?`<div class="tv-level-badge">${tvIcon('bolt')} FINAL WAGER</div>`:(puz.active?`<div class="tv-level-badge">${tvIcon('puzzle')} PUZZLE</div>`:'');
  const teamsrow=isSetup?'':`<div class="tv-teamsrow">
    <div class="tv-team-block team-a ${state.hotSeatTeam==='A'?'is-hot':''}">
      <div class="tv-team-name">${esc(state.teamAName)}</div>
      <div class="tv-team-bank">${state.gameMode==='race'?'Lvl '+activeLevel('A'):money(state.teamABank)}</div>
      ${showRoster?buildTeamRoster('A'):''}
    </div>
    <div class="tv-team-block team-b ${state.hotSeatTeam==='B'?'is-hot':''}">
      <div class="tv-team-name">${esc(state.teamBName)}</div>
      <div class="tv-team-bank">${state.gameMode==='race'?'Lvl '+activeLevel('B'):money(state.teamBBank)}</div>
      ${showRoster?buildTeamRoster('B'):''}
    </div>
  </div>`;

  const wagerBanner=(state.wager&&state.wager.active&&!state.wager.revealed)?
    `<div class="tv-wager-banner">${tvIcon('bolt')} Enter your bet on your phone!</div>`:'';

  let mainContent='';
  if(state.ended){
    mainContent=state.gameMode==='race'&&state.raceWinner
      ? `<div style="display:flex;flex-direction:column;align-items:center;gap:10px;">
          <div class="tv-waiting" style="font-size:clamp(22px,4vw,40px);">${tvIcon('trophy','0.85em')} Game Over!</div>
          <div class="tv-name-tag" style="color:${teamMidColor(state.raceWinner)};font-size:clamp(22px,3.6vw,34px);">${teamFlameIcon(state.raceWinner)}${esc(teamName(state.raceWinner))} wins the race!</div>
        </div>`
      : `<div class="tv-waiting">${tvIcon('trophy','0.85em')} Game Over!</div>`;
  } else if(state.wheel){
    mainContent=`<div style="display:flex;flex-direction:column;align-items:center;gap:16px;">
      <div class="tv-hotseat-name" style="font-size:clamp(18px,3vw,28px);">${state.wheel.kind==='bomb'?tvIcon('card')+' Wildcard!':'Tie-breaker'}</div>
      ${buildWheelHTML(state.wheel,'tv')}
      ${!state.wheel.spunAt?`<div class="tv-waiting" style="font-size:clamp(14px,2.2vw,20px);">Grab your phone and spin!</div>`:''}
    </div>`;
  } else if(puz.active){
    const curRevSet=new Set((puz.revealedLetters||[]).map(l=>l.toUpperCase()));
    mainContent=`<div id="tv-glitch-target" data-text=" " style="width:100%;text-align:center;">
      ${puz.category?`<div style="font-size:clamp(13px,2vw,18px);text-transform:uppercase;letter-spacing:0.2em;color:var(--tv-accent);text-shadow:var(--tv-text-shadow);margin-bottom:16px;">${esc(puz.category)}</div>`:''}
      ${buildBoardHTML(puz,displayPrevRevealed)}
      ${(puz.timerStartedAt||puz.timerElapsed)?puzzleTimerHTML(puz,'tv'):''}
      <div style="margin-top:14px;font-size:clamp(14px,2vw,18px);color:var(--tv-text-soft);text-shadow:var(--tv-text-shadow);font-weight:600;">${esc(teamName(puz.currentGuessingTeam))}'s turn</div>
    </div>`;
    displayPrevRevealed=curRevSet;
  } else if(state.gamePhase==='wager'){
    const w=state.wager;
    const wq=w.question;
    const wCorrectIdx=wq?correctDisplayIdx(wq):-1;
    const wAnswers=w.answers||{};
    mainContent=`<div style="width:100%;max-width:700px;">
      <div class="tv-hotseat-name" style="font-size:clamp(20px,3.5vw,36px);">Final Wager</div>
      ${w.revealed&&wq?`<div class="tv-q-text">${esc(wq.text)}</div>`:`<div class="tv-waiting" style="margin-top:10px;font-size:clamp(14px,2.2vw,20px);">Wagers are locked in blind — question coming up…</div>`}
      ${(w.revealed&&wq&&wq.options.length>1)?`<div class="tv-opts" style="margin-top:12px;">${wq.displayOrder.map((origIdx,di)=>{
        const isCorrect=origIdx===0;
        const pickedCount=state.players.filter(p=>wAnswers[p.id]===di).length;
        let cls='tv-opt shown';
        if(w.resolved&&isCorrect) cls+=' is-answer';
        return `<div class="${cls}"><span class="tv-opt-letter">${letterFor(di)})</span>${esc(wq.options[origIdx])}${pickedCount?`<span style="float:right;opacity:0.7;">${pickedCount}</span>`:''}</div>`;
      }).join('')}</div>`:''}
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:16px;">
        ${state.players.map(p=>{
          const ans=wAnswers[p.id];
          const gotIt=w.resolved&&ans!==undefined?(ans===wCorrectIdx):null;
          const amtColor=gotIt===true?'var(--c-green-light)':gotIt===false?'var(--c-red-light)':(w.wagers[p.id]!==undefined?'var(--tv-accent)':'var(--tv-text-soft)');
          return `<div style="display:flex;align-items:center;justify-content:space-between;background:var(--tv-panel-solid);border:1px solid var(--tv-border);border-radius:8px;padding:8px 14px;font-size:clamp(13px,2vw,18px);color:var(--tv-text);text-shadow:var(--tv-text-shadow);">
          <span>${esc(p.name)}${w.revealed&&ans!==undefined?' ✓':''}</span><span style="font-weight:700;color:${amtColor};">${w.wagers[p.id]!==undefined?money(w.wagers[p.id]):'...'}</span>
        </div>`;
        }).join('')}
      </div>
    </div>`;
  } else if(q&&f.stage!=='idle'){
    const isMC=q.options.length>1; const correctIdx=correctDisplayIdx(q);
    const showOpts=['options','selecting','revealing','revealed','doubledip-miss','steal-peek','steal-locked','steal-reveal'].includes(f.stage);
    const showHSAnswer=['revealed','doubledip-miss','steal-peek','steal-locked','steal-reveal'].includes(f.stage);
    const showCorrect=f.stage==='steal-reveal';
    const isSteal=(f.stage==='steal-peek'||f.stage==='steal-locked'||f.stage==='steal-reveal')&&s;
    const stealNilTV=s?getNextInLine(s.panelTeam):null;
    const stealNilLabel=stealNilTV?esc(stealNilTV.name):'Other team';
    let optsHtml='';
    if(isMC&&showOpts){
      const stealPickIdx=(isSteal&&stealNilTV)?s.votes[stealNilTV.id]:undefined;
      optsHtml='<div class="tv-opts">'+q.displayOrder.map((origIdx,di)=>{
        const isCorrect=origIdx===0; const isHSPick=f.hotSeatAnswer===di;
        const isStealPick=isSteal&&stealPickIdx===di;
        const isDDMiss=f.doubleDipMissIdx===di&&!isHSPick;
        // Only show options that have been revealed one by one
        const isRevealed=(f.stage==='options'&&di<f.optionsRevealed)||['selecting','revealing','revealed','doubledip-miss','steal-peek','steal-locked','steal-reveal'].includes(f.stage);
        let cls='tv-opt'+(isRevealed?' shown':'');
        if(isStealPick){
          if(f.stage==='steal-reveal') cls+= isCorrect?' is-answer':' is-wrong';
          else if(f.stage==='steal-locked') cls+=' is-final';
        } else if(f.stage==='revealing'&&isHSPick){
          cls+=' is-final';
        } else if(showHSAnswer&&isHSPick){
          if(f.stage==='revealed') cls+=' is-answer';
          else if(f.stage==='doubledip-miss'||f.stage==='steal-peek'||f.stage==='steal-locked'||f.stage==='steal-reveal') cls+=' is-wrong';
        }
        if(isDDMiss) cls+=' is-wrong';
        if(showCorrect&&isCorrect&&!isHSPick&&!isStealPick) cls+=' is-answer';
        if(showCorrect&&!isCorrect&&!isHSPick&&!isStealPick&&!isDDMiss) cls+=' not-answer';
        if((f.stage==='revealed'||f.stage==='doubledip-miss')&&!isHSPick&&!isDDMiss) cls+=' not-answer';
        const verdictBadge=cls.includes('is-answer')?`<span class="tv-opt-verdict good">${tvIcon('check','0.6em')}</span>`
          :cls.includes('is-wrong')?`<span class="tv-opt-verdict bad">${tvIcon('cross','0.6em')}</span>`:'';
        return `<div class="${cls}"><span class="tv-opt-letter">${letterFor(di)})</span>${esc(q.options[origIdx])}${verdictBadge}</div>`;
      }).join('')+'</div>';
    } else if(!isMC&&showCorrect){
      optsHtml=`<div style="margin-top:20px;font-size:clamp(18px,3vw,32px);font-weight:700;color:var(--c-green-light);display:flex;align-items:center;justify-content:center;gap:8px;">${tvIcon('check')} ${esc(q.options[0])}</div>`;
    }
    // Quiet caption — only for states that carry information a box icon can't (a mechanic, or who holds the seat now)
    let quietCaption='';
    if(f.stage==='doubledip-miss'){
      quietCaption=`<div class="tv-quiet-caption">${tvIcon('refresh','0.85em')} Double Dip — one more guess</div>`;
    }
    let heroText=hp?esc(hp.name):'—';
    if(isSteal){
      if(f.stage==='steal-reveal'){
        const stealVoteTV=stealNilTV?s.votes[stealNilTV.id]:undefined;
        const stealCorrect=stealVoteTV===correctIdx;
        heroText=stealCorrect
          ? `${stealNilLabel} steals the hot seat!`
          : `${stealNilLabel} missed it, ${hp?esc(hp.name):'the original player'} keeps the hot seat`;
      } else {
        heroText=`${stealNilLabel} is stealing`;
      }
    }
    const heroBlock=`<div class="tv-name-tag" style="color:${teamMidColor(isSteal?(s?s.panelTeam:state.hotSeatTeam):state.hotSeatTeam)}">${heroText}</div>`;
    // Same wrapper skeleton for every live-question stage (question through reveal) so the
    // hero/question never jumps position when the stage below it changes.
    const showLLBar=!isSteal&&['question','options','selecting','doubledip-miss'].includes(f.stage);
    mainContent=`<div style="width:100%;max-width:900px;min-height:100%;display:flex;flex-direction:column;">
        <div id="tv-hero-block">${heroBlock}</div>
        <div class="tv-q-text">${esc(q.text)}</div>
        ${optsHtml}<div id="tv-result-banner">${quietCaption}</div>
        <div style="flex:1;display:flex;align-items:center;justify-content:center;">${showLLBar?buildLifelinesBar(state.hotSeatTeam):''}</div>
      </div>`;
  } else {
    const playerUrl=currentLobbyCode?(location.href.split('?')[0].split('#')[0]+'?lobby='+currentLobbyCode):'';
    mainContent=`<div style="text-align:center;width:100%;max-width:900px;">
      ${isSetup&&playerUrl?`
        <div style="display:flex;flex-direction:column;align-items:center;gap:clamp(10px,2.4vh,26px);max-height:100%;">
          <div style="font:400 clamp(18px,3.4vh,42px)/1 var(--font-script);color:var(--tv-wordmark);">tonight, someone's in...</div>
          ${hotSeatLogoImg('ember','height:clamp(130px,42vh,440px);width:auto;max-width:85%;')}
        </div>
        <div style="position:absolute;right:clamp(16px,3vw,48px);bottom:clamp(14px,3vh,36px);display:flex;flex-direction:column;align-items:center;gap:8px;">
          <div id="tv-qr-wrap" style="background:#fff;border-radius:10px;padding:6px;display:inline-block;line-height:0;"></div>
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="height:clamp(16px,2.2vh,26px);width:auto;">${chairIconSVG('height:100%;width:auto;')}</span>
            <div style="font:600 clamp(11px,1.4vh,16px) var(--font-heading);letter-spacing:0.06em;color:var(--tv-wordmark);">Scan to join!</div>
          </div>
        </div>
      `:`
        <div class="tv-hotseat-name" style="color:${teamMidColor(state.hotSeatTeam)}">${hp?esc(hp.name):'—'}</div>
        <div class="tv-waiting tv-waiting-bounce" style="font-size:clamp(18px,3.5vw,38px);margin-top:20px;">${bounceText('Waiting for host…')}</div>
      `}
    </div>`;
  }

  // Vertical rail — lowest level at the bottom (column-reverse), so rows are built 1→15 in markup order.
  let railRows='';
  if(state.gameMode==='race'){
    const curA=activeLevel('A'), curB=activeLevel('B');
    for(let l=1;l<=15;l++){
      const hereA=curA===l, hereB=curB===l;
      const pastA=l<curA, pastB=l<curB;
      let cls='rail-row';
      if(hereA) cls+=' token-a';
      if(hereB) cls+=' token-b';
      const dots=(pastA?'<span class="rail-dot a"></span>':'')+(pastB?'<span class="rail-dot b"></span>':'');
      railRows+=`<div class="${cls}">${dots}${l}</div>`;
    }
  } else {
    for(let l=1;l<=15;l++){
      const cur=state.ladderCurrent===l;
      const passed=l<state.ladderCurrent;
      railRows+=`<div class="rail-row ${passed?'passed':''} ${cur?'current':''}">${money(LEVEL_MONEY[l-1])}</div>`;
    }
  }
  if(isSetup){
    root.innerHTML=`<div class="tv-main">${mainContent}</div>`;
  } else {
    root.innerHTML=`<div class="tv-shell">
      <div class="tv-top-row">
        <div class="tv-sidebar-logo">${hotSeatLogoImg(tvStage==='gold'?'ember':'white','')}</div>
        ${teamsrow}
      </div>
      <div class="tv-lower-row">
        <div class="tv-rail-col"><div class="tv-rail">${railRows}</div></div>
        <div class="tv-content-col">
          ${levelBadge||wagerBanner?`<div style="padding:2px 20px 0;">${levelBadge}${wagerBanner}</div>`:''}
          <div class="tv-main">${mainContent}</div>
        </div>
      </div>
    </div>`;
  }

  setTimeout(()=>{
    const wrap=document.getElementById('tv-qr-wrap');
    if(wrap&&typeof QRCode!=='undefined'){
      wrap.innerHTML='';
      try{ new QRCode(wrap,{text:currentLobbyCode?location.href.split('?')[0].split('#')[0]+'?lobby='+currentLobbyCode:location.href.split('#')[0],width:184,height:184,colorDark:'#07111f',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.L}); }
      catch(e){ wrap.innerHTML='<div style="color:#333;font-size:10px;padding:4px;">QR unavailable</div>'; }
    }
  },300);
  if(puz.active&&puz.glitchAt&&puz.glitchAt!==lastGlitchSeen){
    lastGlitchSeen=puz.glitchAt;
    if(Date.now()-puz.glitchAt<10000){ const t=document.getElementById('tv-glitch-target'); if(t){ t.classList.add('glitching'); setTimeout(()=>t.classList.remove('glitching'),1900); } }
  }
  if(stageJustChanged){
    const rb=document.getElementById('tv-result-banner');
    if(rb&&rb.innerHTML.trim()){ rb.classList.add('pop'); setTimeout(()=>rb.classList.remove('pop'),450); }
  }
  if(state.wheel&&state.wheel.spunAt&&state.wheel.spunAt!==lastWheelSeen){ setLastWheelSeen(state.wheel.spunAt); animateWheel(state.wheel,'tv'); }
  else if(state.wheel&&state.wheel.spunAt){
    const disc=document.getElementById('wheel-disc-tv');
    if(disc){ const n=state.wheel.names.length,seg=360/n; disc.style.transition='none'; disc.style.transform=`rotate(${360*6+(360-(state.wheel.winnerIdx*seg+seg/2))}deg)`; }
    const res=document.getElementById('wheel-result-tv');
    if(res) res.textContent=state.wheel.outcomes?wheelOutcomeResultText(resolvedOutcomeFor(state.wheel)):wheelResultText(state.wheel);
  }
  if(puz.active&&!puz.timerPaused) startPuzzleTimerRAF();
}
