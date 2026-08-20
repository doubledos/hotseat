/* entry.js
   Everything before and after a game: lobby entry, the host's lobby list,
   the player claim screen, and the final scoreboard. */

import { dbDelete, hasSupabase } from '../core/db.js';
import { createLobby, listLobbies, loadLobby } from '../core/lobby.js';
import { currentLobbyCode, setActiveHostTab, setLobbyCode, setSetupStep } from '../core/session.js';
import { state } from '../core/state.js';
import { esc, money } from '../core/util.js';
import { activeLevel, teamName } from '../rules/ladder.js';
import { claimPlayer } from '../rules/phone.js';
import { newGame } from '../rules/score.js';
import { hotSeatLogoImg } from '../ui/icons.js';
import { R } from '../ui/rerender.js';
import { setLobbyInUrl } from '../core/session.js';
export function renderLobbyEntry(){
  return `<div class="center-screen">
    ${hotSeatLogoImg('ember','width:min(340px,88vw);height:auto;')}
    <div class="lobby-sub">Open the link your host shared to join automatically.</div>
    <button class="btn btn-primary btn-lg" onclick="location.hash='host';">Host a Game</button>
  </div>`;
}
export function renderPlayerClaim(){
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

export function renderHostEntry(){
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
export async function loadAndRenderLobbyList(){
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
export async function openExistingLobby(slug){
  const errEl=document.getElementById('host-error');
  const ok=await loadLobby(slug); if(!ok){ if(errEl) errEl.textContent='Lobby not found.'; return; }
  setLobbyCode(slug); setSetupStep('players'); setLobbyInUrl(slug); R.all();
}
export async function deleteLobbyFromList(slug){
  if(!confirm('Delete this lobby? Cannot be undone.')) return;
  await dbDelete('lobby:'+slug); loadAndRenderLobbyList();
}
export async function createNewLobby(){
  const nameEl=document.getElementById('new-lobby-name');
  const errEl=document.getElementById('host-error'); const name=(nameEl?.value||'').trim();
  if(!name){ if(errEl) errEl.textContent='Enter a lobby name.'; return; }
  const slug=await createLobby(name);
  setLobbyInUrl(slug); setActiveHostTab('setup'); R.all();
}

export function renderEndScreen(){
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
