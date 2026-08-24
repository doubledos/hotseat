/* phone.js
   What a player's phone is allowed to submit: a steal vote, a wager, and a
   wager answer. Everything else is the host's call. */

import { state } from '../core/state.js';
import { saveLobby } from '../core/lobby.js';
import { R } from '../ui/rerender.js';
import { myPlayerId, phoneVotedRound, phoneWagerSubmitted, setPhoneVotedRound, setPhoneWagerSubmitted } from '../core/session.js';
import { susAnsweredRound, susVotedRound, setSusAnsweredRound, setSusVotedRound, setSusMyRole } from '../core/session.js';
import { susAnsKey, susVoteKey } from './sus.js';
import { playerById } from './ladder.js';
import { dbSet } from '../core/db.js';
import { currentLobbyCode, setMyPlayerId } from '../core/session.js';

/* ===== Phone: wager submission ===== */
export async function phoneSubmitWager(amount){
  if(!myPlayerId||!currentLobbyCode||!state.wager) return;
  const key=`wager:${currentLobbyCode}:${state.wager.roundId}:${myPlayerId}`;
  await dbSet(key,String(amount));
  setPhoneWagerSubmitted(true);
  R.player();
}
export async function phoneSubmitWagerAnswer(di){
  if(!myPlayerId||!currentLobbyCode||!state.wager||!state.wager.revealed) return;
  state.wager.answers=state.wager.answers||{};
  state.wager.answers[myPlayerId]=di;
  await dbSet(`wanswer:${currentLobbyCode}:${state.wager.roundId}:${myPlayerId}`,String(di));
  R.player();
}

/* ===== Phone: vote submission ===== */
export async function phoneVote(dispIdx){
  if(!state.steal||!myPlayerId) return;
  window._myVote=dispIdx;
  setPhoneVotedRound(state.steal.roundId);
  await dbSet(`gsv:${currentLobbyCode}:${state.steal.roundId}:${myPlayerId}`,String(dispIdx));
  R.player();
}

/* ===== Phone: Sus mode =====
   Both write only this player's own row and let the host merge them. Six
   phones writing the lobby blob at once would lose answers to each other. */
export async function phoneSubmitSusAnswer(idx){
  const s = state.sus;
  if(!myPlayerId||!currentLobbyCode||!s.active) return;
  if(s.stage!=='answering') return;
  if(!s.eligible.includes(myPlayerId)) return;   // suspended players sit the round out
  if(susAnswered() ) return;                      // one shot, no changing it later
  await dbSet(susAnsKey(s.round, myPlayerId), String(idx));
  setSusAnsweredRound(s.round);
  R.player();
}
export async function phoneSubmitSusVote(targetId){
  const s = state.sus;
  if(!myPlayerId||!currentLobbyCode||!s.active) return;
  if(s.stage!=='voting') return;
  if(!s.eligible.includes(myPlayerId)) return;   // suspended players do not vote
  if(susVotedRound===s.round) return;
  await dbSet(susVoteKey(s.round, myPlayerId), String(targetId||'skip'));
  setSusVotedRound(s.round);
  R.player();
}
export function susAnswered(){ return susAnsweredRound===state.sus.round; }

export function claimPlayer(pid){
  setMyPlayerId(pid);
  try{ localStorage.setItem('gs-my-player-'+currentLobbyCode,pid); } catch(e){}
  R.player();
}
export function unclaimPlayer(){
  setMyPlayerId(null); setPhoneVotedRound(null); setPhoneWagerSubmitted(false);
  setSusAnsweredRound(null); setSusVotedRound(null); setSusMyRole(null);
  try{ localStorage.removeItem('gs-my-player-'+currentLobbyCode); } catch(e){}
  R.player();
}
