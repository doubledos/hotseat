/* lifelines.js
   The four lifelines, plus the request channel the phones use.

   A phone cannot change the game directly. It writes a request into the state
   and the host, which is authoritative, polls for it and applies it. */

import { state } from '../core/state.js';
import { saveLobby } from '../core/lobby.js';
import { R } from '../ui/rerender.js';
import { showModal, showPicker } from '../ui/modal.js';
import { esc, genId } from '../core/util.js';
import { LIFELINE_DEFS } from '../core/constants.js';
import { myPlayerId, phoneLifelineRequestedKey, phoneSpinRequestedFor, setPhoneLifelineRequestedKey, setPhoneSpinRequestedFor } from '../core/session.js';
import { activeLevel, hotSeatPlayer, levelDiff, opposingTeam, playerById, teamName } from './ladder.js';
import { makeCurrentQuestion, pickQuestion } from './pool.js';
import { buildBombWheelOutcomes, wheelOutcomeLabel } from './wheel.js';
import { dbDelete, dbGet, dbSet } from '../core/db.js';
import { currentLobbyCode, mode } from '../core/session.js';

/* ===== Lifelines ===== */
export async function useLifeline(key){
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
export async function undoLifeline(key){
  // Testing aid — puts a used lifeline back so the host can re-trigger it.
  state.lifelines[state.hotSeatTeam][key]=false;
  await saveLobby(); R.host();
}

/* ===== Wildcard wheel — spin is a separate, explicit step so players can watch it land ===== */
export async function spinWheel(){
  if(!state.wheel||state.wheel.spunAt) return;
  state.wheel.spunAt=Date.now();
  await saveLobby(); R.host();
}
export async function requestSpinWheel(){
  if(!currentLobbyCode||!state.wheel||state.wheel.spunAt) return;
  setPhoneSpinRequestedFor(state.wheel.id);
  await dbSet(`llspin:${currentLobbyCode}`, String(Date.now()));
  R.player();
}
export async function pollSpinRequest(){
  if(!state.wheel||state.wheel.spunAt) return;
  const res=await dbGet(`llspin:${currentLobbyCode}`);
  if(res&&res.value){
    await dbDelete(`llspin:${currentLobbyCode}`);
    await spinWheel();
  }
}

/* ===== Player-requested lifelines — phone sends a request, host (authoritative) applies it ===== */
export async function phoneRequestLifeline(key, targetId){
  if(!currentLobbyCode||!myPlayerId) return;
  const me=playerById(myPlayerId); if(!me) return;
  setPhoneLifelineRequestedKey(key);
  await dbSet(`llreq:${currentLobbyCode}:${me.team}`, JSON.stringify({key,targetId:targetId||null,requesterId:myPlayerId,ts:Date.now()}));
  R.player();
}
export async function pollLifelineRequests(){
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
