/* wager.js
   The Final Wager: every player stakes an amount, then answers. Scoring is
   per player, and the game ends afterwards either way. */

import { state } from '../core/state.js';
import { saveLobby } from '../core/lobby.js';
import { R } from '../ui/rerender.js';
import { showModal } from '../ui/modal.js';
import { esc, money } from '../core/util.js';
import { seenWagerIds } from '../core/session.js';
import { levelDiff, playerById, teamName } from './ladder.js';
import { correctDisplayIdx, makeCurrentQuestion, pickQuestion } from './pool.js';
import { endGame } from './score.js';
import { dbGet, dbList } from '../core/db.js';
import { currentLobbyCode, mode, setSeenWagerIds } from '../core/session.js';

/* ===== Wager (before level 15) ===== */
export async function startWager(){
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

export async function pollWagers(){
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

export async function pollWagerAnswers(){
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

export async function revealWagerQuestion(){
  state.wager.revealed=true;
  await saveLobby(); R.host();
}

// Everyone answers the same final question independently — each player wins or loses
// their own wager based on their own pick, then the game is over.
export async function finalizeWager(){
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
