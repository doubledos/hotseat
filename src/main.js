/* Hotseat - application entry point.
   Loaded by index.html as <script type="module">.
   See CLAUDE.md for the file map. */

import { dbDelete, dbGet, dbList, dbSet, hasSupabase } from './core/db.js';
import { LEVEL_DIFFICULTY_DEFAULT, LEVEL_MONEY, LIFELINE_DEFS, PUZZLE_TIMER_MS, QWERTY } from './core/constants.js';
import { bounceText, debounce, esc, genId, letterFor, money, shuffleArray, slugify } from './core/util.js';
import { playBigWinThenTheme, playLoop, playOnce, stopLoop } from './screens/display-audio.js';
import { defaultState, normalizeState, setState, state } from './core/state.js';
import { LIFELINE_ICONS, chairIconSVG, hotSeatLogoImg, teamFlameIcon, teamGradId, teamMidColor, tvIcon } from './ui/icons.js';
import { R, bindRenderers } from './ui/rerender.js';
import { currentLobbyCode, editingPhrase, editingQuestion, hostTab, lastWheelSeen, mode, myPlayerId, phoneLifelineRequestedKey, phonePromoteMenuOpen, phoneSpinRequestedFor, phoneVotedRound, phoneWagerSubmitted, seenWagerIds, setEditingPhrase, setEditingQuestion, setActiveHostTab, setLastWheelSeen, setLobbyCode, setMode, setMyPlayerId, setPhoneLifelineRequestedKey, setPhonePromoteMenuOpen, setPhoneSpinRequestedFor, setPhoneVotedRound, setPhoneWagerSubmitted, setSeenWagerIds, setSetupStep, setupStep } from './core/session.js';
import { createLobby, lastSavedJSON, listLobbies, loadLobby, lobbyKey, saveLobby, setLastSaved } from './core/lobby.js';
import { cancelModal, confirmModal, setPendingModal, showModal, showPicker } from './ui/modal.js';
import { activeLevel, advanceLevel, elapsedMinutes, hotSeatPlayer, isLevelWon, levelDiff, levelMoney, levelType, opposingTeam, playerById, teamName, winLevel } from './rules/ladder.js';
import { availableQuestions, correctDisplayIdx, makeCurrentQuestion, pickQuestion } from './rules/pool.js';
import { buildBombWheelOutcomes, resolvedOutcomeFor, wheelMoneyLabel, wheelOutcomeLabel, wheelOutcomeResultText, wheelSliceColor, wheelSliceVisual } from './rules/wheel.js';
import { animateWheel, buildWheelHTML, flashWheelResult, onWheelLanded, revealWheelOutcome, showWheelZoom, wheelResultText } from './ui/wheel-view.js';

/* ============================================================
   FORTUNE & FORTUNE v3
   Part 2: Config, storage, state schema, utilities
   ============================================================ */



let pollTimer = null;
let displayPrevRevealed = new Set();
let lastGlitchSeen = 0;
let puzzleTimerRAF = null;
let lastFlowStage = '';
let lastEndedSeen = false;
let lastAudioSetup = false;
let audioStageToken = 0;
let lastPhoneWheelSeen = 0;
/* Inline on* handlers run in GLOBAL scope, so assigning phonePromoteMenuOpen
   directly inside an attribute would write to window and never reach the
   module-scoped binding. Writes go through this function, which the barrel
   republishes. */
function setPromoteMenu(open, rerender=true){ setPhonePromoteMenuOpen(open); if(rerender) R.player(); }

// Detect hash-based routing
function detectMode(){
  const h = location.hash;
  if(h==='#host') return 'host';
  if(h==='#display') return 'display';
  if(h==='#player'||h===''||h==='#') return 'player';
  return 'player';
}

/* ===== Utilities ===== */
async function pollForUpdates(){
  if(!currentLobbyCode) return;
  try{
    const res = await dbGet(lobbyKey());
    if(res&&res.value&&res.value!==lastSavedJSON){
      const newState = normalizeState(JSON.parse(res.value));
      setState(newState);
      setLastSaved(res.value);
      R.all();
    }
  } catch(e){}
  // Poll steal votes if host
  if(mode==='host'&&state.steal&&!state.steal.locked){
    await pollStealVotes();
  }
  // Poll wagers if host
  if(mode==='host'&&state.wager&&state.wager.active&&!state.wager.revealed){
    await pollWagers();
  }
  if(mode==='host'&&state.wager&&state.wager.active&&state.wager.revealed&&!state.wager.resolved){
    await pollWagerAnswers();
  }
  // Poll player-requested lifelines / wheel spins if host
  if(mode==='host'&&currentLobbyCode&&state.hotSeatTeam&&!state.wheel){
    await pollLifelineRequests();
  }
  if(mode==='host'&&currentLobbyCode&&state.wheel&&!state.wheel.spunAt){
    await pollSpinRequest();
  }
}

/* ===== Question flow ===== */
async function hostDrawQuestion(){
  const lvl = activeLevel();
  const diff = levelDiff(lvl);
  const lt = levelType(lvl);
  if(lt==='puzzle'){
    state.currentQuestion=null;
    state.flow={stage:'idle',optionsRevealed:0,hotSeatAnswer:-1,stealPeeked:false,stealRevealed:false,doubleDipUsed:false};
  } else {
    const q = pickQuestion(diff);
    if(!q){ state.currentQuestion=null; } else {
      q.used=true;
      state.currentQuestion = makeCurrentQuestion(q, lvl);
      state.flow={stage:'idle',optionsRevealed:0,hotSeatAnswer:-1,stealPeeked:false,stealRevealed:false,doubleDipUsed:false};
    }
  }
  state.steal=null; state.wheel=null;
  await saveLobby(); R.host();
}

async function rerollQuestion(){
  const q = state.currentQuestion;
  const lvl = activeLevel();
  const diff = q ? q.difficulty : levelDiff(lvl);
  const newQ = pickQuestion(diff);
  if(!newQ) return;
  newQ.used=true;
  state.currentQuestion = makeCurrentQuestion(newQ, lvl);
  state.flow={stage:'idle',optionsRevealed:0,hotSeatAnswer:-1,stealPeeked:false,stealRevealed:false,doubleDipUsed:false};
  await saveLobby(); R.host();
}

async function flowAdvance(){
  const f=state.flow; const q=state.currentQuestion; if(!q) return;
  const optCount=q.options.length; const isMC=optCount>1;
  if(f.stage==='idle'){ f.stage='question'; }
  else if(f.stage==='question'){ if(isMC){f.stage='options';f.optionsRevealed=1;}else{f.stage='selecting';} }
  else if(f.stage==='options'){ if(f.optionsRevealed<optCount) f.optionsRevealed++; if(f.optionsRevealed>=optCount) f.stage='selecting'; }
  await saveLobby(); R.host();
}
async function hostSelectAnswer(di){
  // Lock in the pick first — dramatic pause before the actual reveal (see confirmHotSeatReveal).
  state.flow.hotSeatAnswer=di;
  state.flow.stage='revealing';
  await saveLobby(); R.host();
}
async function confirmHotSeatReveal(){
  const di=state.flow.hotSeatAnswer;
  const correctIdx=correctDisplayIdx(state.currentQuestion);
  if(di===correctIdx){
    state.flow.stage='revealed';
  } else if(state.gameMode==='race'){
    // Race Mode: no steal — a miss just hands the hot seat to the other team, at their own level
    state.flow.stage='race-miss';
  } else if(state.lifelines[state.hotSeatTeam].doubleDip&&!state.flow.doubleDipUsed){
    // Double Dip: first miss just costs the guess, no steal yet
    state.flow.doubleDipUsed=true;
    state.flow.doubleDipMissIdx=di;
    state.flow.stage='doubledip-miss';
  } else {
    // Wrong — create steal record and go to steal-peek
    state.flow.stage='steal-peek';
    state.flow.stealPeeked=true;
    state.stealRoundCounter++;
    const panelTeam=opposingTeam();
    const nextInLine=getNextInLine(panelTeam);
    state.steal={
      roundId:state.stealRoundCounter, panelTeam,
      nextInLineId:nextInLine?nextInLine.id:null,
      votes:{}, locked:false, resolved:false, outcome:null
    };
    state.wheel=null;
  }
  await saveLobby(); R.host();
}
async function raceSwapAfterMiss(){
  const missedTeam=state.hotSeatTeam; const other=opposingTeam(missedTeam);
  rotateQueue(missedTeam); // next time missedTeam is up, a different player gets the seat
  const nextId=getNextInLine(other);
  state.hotSeatTeam=other;
  if(nextId) state.hotSeatPlayerId=nextId.id;
  state.currentQuestion=null; state.flow={stage:'idle',optionsRevealed:0,hotSeatAnswer:-1,stealPeeked:false,stealRevealed:false,doubleDipUsed:false};
  await saveLobby(); R.host();
}
async function retryDoubleDip(){
  state.flow.stage='selecting';
  state.flow.hotSeatAnswer=-1;
  await saveLobby(); R.host();
}
async function changeHotSeatPick(){
  const f=state.flow;
  if(f.stage==='revealed'||f.stage==='doubledip-miss'||f.stage==='race-miss'||f.stage==='revealing'){
    f.stage='selecting'; f.hotSeatAnswer=-1;
  } else if(f.stage==='steal-peek'&&state.steal&&!state.steal.locked){
    const nil=getNextInLine(state.steal.panelTeam);
    const voted=nil&&state.steal.votes[nil.id]!==undefined;
    if(!voted){ state.steal=null; f.stage='selecting'; f.hotSeatAnswer=-1; }
  }
  await saveLobby(); R.host();
}
async function revealHotSeatResult(){ state.flow.stage='revealed'; await saveLobby(); R.host(); } // kept for safety
async function revealStealGuess(){ state.flow.stage='steal-peek'; state.flow.stealPeeked=true; await saveLobby(); R.host(); }
async function lockStealAnswer(){ if(!state.steal) return; state.flow.stage='steal-locked'; await saveLobby(); R.host(); }
async function unlockStealAnswer(){ if(!state.steal) return; state.flow.stage='steal-peek'; await saveLobby(); R.host(); }
async function revealCorrectAnswer(){ state.flow.stage='steal-reveal'; state.flow.stealRevealed=true; await saveLobby(); R.host(); }

