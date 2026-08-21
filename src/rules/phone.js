/* phone.js
   What a player's phone is allowed to submit: a steal vote, a wager, and a
   wager answer. Everything else is the host's call. */

import { state } from '../core/state.js';
import { saveLobby } from '../core/lobby.js';
import { R } from '../ui/rerender.js';
import { myPlayerId, phoneVotedRound, phoneWagerSubmitted, setPhoneVotedRound, setPhoneWagerSubmitted } from '../core/session.js';
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

export function claimPlayer(pid){
  setMyPlayerId(pid);
  try{ localStorage.setItem('gs-my-player-'+currentLobbyCode,pid); } catch(e){}
  R.player();
}
export function unclaimPlayer(){
  setMyPlayerId(null); setPhoneVotedRound(null); setPhoneWagerSubmitted(false);
  try{ localStorage.removeItem('gs-my-player-'+currentLobbyCode); } catch(e){}
  R.player();
}
