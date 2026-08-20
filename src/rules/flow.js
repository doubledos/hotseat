/* flow.js
   Driving one question from draw to resolution: reveal the question, reveal
   options one at a time, lock the hot seat player's answer, then either bank
   the money or hand the question to the other team as a steal.

   state.flow.stage is the single source of truth for where in that sequence
   the table currently is; every screen renders from it. */

import { state } from '../core/state.js';
import { saveLobby } from '../core/lobby.js';
import { R } from '../ui/rerender.js';
import { showModal, showPicker } from '../ui/modal.js';
import { esc, money, shuffleArray } from '../core/util.js';
import { LEVEL_MONEY } from '../core/constants.js';
import { seenWagerIds, setSeenWagerIds } from '../core/session.js';
import { activeLevel, advanceLevel, hotSeatPlayer, isLevelWon, levelDiff, levelMoney, levelType, opposingTeam, playerById, teamName, winLevel } from './ladder.js';
import { correctDisplayIdx, makeCurrentQuestion, pickQuestion } from './pool.js';
import { startWager } from './wager.js';
import { dbGet, dbList } from '../core/db.js';
import { currentLobbyCode, mode } from '../core/session.js';
import { letterFor } from '../core/util.js';

/* ===== Question flow ===== */
export async function hostDrawQuestion(){
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

export async function rerollQuestion(){
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

export async function flowAdvance(){
  const f=state.flow; const q=state.currentQuestion; if(!q) return;
  const optCount=q.options.length; const isMC=optCount>1;
  if(f.stage==='idle'){ f.stage='question'; }
  else if(f.stage==='question'){ if(isMC){f.stage='options';f.optionsRevealed=1;}else{f.stage='selecting';} }
  else if(f.stage==='options'){ if(f.optionsRevealed<optCount) f.optionsRevealed++; if(f.optionsRevealed>=optCount) f.stage='selecting'; }
  await saveLobby(); R.host();
}
export async function hostSelectAnswer(di){
  // Lock in the pick first — dramatic pause before the actual reveal (see confirmHotSeatReveal).
  state.flow.hotSeatAnswer=di;
  state.flow.stage='revealing';
  await saveLobby(); R.host();
}
export async function confirmHotSeatReveal(){
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
export async function raceSwapAfterMiss(){
  const missedTeam=state.hotSeatTeam; const other=opposingTeam(missedTeam);
  rotateQueue(missedTeam); // next time missedTeam is up, a different player gets the seat
  const nextId=getNextInLine(other);
  state.hotSeatTeam=other;
  if(nextId) state.hotSeatPlayerId=nextId.id;
  state.currentQuestion=null; state.flow={stage:'idle',optionsRevealed:0,hotSeatAnswer:-1,stealPeeked:false,stealRevealed:false,doubleDipUsed:false};
  await saveLobby(); R.host();
}
export async function retryDoubleDip(){
  state.flow.stage='selecting';
  state.flow.hotSeatAnswer=-1;
  await saveLobby(); R.host();
}
export async function changeHotSeatPick(){
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
export async function revealHotSeatResult(){ state.flow.stage='revealed'; await saveLobby(); R.host(); } // kept for safety
export async function revealStealGuess(){ state.flow.stage='steal-peek'; state.flow.stealPeeked=true; await saveLobby(); R.host(); }
export async function lockStealAnswer(){ if(!state.steal) return; state.flow.stage='steal-locked'; await saveLobby(); R.host(); }
export async function unlockStealAnswer(){ if(!state.steal) return; state.flow.stage='steal-peek'; await saveLobby(); R.host(); }
export async function revealCorrectAnswer(){ state.flow.stage='steal-reveal'; state.flow.stealRevealed=true; await saveLobby(); R.host(); }

export function flowButtonLabel(){
  const f=state.flow; const q=state.currentQuestion; if(!q) return '';
  if(f.stage==='idle') return 'Reveal Question';
  if(f.stage==='question') return q.options.length>1?'Reveal Option A':'Show Answer';
  if(f.stage==='options') return f.optionsRevealed<q.options.length?'Reveal Option '+letterFor(f.optionsRevealed):'';
  return '';
}

export async function markCorrect(){
  const lvl=activeLevel(); const amt=levelMoney(lvl); const hp=hotSeatPlayer();
  if(hp&&state.gameMode==='classic') hp.personalBank=(hp.personalBank||0)+amt;
  if(await winLevel(state.hotSeatTeam, amt)){ await saveLobby(); R.host(); return; }
  state.currentQuestion=null; state.flow={stage:'idle',optionsRevealed:0,hotSeatAnswer:-1,stealPeeked:false,stealRevealed:false,doubleDipUsed:false};
  state.steal=null; state.wheel=null; state.puzzle.active=false;
  await saveLobby(); R.host();
}
export async function advanceLevelNoMoney(){
  const lvl=state.ladderCurrent;
  // Failed steal — rotate the panel team so next player gets a turn next time
  if(state.steal) rotateQueue(state.steal.panelTeam);
  if(lvl<15) state.ladderCurrent=lvl+1;
  if(state.ladderCurrent===15&&!state.wager.resolved){ await startWager(); return; }
  state.currentQuestion=null; state.flow={stage:'idle',optionsRevealed:0,hotSeatAnswer:-1,stealPeeked:false,stealRevealed:false,doubleDipUsed:false};
  state.steal=null; state.wheel=null;
  await saveLobby(); R.host();
}

export async function startSteal(){
  state.stealRoundCounter++;
  const panelTeam=opposingTeam(); const nextInLine=getNextInLine(panelTeam);
  state.steal={roundId:state.stealRoundCounter,panelTeam,nextInLineId:nextInLine?nextInLine.id:null,votes:{},locked:false,resolved:false,outcome:null};
  state.wheel=null; await saveLobby(); R.host();
}
export function getNextInLine(team){
  const q=state.hotSeatQueue[team]||[];
  // Skip whoever is currently in the hot seat
  for(let i=0;i<q.length;i++){
    if(q[i]!==state.hotSeatPlayerId) return playerById(q[i])||null;
  }
  // All in queue are hot seat (shouldn't happen), fall back to first non-hotseat player
  return state.players.find(p=>p.team===team&&p.id!==state.hotSeatPlayerId)||null;
}
export function rotateQueue(team){ const q=state.hotSeatQueue[team]||[]; if(q.length>1) q.push(q.shift()); }

export async function pollStealVotes(){
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

export async function hostSetStealVote(displayIdx){
  if(!state.steal) return;
  const nil=getNextInLine(state.steal.panelTeam);
  if(nil){ state.steal.votes[nil.id]=displayIdx; }
  await saveLobby(); R.host();
}

export async function resolveSteal(){
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

export async function applyStealWinner(playerId){
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

export async function confirmWheelWinner(){
  if(!state.wheel) return;
  await applyStealWinner(state.wheel.playerIds[state.wheel.winnerIdx]);
}

export async function confirmBombWheel(){
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

export async function dismissDefendedSteal(){
  state.steal=null;
  await hostDrawQuestion();
}