function flowButtonLabel(){
  const f=state.flow; const q=state.currentQuestion; if(!q) return '';
  if(f.stage==='idle') return 'Reveal Question';
  if(f.stage==='question') return q.options.length>1?'Reveal Option A':'Show Answer';
  if(f.stage==='options') return f.optionsRevealed<q.options.length?'Reveal Option '+letterFor(f.optionsRevealed):'';
  return '';
}

async function markCorrect(){
  const lvl=activeLevel(); const amt=levelMoney(lvl); const hp=hotSeatPlayer();
  if(hp&&state.gameMode==='classic') hp.personalBank=(hp.personalBank||0)+amt;
  if(await winLevel(state.hotSeatTeam, amt)){ await saveLobby(); R.host(); return; }
  state.currentQuestion=null; state.flow={stage:'idle',optionsRevealed:0,hotSeatAnswer:-1,stealPeeked:false,stealRevealed:false,doubleDipUsed:false};
  state.steal=null; state.wheel=null; state.puzzle.active=false;
  await saveLobby(); R.host();
}
async function advanceLevelNoMoney(){
  const lvl=state.ladderCurrent;
  // Failed steal — rotate the panel team so next player gets a turn next time
  if(state.steal) rotateQueue(state.steal.panelTeam);
  if(lvl<15) state.ladderCurrent=lvl+1;
  if(state.ladderCurrent===15&&!state.wager.resolved){ await startWager(); return; }
  state.currentQuestion=null; state.flow={stage:'idle',optionsRevealed:0,hotSeatAnswer:-1,stealPeeked:false,stealRevealed:false,doubleDipUsed:false};
  state.steal=null; state.wheel=null;
  await saveLobby(); R.host();
}

async function startSteal(){
  state.stealRoundCounter++;
  const panelTeam=opposingTeam(); const nextInLine=getNextInLine(panelTeam);
  state.steal={roundId:state.stealRoundCounter,panelTeam,nextInLineId:nextInLine?nextInLine.id:null,votes:{},locked:false,resolved:false,outcome:null};
  state.wheel=null; await saveLobby(); R.host();
}
function getNextInLine(team){
  const q=state.hotSeatQueue[team]||[];
  // Skip whoever is currently in the hot seat
  for(let i=0;i<q.length;i++){
    if(q[i]!==state.hotSeatPlayerId) return playerById(q[i])||null;
  }
  // All in queue are hot seat (shouldn't happen), fall back to first non-hotseat player
  return state.players.find(p=>p.team===team&&p.id!==state.hotSeatPlayerId)||null;
}
function rotateQueue(team){ const q=state.hotSeatQueue[team]||[]; if(q.length>1) q.push(q.shift()); }

async function pollStealVotes(){
  if(!state.steal||state.steal.locked) return;
  const prefix=`gsv:${currentLobbyCode}:${state.steal.roundId}:`;
  const keys=await dbList(prefix);
  let changed=false;
  for(const k of keys){
    const pid=k.slice(prefix.length);
    if(!(pid in state.steal.votes)){
      const res=await dbGet(k);
      if(res&&res.value!==undefined){ state.steal.votes[pid]=parseInt(res.value,10); changed=true; }
    }
  }
  if(changed){ await saveLobby(); if(mode==='host') R.host(); }
}

async function hostSetStealVote(displayIdx){
  if(!state.steal) return;
  const nil=getNextInLine(state.steal.panelTeam);
  if(nil){ state.steal.votes[nil.id]=displayIdx; }
  await saveLobby(); R.host();
}

async function resolveSteal(){
  if(!state.steal||!state.currentQuestion) return;
  state.steal.locked=true;
  const correctIdx=correctDisplayIdx(state.currentQuestion);
  const panelTeam=state.steal.panelTeam||opposingTeam();
  const amt=levelMoney(state.ladderCurrent);
  const nil=getNextInLine(panelTeam);
  const theirVote=nil?state.steal.votes[nil.id]:undefined;
  if(theirVote===correctIdx&&nil){
    nil.personalBank=(nil.personalBank||0)+amt;
    state.steal.outcome='stolen'; await applyStealWinner(nil.id);
  } else {
    state.steal.outcome='defended'; state.steal.resolved=true;
    await saveLobby(); R.host();
  }
}

async function applyStealWinner(playerId){
  const p=playerById(playerId); if(!p) return;
  const lvl=state.ladderCurrent; const amt=levelMoney(lvl);
  if(p.team==='A') state.teamABank=(state.teamABank||0)+amt;
  else state.teamBBank=(state.teamBBank||0)+amt;
  const origTeam=state.hotSeatTeam;
  // Rotate stealing team: winner (front) moves to back
  rotateQueue(p.team);
  // Rotate original team: advance to next player
  rotateQueue(origTeam);
  state.hotSeatPlayerId=p.id; state.hotSeatTeam=p.team;
  state.ladderWon[lvl-1]=true; state.ladderWonTeam[lvl-1]=state.hotSeatTeam;
  if(lvl<15) state.ladderCurrent=lvl+1;
  if(state.ladderCurrent===15&&!state.wager.resolved){
    await startWager(); return;
  }
  state.currentQuestion=null; state.flow={stage:'idle',optionsRevealed:0,hotSeatAnswer:-1,stealPeeked:false,stealRevealed:false,doubleDipUsed:false};
  state.steal=null; state.wheel=null; state.puzzle.active=false;
  await saveLobby(); R.host();
}

async function confirmWheelWinner(){
  if(!state.wheel) return;
  await applyStealWinner(state.wheel.playerIds[state.wheel.winnerIdx]);
}

async function confirmBombWheel(){
  if(!state.wheel||state.wheel.kind!=='bomb') return;
  let outcome=state.wheel.outcomes[state.wheel.winnerIdx];
  if(outcome.type==='mystery') outcome=outcome.resolved;
  const lvl=state.ladderCurrent; const hp=hotSeatPlayer();
  if(outcome.type==='win'||outcome.type==='vacation'){
    if(hp) hp.personalBank=(hp.personalBank||0)+outcome.amount;
    if(state.hotSeatTeam==='A') state.teamABank=(state.teamABank||0)+outcome.amount;
    else state.teamBBank=(state.teamBBank||0)+outcome.amount;
    state.ladderWon[lvl-1]=true; state.ladderWonTeam[lvl-1]=state.hotSeatTeam;
    if(lvl<15) state.ladderCurrent=lvl+1;
    if(state.ladderCurrent===15&&!state.wager.resolved){ state.wheel=null; await startWager(); return; }
  } else if(outcome.type==='bankrupt'){
    if(hp) hp.personalBank=0;
  } else if(outcome.type==='swap'){
    const other=opposingTeam();
    const nil=getNextInLine(other);
    if(nil){ state.hotSeatPlayerId=nil.id; state.hotSeatTeam=other; }
  }
  state.wheel=null; state.currentQuestion=null;
  state.flow={stage:'idle',optionsRevealed:0,hotSeatAnswer:-1,stealPeeked:false,stealRevealed:false,doubleDipUsed:false};
  await saveLobby(); R.host();
}

