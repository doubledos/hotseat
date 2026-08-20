/* ladder.js
   Who is playing, which rung they are on, and what clearing it is worth.

   Classic mode shares one ladder across both teams; race mode gives each team
   its own, which is why the level helpers all take an optional team. */

import { LEVEL_DIFFICULTY_DEFAULT, LEVEL_MONEY } from '../core/constants.js';
import { state } from '../core/state.js';
import { saveLobby } from '../core/lobby.js';
import { R } from '../ui/rerender.js';

export function elapsedMinutes(){ return state.hostingStartedAt?Math.max(0,Math.floor((Date.now()-state.hostingStartedAt)/60000)):0; }

export function playerById(id){ return state.players.find(p=>p.id===id)||null; }
export function teamName(t){ return t==='A'?state.teamAName:state.teamBName; }
export function opposingTeam(t){ return (t||state.hotSeatTeam)==='A'?'B':'A'; }
export function hotSeatPlayer(){ return playerById(state.hotSeatPlayerId); }
// Level currently in play for a team. Classic mode shares one ladder; race mode gives each team its own.
export function activeLevel(team){
  if(state.gameMode==='race') return state.race[team||state.hotSeatTeam].current;
  return state.ladderCurrent;
}
export function isLevelWon(team, l){
  if(state.gameMode==='race') return !!state.race[team||state.hotSeatTeam].won[l-1];
  return !!state.ladderWon[l-1];
}
export function levelMoney(l){ return LEVEL_MONEY[(l||activeLevel())-1]||100; }
export function levelType(l){ const idx=(l||activeLevel())-1; return state.levelTypes[idx]==='puzzle'?'puzzle':'trivia'; }
export function levelDiff(l){ const idx=(l||activeLevel())-1; if(state.levelTypes[idx]==='puzzle') return 'puzzle'; return LEVEL_DIFFICULTY_DEFAULT(l||activeLevel()); }
// Marks the given team's current level cleared and advances them. Returns true if that
// clear means the team just won the race (race mode only — reached past level 15).
export function advanceLevel(team){
  if(state.gameMode==='race'){
    const r=state.race[team];
    r.won[r.current-1]=true;
    if(r.current>=15) return true;
    r.current+=1;
    return false;
  }
  const lvl=state.ladderCurrent;
  state.ladderWon[lvl-1]=true; state.ladderWonTeam[lvl-1]=team;
  if(lvl<15) state.ladderCurrent=lvl+1;
  return false;
}
// A team clearing their current level: credits money (classic only), advances their ladder,
// and triggers whatever comes next — the Final Wager (classic, reaching 15) or an outright
// win (race, reaching the top). Returns true if the caller should stop (game/round is over).
export async function winLevel(team, amount){
  if(state.gameMode==='classic'){
    if(team==='A') state.teamABank=(state.teamABank||0)+amount;
    else state.teamBBank=(state.teamBBank||0)+amount;
  }
  const reachedTop=advanceLevel(team);
  if(state.gameMode==='race'&&reachedTop){
    state.raceWinner=team; state.ended=true; state.gamePhase='ended';
    return true;
  }
  if(state.gameMode==='classic'&&state.ladderCurrent===15&&!state.wager.resolved){
    await startWager();
    return true;
  }
  return false;
}
