/* players.js
   Roster management during setup: adding and removing players, moving them
   between teams, and choosing who starts in the hot seat. */

import { state } from '../core/state.js';
import { saveLobby } from '../core/lobby.js';
import { R } from '../ui/rerender.js';
import { showModal } from '../ui/modal.js';
import { esc, genId } from '../core/util.js';
import { setActiveHostTab } from '../core/session.js';
import { playerById, teamName } from './ladder.js';

/* ===== Players / setup ===== */
export async function addPlayer(){
  const nameEl=document.getElementById('player-name-input');
  const teamEl=document.getElementById('player-team-input');
  const name=(nameEl.value||'').trim(); if(!name) return;
  const p={id:genId(),name,team:teamEl.value,personalBank:0};
  state.players.push(p);
  state.hotSeatQueue[teamEl.value].push(p.id);
  await saveLobby(); nameEl.value=''; R.host();
}
export async function deletePlayer(id){
  state.players=state.players.filter(p=>p.id!==id);
  state.hotSeatQueue.A=state.hotSeatQueue.A.filter(x=>x!==id);
  state.hotSeatQueue.B=state.hotSeatQueue.B.filter(x=>x!==id);
  if(state.hotSeatPlayerId===id) state.hotSeatPlayerId=null;
  await saveLobby(); R.host();
}
export async function togglePlayerTeam(id){
  const p=playerById(id); if(!p) return;
  state.hotSeatQueue[p.team]=state.hotSeatQueue[p.team].filter(x=>x!==id);
  p.team=p.team==='A'?'B':'A';
  state.hotSeatQueue[p.team].push(id);
  if(state.hotSeatPlayerId===id) state.hotSeatTeam=p.team;
  await saveLobby(); R.host();
}
export async function setHotSeat(pid){
  const p=playerById(pid); if(!p) return;
  state.hotSeatPlayerId=p.id; state.hotSeatTeam=p.team;
  await saveLobby(); R.host();
}
export async function startHosting(){
  state.gamePhase='live';
  state.hostingStartedAt=Date.now();
  if(!state.hotSeatPlayerId&&state.players.length){
    const first=state.players[0];
    state.hotSeatPlayerId=first.id; state.hotSeatTeam=first.team;
  }
  await saveLobby(); setActiveHostTab('game'); R.host();
}