async function dismissDefendedSteal(){
  state.steal=null;
  await hostDrawQuestion();
}

/* ===== Lifelines ===== */
async function useLifeline(key){
  const team=state.hotSeatTeam;
  if(state.lifelines[team][key]) return;
  if(key==='promote'){
    const teammates=state.players.filter(p=>p.team===team&&p.id!==state.hotSeatPlayerId);
    if(!teammates.length){ showModal('','No other teammates to promote.',null,null); return; }
    showPicker('Promote: who takes the hot seat?', teammates.map(p=>({label:p.name,value:p.id})), async pid=>{
      state.lifelines[team].promote=true;
      state.hotSeatPlayerId=pid;
      await saveLobby(); R.host();
    });
    return;
  }
  if(key==='swap'){
    state.lifelines[team].swap=true;
    const lvl=activeLevel();
    const diff=state.currentQuestion?state.currentQuestion.difficulty:levelDiff(lvl);
    const newQ=pickQuestion(diff);
    if(newQ){
      newQ.used=true;
      state.currentQuestion=makeCurrentQuestion(newQ,lvl);
      // Drop the new question straight into place — keep whatever progress-free stage we
      // were already in (no re-reveal ceremony, no audio retrigger).
      state.flow={stage:'selecting',optionsRevealed:state.currentQuestion.options.length,hotSeatAnswer:-1,stealPeeked:false,stealRevealed:false,doubleDipUsed:false,doubleDipMissIdx:-1};
    }
    await saveLobby(); R.host(); return;
  }
  if(key==='bomb'){
    if(state.gameMode==='race') return; // Hail Mary is a money mechanic — not available in Race Mode
    state.lifelines[team].bomb=true;
    const outcomes=buildBombWheelOutcomes();
    state.wheel={
      id:genId(),
      kind:'bomb',
      names:outcomes.map(wheelOutcomeLabel),
      outcomes:outcomes,
      winnerIdx:Math.floor(Math.random()*outcomes.length),
      spunAt:null
    };
    state.currentQuestion=null;
    state.flow={stage:'idle',optionsRevealed:0,hotSeatAnswer:-1,stealPeeked:false,stealRevealed:false,doubleDipUsed:false};
    state.steal=null;
    await saveLobby(); R.host(); return;
  }
  state.lifelines[team][key]=true;
  await saveLobby(); R.host();
}
async function undoLifeline(key){
  // Testing aid — puts a used lifeline back so the host can re-trigger it.
  state.lifelines[state.hotSeatTeam][key]=false;
  await saveLobby(); R.host();
}

/* ===== Wildcard wheel — spin is a separate, explicit step so players can watch it land ===== */
async function spinWheel(){
  if(!state.wheel||state.wheel.spunAt) return;
  state.wheel.spunAt=Date.now();
  await saveLobby(); R.host();
}
async function requestSpinWheel(){
  if(!currentLobbyCode||!state.wheel||state.wheel.spunAt) return;
  setPhoneSpinRequestedFor(state.wheel.id);
  await dbSet(`llspin:${currentLobbyCode}`, String(Date.now()));
  R.player();
}
async function pollSpinRequest(){
  if(!state.wheel||state.wheel.spunAt) return;
  const res=await dbGet(`llspin:${currentLobbyCode}`);
  if(res&&res.value){
    await dbDelete(`llspin:${currentLobbyCode}`);
    await spinWheel();
  }
}

/* ===== Player-requested lifelines — phone sends a request, host (authoritative) applies it ===== */
async function phoneRequestLifeline(key, targetId){
  if(!currentLobbyCode||!myPlayerId) return;
  const me=playerById(myPlayerId); if(!me) return;
  setPhoneLifelineRequestedKey(key);
  await dbSet(`llreq:${currentLobbyCode}:${me.team}`, JSON.stringify({key,targetId:targetId||null,requesterId:myPlayerId,ts:Date.now()}));
  R.player();
}
async function pollLifelineRequests(){
  const team=state.hotSeatTeam;
  const res=await dbGet(`llreq:${currentLobbyCode}:${team}`);
  if(!res||!res.value) return;
  await dbDelete(`llreq:${currentLobbyCode}:${team}`);
  let req; try{ req=JSON.parse(res.value); }catch(e){ req=null; }
  if(!req||!req.key) return;
  // Only the player actually in the hot seat can request a lifeline.
  if(req.requesterId!==state.hotSeatPlayerId) return;
  const showLL=['question','options','selecting'].includes(state.flow.stage);
  if(!showLL||state.lifelines[team][req.key]) return;
  if(req.key==='promote'){
    if(!req.targetId) return;
    state.lifelines[team].promote=true;
    state.hotSeatPlayerId=req.targetId;
    await saveLobby(); if(mode==='host') R.host();
  } else {
    await useLifeline(req.key);
  }
}

/* ===== Score adjustments ===== */
async function applyAdjustment(targetType, targetId, amount, reason){
  // targetType: 'player' | 'teamA' | 'teamB'
  const adj={id:genId(),targetType,targetId,amount,reason:reason||'Manual adjustment',ts:Date.now()};
  state.adjustments.push(adj);
  if(targetType==='player'){
    const p=playerById(targetId);
    if(p) p.personalBank=Math.max(0,(p.personalBank||0)+amount);
  } else if(targetType==='teamA'){
    state.teamABank=Math.max(0,(state.teamABank||0)+amount);
  } else if(targetType==='teamB'){
    state.teamBBank=Math.max(0,(state.teamBBank||0)+amount);
  }
  await saveLobby(); R.host();
}

/* ===== Puzzle ===== */
async function triggerPuzzle(){
  const avail=state.phraseBank.filter(p=>!p.used);
  const pool=avail.length?avail:state.phraseBank;
  if(!pool.length){ showModal('','No puzzle phrases in the bank. Add some in Setup.',null,null); return; }
  const entry=pool[Math.floor(Math.random()*pool.length)];
  entry.used=true;
  state.puzzle={
    phrase:entry.phrase, category:entry.category||'',
    revealedLetters:[], usedLetters:[],
    active:true, glitchAt:Date.now(),
    currentGuessingTeam:state.hotSeatTeam,
    timerStartedAt:0, timerPaused:true, timerElapsed:0
  };
  state.currentQuestion=null; state.flow={stage:'idle',optionsRevealed:0,hotSeatAnswer:-1,stealPeeked:false,stealRevealed:false,doubleDipUsed:false};
  await saveLobby(); R.host();
}

async function pressLetter(ch){
  if(state.puzzle.usedLetters.includes(ch)) return;
  state.puzzle.usedLetters.push(ch);
  if((state.puzzle.phrase||'').toUpperCase().includes(ch)){
    state.puzzle.revealedLetters.push(ch);
  }
  // Start/reset timer
  state.puzzle.timerStartedAt=Date.now();
  state.puzzle.timerPaused=false;
  state.puzzle.timerElapsed=0;
  await saveLobby(); R.host();
}

async function pausePuzzleTimer(){
  if(state.puzzle.timerPaused) return;
  state.puzzle.timerElapsed=(state.puzzle.timerElapsed||0)+(Date.now()-state.puzzle.timerStartedAt);
  state.puzzle.timerPaused=true;
  await saveLobby(); R.host();
}

async function resumePuzzleTimer(){
  if(!state.puzzle.timerPaused) return;
  state.puzzle.timerStartedAt=Date.now();
  state.puzzle.timerPaused=false;
  await saveLobby(); R.host();
}

async function swapPuzzleHotSeat(){
  const other=opposingTeam(state.puzzle.currentGuessingTeam);
  state.puzzle.currentGuessingTeam=other;
  // Move hot seat to next player in queue on other team
  const queue=state.hotSeatQueue[other]||[];
  const candidates=state.players.filter(p=>p.team===other);
  let nextId=null;
  if(queue.length){
    const cur=queue.shift(); queue.push(cur); nextId=queue[0];
  } else if(candidates.length){
    nextId=candidates[0].id;
  }
  if(nextId){ state.hotSeatPlayerId=nextId; state.hotSeatTeam=other; }
  // Reset timer
  state.puzzle.timerStartedAt=Date.now();
  state.puzzle.timerPaused=false;
  state.puzzle.timerElapsed=0;
  await saveLobby(); R.host();
}

async function puzzleSolved(){
  await pausePuzzleTimer();
  const lvl=activeLevel(); const amt=levelMoney(lvl);
  const hp=hotSeatPlayer();
  if(hp&&state.gameMode==='classic') hp.personalBank=(hp.personalBank||0)+amt;
  if(await winLevel(state.hotSeatTeam, amt)){ state.puzzle.active=false; await saveLobby(); R.host(); return; }
  state.puzzle.active=false;
  state.currentQuestion=null; state.flow={stage:'idle',optionsRevealed:0,hotSeatAnswer:-1,stealPeeked:false,stealRevealed:false,doubleDipUsed:false};
  state.steal=null; state.wheel=null;
  await saveLobby(); R.host();
}

