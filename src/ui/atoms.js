/* atoms.js
   Small markup fragments shared by more than one surface: the money ladder
   strip and the team roster / lifeline bars the TV and the
   host console both draw. */

import { LEVEL_MONEY, LIFELINE_DEFS } from '../core/constants.js';
import { state } from '../core/state.js';
import { esc, money } from '../core/util.js';
import { getNextInLine } from '../rules/flow.js';
import { activeLevel, isLevelWon, playerById } from '../rules/ladder.js';
import { LIFELINE_ICONS, teamGradId, teamMidColor, tvIcon } from './icons.js';
export function ladderStripHTML(team){
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


/* ===== Puzzle timer live update ===== */

export function playerNumber(playerId){
  const p=playerById(playerId); if(!p) return '';
  const teamPlayers=state.players.filter(x=>x.team===p.team);
  const idx=teamPlayers.findIndex(x=>x.id===playerId);
  return idx>=0?String(idx+1):'';
}

export function buildTeamRoster(team){
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

export function buildLifelinesBar(team){
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