/* ===== Wager (before level 15) ===== */
async function startWager(){
  const diff=levelDiff(15);
  const q=pickQuestion(diff);
  if(q) q.used=true;
  setSeenWagerIds(new Set());
  state.wagerRoundCounter++;
  state.wager={
    roundId:state.wagerRoundCounter,
    active:true,
    question:q?makeCurrentQuestion(q,15):null,
    wagers:{}, answers:{}, revealed:false, resolved:false
  };
  state.gamePhase='wager';
  await saveLobby(); R.host();
}

async function pollWagers(){
  if(!state.wager||!state.wager.active||state.wager.revealed) return;
  const prefix=`wager:${currentLobbyCode}:${state.wager.roundId}:`;
  const keys=await dbList(prefix);
  let changed=false;
  for(const k of keys){
    const pid=k.slice(prefix.length);
    if(!(pid in state.wager.wagers)){
      const res=await dbGet(k);
      if(res&&res.value!==undefined){ state.wager.wagers[pid]=parseInt(res.value,10)||0; changed=true; }
    }
  }
  if(changed){ await saveLobby(); if(mode==='host') R.host(); }
}

async function pollWagerAnswers(){
  if(!state.wager||!state.wager.active||!state.wager.revealed||state.wager.resolved) return;
  const prefix=`wanswer:${currentLobbyCode}:${state.wager.roundId}:`;
  const keys=await dbList(prefix);
  let changed=false;
  state.wager.answers=state.wager.answers||{};
  for(const k of keys){
    const pid=k.slice(prefix.length);
    if(!(pid in state.wager.answers)){
      const res=await dbGet(k);
      if(res&&res.value!==undefined){ state.wager.answers[pid]=parseInt(res.value,10); changed=true; }
    }
  }
  if(changed){ await saveLobby(); if(mode==='host') R.host(); }
}

async function revealWagerQuestion(){
  state.wager.revealed=true;
  await saveLobby(); R.host();
}

// Everyone answers the same final question independently — each player wins or loses
// their own wager based on their own pick, then the game is over.
async function finalizeWager(){
  const w=state.wager; if(!w||!w.question) return;
  const correctIdx=correctDisplayIdx(w.question);
  const answers=w.answers||{};
  state.players.forEach(p=>{
    const amt=w.wagers[p.id]||0;
    if(amt===0) return;
    const got=answers[p.id]===correctIdx;
    if(got) p.personalBank=(p.personalBank||0)+amt;
    else p.personalBank=Math.max(0,(p.personalBank||0)-amt);
  });
  w.resolved=true;
  await endGame();
}

/* ===== Ending ===== */
async function endGame(){
  state.ended=true; state.gamePhase='ended';
  await saveLobby(); R.all();
}

/* ===== New game ===== */
function newGame(){
  document.getElementById('modal-icon').style.display='none';
  document.getElementById('modal-message').innerHTML='<b>Start a New Game</b><div style="font-size:13px;color:var(--c-muted);font-weight:400;margin-top:4px;">Scores, ladder, and lifelines always reset.</div>';
  document.getElementById('modal-picker').style.display='none';
  const wrap=document.getElementById('modal-input-wrap');
  wrap.style.display='block';
  wrap.innerHTML=`
    <label style="display:flex;align-items:center;gap:8px;font-size:14px;text-align:left;margin-bottom:10px;cursor:pointer;">
      <input type="checkbox" id="ng-keep-players" checked style="width:16px;height:16px;flex-shrink:0;"> Keep players &amp; teams
    </label>
    <label style="display:flex;align-items:center;gap:8px;font-size:14px;text-align:left;cursor:pointer;">
      <input type="checkbox" id="ng-keep-questions" checked style="width:16px;height:16px;flex-shrink:0;"> Keep questions &amp; puzzle phrases
    </label>`;
  const confirmBtn=document.getElementById('modal-confirm-btn');
  confirmBtn.style.display=''; confirmBtn.textContent='Start New Game';
  setPendingModal(doNewGame);
  document.getElementById('modal-overlay').classList.add('show');
}
async function doNewGame(){
  const keepPlayers=document.getElementById('ng-keep-players')?.checked??true;
  const keepQuestions=document.getElementById('ng-keep-questions')?.checked??true;
  state.gamePhase='setup';
  state.hostingStartedAt=0;
  setSetupStep('players');
  state.teamABank=0; state.teamBBank=0;
  if(keepPlayers){ state.players.forEach(p=>p.personalBank=0); }
  else { state.players=[]; state.hotSeatQueue={A:[],B:[]}; state.hotSeatPlayerId=null; }
  state.ladderCurrent=1;
  state.ladderWon=Array(15).fill(false);
  state.ladderWonTeam=Array(15).fill(null);
  state.race={A:{current:1,won:Array(15).fill(false)},B:{current:1,won:Array(15).fill(false)}};
  state.raceWinner=null;
  state.lifelines={A:{promote:false,doubleDip:false,swap:false},B:{promote:false,doubleDip:false,swap:false}};
  state.currentQuestion=null; state.flow={stage:'idle',optionsRevealed:0,hotSeatAnswer:-1,stealPeeked:false,stealRevealed:false,doubleDipUsed:false};
  state.steal=null; state.wheel=null;
  state.puzzle={phrase:'',category:'',revealedLetters:[],usedLetters:[],active:false,glitchAt:0,currentGuessingTeam:'A',timerStartedAt:0,timerPaused:true,timerElapsed:0};
  state.wager={active:false,question:null,wagers:{},revealed:false,resolved:false};
  state.adjustments=[];
  state.ended=false;
  if(keepQuestions){ state.questions.forEach(q=>q.used=false); state.phraseBank.forEach(p=>p.used=false); }
  else { state.questions=[]; state.phraseBank=[]; }
  await saveLobby(); setActiveHostTab('setup'); R.host();
}

/* ===== Players / setup ===== */
async function addPlayer(){
  const nameEl=document.getElementById('player-name-input');
  const teamEl=document.getElementById('player-team-input');
  const name=(nameEl.value||'').trim(); if(!name) return;
  const p={id:genId(),name,team:teamEl.value,personalBank:0};
  state.players.push(p);
  state.hotSeatQueue[teamEl.value].push(p.id);
  await saveLobby(); nameEl.value=''; R.host();
}
async function deletePlayer(id){
  state.players=state.players.filter(p=>p.id!==id);
  state.hotSeatQueue.A=state.hotSeatQueue.A.filter(x=>x!==id);
  state.hotSeatQueue.B=state.hotSeatQueue.B.filter(x=>x!==id);
  if(state.hotSeatPlayerId===id) state.hotSeatPlayerId=null;
  await saveLobby(); R.host();
}
async function togglePlayerTeam(id){
  const p=playerById(id); if(!p) return;
  state.hotSeatQueue[p.team]=state.hotSeatQueue[p.team].filter(x=>x!==id);
  p.team=p.team==='A'?'B':'A';
  state.hotSeatQueue[p.team].push(id);
  if(state.hotSeatPlayerId===id) state.hotSeatTeam=p.team;
  await saveLobby(); R.host();
}
async function setHotSeat(pid){
  const p=playerById(pid); if(!p) return;
  state.hotSeatPlayerId=p.id; state.hotSeatTeam=p.team;
  await saveLobby(); R.host();
}
async function startHosting(){
  state.gamePhase='live';
  state.hostingStartedAt=Date.now();
  if(!state.hotSeatPlayerId&&state.players.length){
    const first=state.players[0];
    state.hotSeatPlayerId=first.id; state.hotSeatTeam=first.team;
  }
  await saveLobby(); setActiveHostTab('game'); R.host();
}

/* ===== Question bank CRUD ===== */
async function saveQuestionFromForm(){
  const text=(document.getElementById('q-text').value||'').trim(); if(!text) return;
  const opts=['q-opt-a','q-opt-b','q-opt-c','q-opt-d'].map(id=>(document.getElementById(id).value||'').trim()).filter(v=>v);
  if(!opts.length) return;
  const diff=document.getElementById('q-diff').value||'easy';
  if(editingQuestion){
    const q=state.questions.find(x=>x.id===editingQuestion);
    if(q){ q.text=text; q.options=opts; q.difficulty=diff; }
    setEditingQuestion(null);
  } else {
    state.questions.push({id:genId(),text,options:opts,difficulty:diff,used:false});
  }
  await saveLobby();
  ['q-text','q-opt-a','q-opt-b','q-opt-c','q-opt-d'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  R.host();
}
function startEditQuestion(id){
  const q=state.questions.find(x=>x.id===id); if(!q) return;
  setEditingQuestion(id); R.host();
  setTimeout(()=>{
    const textEl=document.getElementById('q-text');
    if(textEl) textEl.value=q.text;
    (q.options||[]).forEach((o,i)=>{ const el=document.getElementById(['q-opt-a','q-opt-b','q-opt-c','q-opt-d'][i]); if(el) el.value=o; });
    const diffEl=document.getElementById('q-diff');
    if(diffEl) diffEl.value=q.difficulty||'easy';
  },0);
}
function cancelEditQuestion(){ setEditingQuestion(null); R.host(); }
async function deleteQuestion(id){
  state.questions=state.questions.filter(x=>x.id!==id);
  if(editingQuestion===id) setEditingQuestion(null);
  await saveLobby(); R.host();
}
async function resetAllUsedFlags(){
  state.questions.forEach(q=>q.used=false);
  state.phraseBank.forEach(p=>p.used=false);
  await saveLobby(); R.host();
}

/* Phrases */
async function savePhraseFromForm(){
  const cat=(document.getElementById('phrase-cat').value||'').trim();
  const phrase=(document.getElementById('phrase-text').value||'').trim(); if(!phrase) return;
  if(editingPhrase){
    const p=state.phraseBank.find(x=>x.id===editingPhrase);
    if(p){ p.category=cat; p.phrase=phrase; }
    setEditingPhrase(null);
  } else {
    state.phraseBank.push({id:genId(),category:cat,phrase:phrase,used:false});
  }
  await saveLobby();
  ['phrase-cat','phrase-text'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  R.host();
}
function startEditPhrase(id){
  const p=state.phraseBank.find(x=>x.id===id); if(!p) return;
  setEditingPhrase(id); R.host();
  setTimeout(()=>{
    const catEl=document.getElementById('phrase-cat'); if(catEl) catEl.value=p.category||'';
    const phraseEl=document.getElementById('phrase-text'); if(phraseEl) phraseEl.value=p.phrase;
  },0);
}
function cancelEditPhrase(){ setEditingPhrase(null); R.host(); }
async function deletePhrase(id){
  state.phraseBank=state.phraseBank.filter(x=>x.id!==id);
  if(editingPhrase===id) setEditingPhrase(null);
  await saveLobby(); R.host();
}

/* ===== Import/Export ===== */
function exportQuestionsMarkdown(){
  let md='# 🔥 The Hot Seat — Questions\n\n';
  ['easy','medium','hard'].forEach(diff=>{
    const qs=state.questions.filter(q=>q.difficulty===diff);
    if(!qs.length) return;
    md+=`## ${diff.charAt(0).toUpperCase()+diff.slice(1)}\n\n`;
    qs.forEach(q=>{
      md+=`### ${q.text}\n`;
      (q.options||[]).forEach((o,i)=>{ md+=`- ${i===0?'[ANSWER] ':''}${o}\n`; });
      md+='\n';
    });
  });
  md+='# Puzzle Phrases\n\n';
  state.phraseBank.forEach(p=>{ md+=`## ${p.category?p.category+': ':''}${p.phrase}\n\n`; });
  const blob=new Blob([md],{type:'text/markdown'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download='fortune-questions.md'; a.click();
  URL.revokeObjectURL(url);
}

function importQuestionsMarkdown(file){
  const reader=new FileReader();
  reader.onload=async e=>{
    const text=e.target.result;
    const lines=text.split('\n');
    let currentDiff='easy'; let currentQ=null; let inPhrases=false;
    let imported=0; let importedPhrases=0;
    for(let i=0;i<lines.length;i++){
      const line=lines[i].trim();
      if(line.startsWith('# Puzzle Phrases')){
        if(currentQ){ state.questions.push(currentQ); imported++; currentQ=null; }
        inPhrases=true; continue;
      }
      if(!inPhrases){
        if(line.startsWith('## Easy')) currentDiff='easy';
        else if(line.startsWith('## Medium')) currentDiff='medium';
        else if(line.startsWith('## Hard')) currentDiff='hard';
        else if(line.startsWith('### ')){
          if(currentQ){ state.questions.push(currentQ); imported++; }
          currentQ={id:genId(),text:line.slice(4).trim(),options:[],difficulty:currentDiff,used:false};
        } else if(line.startsWith('- ')&&currentQ){
          const isAnswer=line.startsWith('- [ANSWER] ');
          const optText=isAnswer?line.slice(11).trim():line.slice(2).trim();
          if(isAnswer) currentQ.options.unshift(optText);
          else currentQ.options.push(optText);
        }
      } else if(line.startsWith('## ')){
        // "## Category: PHRASE" or plain "## PHRASE"
        const rest=line.slice(3);
        const colonIdx=rest.indexOf(': ');
        const cat=colonIdx>-1?rest.slice(0,colonIdx).trim():'';
        const phrase=colonIdx>-1?rest.slice(colonIdx+2).trim():rest.trim();
        if(phrase){ state.phraseBank.push({id:genId(),category:cat,phrase,used:false}); importedPhrases++; }
      }
    }
    if(currentQ&&!inPhrases){ state.questions.push(currentQ); imported++; }
    await saveLobby();
    showModal('',`Imported ${imported} question${imported===1?'':'s'} and ${importedPhrases} phrase${importedPhrases===1?'':'s'}.`,null,null);
    R.host();
  };
  reader.readAsText(file);
}

/* ===== Phone: wager submission ===== */
async function phoneSubmitWager(amount){
  if(!myPlayerId||!currentLobbyCode||!state.wager) return;
  const key=`wager:${currentLobbyCode}:${state.wager.roundId}:${myPlayerId}`;
  await dbSet(key,String(amount));
  setPhoneWagerSubmitted(true);
  R.player();
}
async function phoneSubmitWagerAnswer(di){
  if(!myPlayerId||!currentLobbyCode||!state.wager||!state.wager.revealed) return;
  state.wager.answers=state.wager.answers||{};
  state.wager.answers[myPlayerId]=di;
  await dbSet(`wanswer:${currentLobbyCode}:${state.wager.roundId}:${myPlayerId}`,String(di));
  R.player();
}

/* ===== Phone: vote submission ===== */
async function phoneVote(dispIdx){
  if(!state.steal||!myPlayerId) return;
  window._myVote=dispIdx;
  setPhoneVotedRound(state.steal.roundId);
  await dbSet(`gsv:${currentLobbyCode}:${state.steal.roundId}:${myPlayerId}`,String(dispIdx));
  R.player();
}

function claimPlayer(pid){
  setMyPlayerId(pid);
  try{ localStorage.setItem('gs-my-player-'+currentLobbyCode,pid); } catch(e){}
  R.player();
}
function unclaimPlayer(){
  setMyPlayerId(null); setPhoneVotedRound(null); setPhoneWagerSubmitted(false);
  try{ localStorage.removeItem('gs-my-player-'+currentLobbyCode); } catch(e){}
  R.player();
}

/* ===== Test data ===== */
async function loadTestData(){
  showModal('','Load sample players, questions, and phrases? This adds to existing data.','Load Test Data', async()=>{
    const teams=[{n:'Alex',t:'A'},{n:'Blake',t:'A'},{n:'Casey',t:'B'},{n:'Dana',t:'B'}];
    teams.forEach(({n,t})=>{
      const p={id:genId(),name:n,team:t,personalBank:0};
      state.players.push(p);
      state.hotSeatQueue[t].push(p.id);
    });
    state.teamAName='The Brains'; state.teamBName='The Brawns';
    const qs=[
      {text:'What color is a stop sign?',options:['Red','Blue','Green','Yellow'],difficulty:'easy'},
      {text:'How many sides does a triangle have?',options:['3','4','5','6'],difficulty:'easy'},
      {text:'What planet is closest to the Sun?',options:['Mercury','Venus','Earth','Mars'],difficulty:'easy'},
      {text:'How many legs does a spider have?',options:['8','6','4','10'],difficulty:'easy'},
      {text:'What is the capital of France?',options:['Paris','London','Berlin','Madrid'],difficulty:'easy'},
      {text:'What gas do plants absorb from the air?',options:['Carbon dioxide','Oxygen','Nitrogen','Hydrogen'],difficulty:'easy'},
      {text:'Who painted the Mona Lisa?',options:['Leonardo da Vinci','Michelangelo','Raphael','Botticelli'],difficulty:'medium'},
      {text:'How many keys does a standard piano have?',options:['88','76','92','64'],difficulty:'medium'},
      {text:'What is the chemical symbol for gold?',options:['Au','Ag','Fe','Cu'],difficulty:'medium'},
      {text:'In what year did the Titanic sink?',options:['1912','1905','1920','1898'],difficulty:'medium'},
      {text:'What is the largest organ in the human body?',options:['Skin','Liver','Lungs','Heart'],difficulty:'medium'},
      {text:'What language has the most native speakers?',options:['Mandarin Chinese','English','Spanish','Hindi'],difficulty:'medium'},
      {text:'What is the speed of light (approx)?',options:['300,000 km/s','150,000 km/s','500,000 km/s','30,000 km/s'],difficulty:'hard'},
      {text:'Which element has atomic number 1?',options:['Hydrogen','Helium','Lithium','Carbon'],difficulty:'hard'},
      {text:'What is the powerhouse of the cell?',options:['Mitochondria','Nucleus','Ribosome','Golgi apparatus'],difficulty:'hard'},
      {text:'Who developed the theory of general relativity?',options:['Albert Einstein','Isaac Newton','Niels Bohr','Max Planck'],difficulty:'hard'},
      {text:'What ancient wonder was located in Alexandria?',options:['The Lighthouse','The Colossus','The Hanging Gardens','The Mausoleum'],difficulty:'hard'},
      {text:'Which treaty ended World War I?',options:['Treaty of Versailles','Treaty of Paris','Treaty of Westphalia','Treaty of Utrecht'],difficulty:'hard'},
    ];
    qs.forEach(q=>state.questions.push({id:genId(),...q,used:false}));
    const phrases=[
      {category:'Movie Title',phrase:'THE WIZARD OF OZ'},
      {category:'Famous Person',phrase:'ALBERT EINSTEIN'},
      {category:'Place',phrase:'GREAT WALL OF CHINA'},
      {category:'Phrase',phrase:'BETTER LATE THAN NEVER'},
    ];
    phrases.forEach(p=>state.phraseBank.push({id:genId(),...p,used:false}));
    await saveLobby(); R.host();
  });
}

/* ============================================================
   Part 4: Render helpers — shared builders
   ============================================================ */


function buildBoardHTML(puzzle, prevSet){
  const phrase=puzzle.phrase||'';
  if(!phrase.trim()) return '<div class="text-muted text-center" style="padding:20px;">No phrase loaded.</div>';
  const revSet=new Set((puzzle.revealedLetters||[]).map(l=>l.toUpperCase()));
  const words=phrase.toUpperCase().split(' ').filter(w=>w.length>0);
  let html='<div class="board-words">';
  words.forEach(word=>{
    html+='<div class="board-word">';
    for(const ch of word){
      if(!/[A-Z]/.test(ch)){
        html+=`<div class="tile" style="background:transparent;border-color:transparent;">${esc(ch)}</div>`;
      } else if(revSet.has(ch)){
        const isNew=prevSet&&!prevSet.has(ch);
        html+=`<div class="tile${isNew?' flip':''}">${ch}</div>`;
      } else {
        html+=`<div class="tile blank"></div>`;
      }
    }
    html+='</div>';
  });
  html+='</div>';
  return html;
}

function buildKeyboardHTML(puzzle){
  let html='<div class="keyboard">';
  QWERTY.forEach(row=>{
    html+='<div class="kb-row">';
    for(const ch of row){
      const used=(puzzle.usedLetters||[]).includes(ch);
      const hit=(puzzle.revealedLetters||[]).includes(ch);
      let cls='key';
      if(used) cls+=hit?' hit':' miss';
      html+=`<button class="${cls}" ${used?'disabled':''} onclick="pressLetter('${ch}')">${ch}</button>`;
    }
    html+='</div>';
  });
  html+='</div>';
  return html;
}

function puzzleTimerHTML(puzzle, idSuffix){
  const elapsed=puzzle.timerPaused
    ? (puzzle.timerElapsed||0)
    : (puzzle.timerElapsed||0)+(Date.now()-(puzzle.timerStartedAt||Date.now()));
  const remaining=Math.max(0, PUZZLE_TIMER_MS-elapsed);
  const secs=Math.ceil(remaining/1000);
  const pct=remaining/PUZZLE_TIMER_MS;
  const circ=175.9;
  const offset=circ*(1-pct);
  const urgent=secs<=5;
  return `<div class="puzzle-timer">
    <div class="timer-circle">
      <svg class="timer-svg" viewBox="0 0 60 60">
        <circle class="timer-track" cx="30" cy="30" r="28"/>
        <circle class="timer-fill${urgent?' urgent':''}" cx="30" cy="30" r="28" id="timer-fill-${idSuffix}"
          style="stroke-dashoffset:${offset.toFixed(1)}"/>
      </svg>
      <div class="timer-num" id="timer-num-${idSuffix}">${secs}</div>
    </div>
    <div class="timer-label">${puzzle.timerPaused?'Paused':'Guessing — '+esc(teamName(puzzle.currentGuessingTeam))}</div>
  </div>`;
}

/* ===== Wheel — outcome pool, visuals, physics-driven spin ===== */
function ladderStripHTML(team){
  const isRace=state.gameMode==='race';
  let html='<div class="ladder-row">';
  for(let l=1;l<=15;l++){
    const won=isLevelWon(team,l);
    const cur=activeLevel(team)===l;
    const label=isRace?l:money(LEVEL_MONEY[l-1]);
    html+=`<div class="lad-ic ${won?'won':''} ${cur?'current':''}">
      ${won?'✓':l}
      <span class="tip">${l}. ${label}${state.levelTypes[l-1]==='puzzle'?' · Puzzle':''}</span>
    </div>`;
  }
  html+='</div>';
  return html;
}

function diffPill(d){
  return `<span class="diff-${d}">${d}</span>`;
}

/* ===== Puzzle timer live update ===== */
function startPuzzleTimerRAF(){
  if(puzzleTimerRAF) cancelAnimationFrame(puzzleTimerRAF);
  function tick(){
    if(!state.puzzle.active||state.puzzle.timerPaused) return;
    const elapsed=(state.puzzle.timerElapsed||0)+(Date.now()-(state.puzzle.timerStartedAt||Date.now()));
    const remaining=Math.max(0,PUZZLE_TIMER_MS-elapsed);
    const secs=Math.ceil(remaining/1000);
    const pct=remaining/PUZZLE_TIMER_MS;
    const offset=(175.9*(1-pct)).toFixed(1);
    const urgent=secs<=5;
    // update host
    ['host','tv'].forEach(sfx=>{
      const fill=document.getElementById('timer-fill-'+sfx);
      const num=document.getElementById('timer-num-'+sfx);
      if(fill){ fill.style.strokeDashoffset=offset; fill.className='timer-fill'+(urgent?' urgent':''); }
      if(num) num.textContent=secs;
    });
    if(remaining>0) puzzleTimerRAF=requestAnimationFrame(tick);
    else if(mode==='host'){
      // Time's up — only host writes state, so display/player tabs watching in parallel don't race to double-swap
      swapPuzzleHotSeat();
    }
  }
  puzzleTimerRAF=requestAnimationFrame(tick);
}

/* ============================================================
   Part 5: Host render
   ============================================================ */

function renderHost(){
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

function openAdjustModal(){
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

async function doAdjustment(){
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

function renderGameTab(){
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

function renderQuickAdjustRail(){
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

async function quickAdjust(targetType,targetId,amount){
  await applyAdjustment(targetType,targetId,amount,'Quick adjust');
}

function renderFlowCard(isPuzzleLevel){
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


function renderStealWheel(){
  return `<div class="steal-box">
    <div class="steal-title">Tie-breaker — Multiple correct answers</div>
    ${buildWheelHTML(state.wheel,'host')}
    <div class="flow-controls" style="justify-content:center;margin-top:14px;">
      <button class="btn btn-primary" onclick="confirmWheelWinner()">Confirm Winner</button>
    </div>
  </div>`;
}

function renderBombWheel(){
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

function renderPuzzleControls(){
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

function renderWagerTab(){
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

function renderSetupTab(){
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
function goSetupStep(step){ setSetupStep(step); renderHost(); }
async function setGameMode(m){
  if(state.gamePhase!=='setup') return; // locked once hosting has started
  state.gameMode=m;
  await saveLobby(); renderHost();
}

function renderQuestionsTab(){
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

function renderRulesTab(){
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

function renderEndedHost(){
  return renderEndScreen();
}

async function toggleLevelType(l){
  state.levelTypes[l-1]=state.levelTypes[l-1]==='puzzle'?'':'puzzle';
  await saveLobby(); renderHost();
}

function setHostTab(t){ setActiveHostTab(t); renderHost(); }
function openDisplay(){
  const url=new URL(location.href); url.searchParams.set('lobby',currentLobbyCode); url.hash='display';
  window.open(url.toString(),'_blank');
}
function togglePlayerLinkPopover(){
  const pop=document.getElementById('player-link-popover'); if(!pop) return;
  const isOpen=pop.classList.contains('show');
  document.querySelectorAll('.link-popover.show').forEach(p=>p.classList.remove('show'));
  if(!isOpen){
    const url=new URL(location.href); url.searchParams.set('lobby',currentLobbyCode); url.hash='player';
    document.getElementById('player-link-input').value=url.toString();
    pop.classList.add('show');
  }
}
async function copyPlayerLinkFromPopover(){
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
function openHostMoreMenu(){
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

function playerNumber(playerId){
  const p=playerById(playerId); if(!p) return '';
  const teamPlayers=state.players.filter(x=>x.team===p.team);
  const idx=teamPlayers.findIndex(x=>x.id===playerId);
  return idx>=0?String(idx+1):'';
}

function buildTeamRoster(team){
  const players=state.players.filter(p=>p.team===team);
  if(!players.length) return '';
  const isActiveTeam=state.hotSeatTeam===team;
  const nil=isActiveTeam?null:getNextInLine(team);
  return '<div class="tv-roster">'+players.map(p=>{
    // Active team: highlight whoever is currently in the hot seat, no "Next" label.
    // Other team: highlight whoever is next in line, with a "Next" label.
    const isHighlighted=isActiveTeam?(state.hotSeatPlayerId===p.id):(!!nil&&nil.id===p.id);
    const fill=isHighlighted?`url(#${teamGradId(team)})`:'rgba(255,251,242,0.55)';
    return `<div class="tv-roster-p">
      <svg viewBox="0 0 146 211" class="tv-roster-flame"><use href="#flameShape" fill="${fill}"/></svg>
      <span class="tv-roster-name">${esc(p.name)}</span>
      ${(isHighlighted&&!isActiveTeam)?'<span class="tv-roster-next">Next</span>':''}
    </div>`;
  }).join('')+'</div>';
}

function buildLifelinesBar(team){
  const ll=state.lifelines[team]||{};
  const defs=LIFELINE_DEFS.filter(({key})=>!(state.gameMode==='race'&&(key==='bomb'||key==='doubleDip')));
  if(!defs.length) return '';
  return '<div class="tv-ll-bar">'+defs.map(({key,label})=>{
    const used=!!ll[key];
    const style=used?'':`color:${teamMidColor(team)};border-color:${teamMidColor(team)};box-shadow:0 0 18px ${teamMidColor(team)}77, inset 0 0 10px ${teamMidColor(team)}33;`;
    return `<div class="tv-ll-item ${used?'used':'avail'}">
      <div class="tv-ll-icon" style="${style}">${tvIcon(LIFELINE_ICONS[key],'1em')}</div>
      <div class="tv-ll-label">${esc(label)}</div>
    </div>`;
  }).join('')+'</div>';
}


function renderDisplay(){
  if(mode!=='display') return;
  document.body.classList.add('mode-display');
  const root=document.getElementById('app-root');
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

function renderPlayer(){
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

function submitPhoneWager(){
  const el=document.getElementById('ph-wager-input');
  const me=playerById(myPlayerId);
  const max=me?me.personalBank:0;
  const amount=Math.min(Math.max(0,parseInt(el?.value||'0',10)),max);
  phoneSubmitWager(amount);
}

function renderLobbyEntry(){
  return `<div class="center-screen">
    ${hotSeatLogoImg('ember','width:min(340px,88vw);height:auto;')}
    <div class="lobby-sub">Open the link your host shared to join automatically.</div>
    <button class="btn btn-primary btn-lg" onclick="location.hash='host';">Host a Game</button>
  </div>`;
}
function renderPlayerClaim(){
  return `<div class="center-screen">
    <div class="lobby-title" style="font-size:clamp(24px,4vw,36px);">Who are you?</div>
    <div class="lobby-sub">Lobby: <b style="color:var(--c-accent-hi);">${esc(state.lobbyName||currentLobbyCode)}</b></div>
    <div class="lobby-list">
      ${state.players.length===0?'<div class="hint">No players set up yet. Wait for the host to add players.</div>':
        state.players.map(p=>`<div class="lobby-item" onclick="claimPlayer('${p.id}')">
          <span><span class="lobby-item-code" style="font-size:14px;">${esc(p.name)}</span></span>
          <span class="lobby-item-info">${esc(teamName(p.team))}</span>
        </div>`).join('')}
    </div>
    <div class="hint" style="margin-top:8px;">Wrong lobby? Ask your host for the correct link.</div>
  </div>`;
}

// joinLobbyFromInput removed

/* ============================================================
   Part 8: Host lobby entry + ending screen
   ============================================================ */

function renderHostEntry(){
  return `<div class="center-screen" id="host-entry-screen">
    ${hotSeatLogoImg('ember','width:min(440px,90vw);height:auto;')}
    <div class="lobby-sub">Create a new game or open an existing one.</div>
    <div class="card" style="width:100%;max-width:420px;display:flex;flex-direction:column;gap:12px;">
      <div class="field" style="margin:0;"><label>New lobby name</label>
        <input type="text" class="input" id="new-lobby-name" placeholder="e.g. Family Game Night" maxlength="50" onkeydown="if(event.key==='Enter')createNewLobby()"></div>
      <button class="btn btn-primary btn-lg btn-block" onclick="createNewLobby()">+ Create Lobby</button>
      <div class="hint" id="host-error" style="color:var(--c-red-light);min-height:16px;"></div>
    </div>
    <div style="width:100%;max-width:420px;margin-top:14px;">
      <div class="hint text-center" style="margin-bottom:8px;">or open an existing lobby:</div>
      <div id="lobby-list-items" class="lobby-list"><div class="hint text-center">Loading…</div></div>
    </div>
    ${!hasSupabase?`<div class="sync-warning" style="max-width:420px;margin-top:12px;">⚠ Supabase not configured.</div>`:''}
  </div>`;
}
async function loadAndRenderLobbyList(){
  const wrap=document.getElementById('lobby-list-items'); if(!wrap) return;
  const lobbies=await listLobbies();
  if(!lobbies.length){ wrap.innerHTML='<div class="hint text-center">No lobbies yet.</div>'; return; }
  wrap.innerHTML=lobbies.map(l=>`<div class="lobby-item">
    <div><div class="lobby-item-code" style="font-size:15px;">${esc(l.name||l.code)}</div>
    <div class="lobby-item-info">${esc(l.phase||'')} · ${l.playerCount} player${l.playerCount===1?'':'s'}</div></div>
    <div style="display:flex;gap:6px;">
      <button class="btn btn-ghost btn-sm" onclick="openExistingLobby('${esc(l.code)}')">Open</button>
      <button class="btn btn-danger btn-sm" onclick="deleteLobbyFromList('${esc(l.code)}')">Delete</button>
    </div></div>`).join('');
}
async function openExistingLobby(slug){
  const errEl=document.getElementById('host-error');
  const ok=await loadLobby(slug); if(!ok){ if(errEl) errEl.textContent='Lobby not found.'; return; }
  setLobbyCode(slug); setSetupStep('players'); setLobbyInUrl(slug); render();
}
async function deleteLobbyFromList(slug){
  if(!confirm('Delete this lobby? Cannot be undone.')) return;
  await dbDelete('lobby:'+slug); loadAndRenderLobbyList();
}
async function createNewLobby(){
  const nameEl=document.getElementById('new-lobby-name');
  const errEl=document.getElementById('host-error'); const name=(nameEl?.value||'').trim();
  if(!name){ if(errEl) errEl.textContent='Enter a lobby name.'; return; }
  const slug=await createLobby(name);
  setLobbyInUrl(slug); setActiveHostTab('setup'); render();
}

function renderEndScreen(){
  if(state.gameMode==='race'){
    const winner=state.raceWinner;
    const sorted=[...state.players].sort((a,b)=>a.name.localeCompare(b.name));
    return `<div class="center-screen">
      <div class="end-title">Game Over</div>
      <div style="margin:20px 0;display:flex;flex-direction:column;gap:16px;align-items:center;width:100%;">
        <div class="card card-gold" style="text-align:center;width:100%;max-width:400px;">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.1em;color:var(--c-muted);margin-bottom:6px;">First to the Top</div>
          <div class="end-winner">${winner?esc(teamName(winner)):'—'}</div>
          <div class="end-amount">Level 15</div>
        </div>
        <div class="card" style="text-align:center;width:100%;max-width:400px;">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.1em;color:var(--c-muted);margin-bottom:6px;">Final Standing</div>
          <div style="font-size:14px;">${esc(state.teamAName)}: Level ${activeLevel('A')} &nbsp;·&nbsp; ${esc(state.teamBName)}: Level ${activeLevel('B')}</div>
        </div>
      </div>
      <table class="end-table">
        <tr><th>Player</th><th>Team</th></tr>
        ${sorted.map(p=>`<tr><td>${esc(p.name)}</td><td>${esc(teamName(p.team))}</td></tr>`).join('')}
      </table>
      <button class="btn btn-primary btn-lg mt-16" onclick="newGame()">Play Again</button>
    </div>`;
  }
  const sorted=[...state.players].sort((a,b)=>(b.personalBank||0)-(a.personalBank||0));
  const topPlayer=sorted[0];
  const teamA=state.teamABank; const teamB=state.teamBBank;
  const winTeam=teamA>=teamB?state.teamAName:state.teamBName;
  const winBank=Math.max(teamA,teamB);
  return `<div class="center-screen">
    <div class="end-title">Game Over</div>
    <div style="margin:20px 0;display:flex;flex-direction:column;gap:16px;align-items:center;width:100%;">
      <div class="card card-gold" style="text-align:center;width:100%;max-width:400px;">
        <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.1em;color:var(--c-muted);margin-bottom:6px;">Winning Team</div>
        <div class="end-winner">${esc(winTeam)}</div>
        <div class="end-amount">${money(winBank)}</div>
      </div>
      ${topPlayer?`<div class="card card-gold" style="text-align:center;width:100%;max-width:400px;">
        <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.1em;color:var(--c-muted);margin-bottom:6px;">Top Player</div>
        <div class="end-winner">${esc(topPlayer.name)}</div>
        <div class="end-amount">${money(topPlayer.personalBank)}</div>
        <div style="font-size:12px;color:var(--c-muted);">${esc(teamName(topPlayer.team))}</div>
      </div>`:''}
    </div>
    <table class="end-table">
      <tr><th>Player</th><th>Team</th><th>Personal Bank</th></tr>
      ${sorted.map(p=>`<tr><td>${esc(p.name)}</td><td>${esc(teamName(p.team))}</td><td>${money(p.personalBank)}</td></tr>`).join('')}
      <tr><td colspan="2" style="color:var(--c-muted);">${esc(state.teamAName)}</td><td style="color:var(--c-gold-light);">${money(state.teamABank)}</td></tr>
      <tr><td colspan="2" style="color:var(--c-muted);">${esc(state.teamBName)}</td><td style="color:var(--c-gold-light);">${money(state.teamBBank)}</td></tr>
    </table>
    <button class="btn btn-primary btn-lg mt-16" onclick="newGame()">Play Again</button>
  </div>`;
}

/* ============================================================
   Part 9: Boot & polling
   ============================================================ */

function render(){
  document.body.classList.remove('mode-display','mode-player','mode-host');
  if(mode==='display') renderDisplay();
  else if(mode==='player') renderPlayer();
  else if(mode==='host'){
    document.body.classList.add('mode-host');
    if(!currentLobbyCode){ document.getElementById('app-root').innerHTML=renderHostEntry(); setTimeout(loadAndRenderLobbyList,150); }
    else renderHost();
  }
}

window.addEventListener('hashchange',()=>{
  setMode(detectMode());
  render();
});

/* ===== Keyboard shortcuts (host, live play only) ===== */
function keyToOptionIndex(key){
  const map={'1':0,'2':1,'3':2,'4':3,'a':0,'b':1,'c':2,'d':3,'A':0,'B':1,'C':2,'D':3};
  return key in map ? map[key] : null;
}
function handleHostKeydown(e){
  if(mode!=='host'||hostTab!=='game') return;
  const active=document.activeElement;
  const tag=active&&active.tagName?active.tagName.toLowerCase():'';
  if(tag==='input'||tag==='textarea'||tag==='select'||(active&&active.isContentEditable)) return;
  if(document.getElementById('modal-overlay')?.classList.contains('show')) return;

  const f=state.flow; const q=state.currentQuestion;
  const key=e.key;

  const optIdx=keyToOptionIndex(key);
  if(optIdx!==null&&q&&optIdx<q.options.length){
    if(f.stage==='selecting'){ e.preventDefault(); hostSelectAnswer(optIdx); return; }
    if(f.stage==='steal-peek'){ e.preventDefault(); hostSetStealVote(optIdx); return; }
  }

  if(key===' '||key==='Enter'){
    if(['idle','question','options'].includes(f.stage)&&q){ e.preventDefault(); flowAdvance(); return; }
    if(f.stage==='revealing'){ e.preventDefault(); confirmHotSeatReveal(); return; }
    if(f.stage==='steal-locked'){ e.preventDefault(); revealCorrectAnswer(); return; }
    if(f.stage==='revealed'&&q&&f.hotSeatAnswer===correctDisplayIdx(q)){ e.preventDefault(); markCorrect(); return; }
    if(f.stage==='doubledip-miss'){ e.preventDefault(); retryDoubleDip(); return; }
    if(f.stage==='race-miss'){ e.preventDefault(); raceSwapAfterMiss(); return; }
  }
}
document.addEventListener('keydown', handleHostKeydown);


/* ============================================================
   Inline-handler compatibility barrel
   Module scope is not global, so the 71 functions referenced from
   inline on* attributes in generated markup must be published on
   window or every button silently becomes a no-op. Generated from
   the handler attributes themselves - do not hand-edit; regenerate
   if you add or rename an inline handler.
   ============================================================ */
Object.assign(window, {
  setPromoteMenu,
  addPlayer, advanceLevelNoMoney, cancelEditPhrase, cancelEditQuestion,
  cancelModal, changeHotSeatPick, claimPlayer, confirmBombWheel,
  confirmHotSeatReveal, confirmModal, confirmWheelWinner, copyPlayerLinkFromPopover,
  createNewLobby, deleteLobbyFromList, deletePhrase, deletePlayer,
  deleteQuestion, dismissDefendedSteal, esc, exportQuestionsMarkdown,
  finalizeWager, flowAdvance, goSetupStep, hostDrawQuestion,
  hostSelectAnswer, hostSetStealVote, importQuestionsMarkdown, loadTestData,
  lockStealAnswer, markCorrect, newGame, openAdjustModal,
  openDisplay, openExistingLobby, openHostMoreMenu, pausePuzzleTimer,
  phoneRequestLifeline, phoneSubmitWagerAnswer, phoneVote, pressLetter,
  puzzleSolved, quickAdjust, raceSwapAfterMiss, renderPlayer,
  requestSpinWheel, rerollQuestion, resolveSteal, resumePuzzleTimer,
  retryDoubleDip, revealCorrectAnswer, revealWagerQuestion, savePhraseFromForm,
  saveQuestionFromForm, setGameMode, setHostTab, setHotSeat,
  showModal, spinWheel, startEditPhrase, startEditQuestion,
  startHosting, submitPhoneWager, swapPuzzleHotSeat, toggleLevelType,
  togglePlayerLinkPopover, togglePlayerTeam, triggerPuzzle, unclaimPlayer,
  undoLifeline, unlockStealAnswer, useLifeline,
});

/* Fill in the late-bound render hooks that rules modules call through.
   Must run before the first render. */
bindRenderers({ host: renderHost, player: renderPlayer, display: renderDisplay, all: render });

(async function init(){
  setMode(detectMode());
  if(mode==='display'){
    const params=new URLSearchParams(location.search);
    const slug=params.get('lobby');
    if(slug){ const ok=await loadLobby(slug); if(ok) setLobbyCode(slug); }
    render(); pollTimer=setInterval(pollForUpdates,1200); return;
  }
  if(mode==='player'){
    const params=new URLSearchParams(location.search);
    const slug=params.get('lobby');
    if(slug){ const ok=await loadLobby(slug); if(ok) setLobbyCode(slug); }
    if(currentLobbyCode){ try{ const saved=localStorage.getItem('gs-my-player-'+currentLobbyCode); if(saved&&playerById(saved)) setMyPlayerId(saved); } catch(e){} }
    render(); pollTimer=setInterval(pollForUpdates,1500); return;
  }
  // Host mode — load from URL slug
  const hParams=new URLSearchParams(location.search); const hSlug=hParams.get('lobby');
  if(hSlug){ const ok=await loadLobby(hSlug); if(ok) setLobbyCode(hSlug); }
  render(); pollTimer=setInterval(pollForUpdates,1500); setTimeout(loadAndRenderLobbyList,150);
})();
function setLobbyInUrl(slug){ const url=new URL(location.href); url.searchParams.set('lobby',slug); history.replaceState({},'',url.toString()); }
