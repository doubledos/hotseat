/* lobby.js
   Reading and writing a whole game to the kv_store. One row per lobby, keyed
   'lobby:<slug>', value is the serialised state object.

   lastSavedJSON is the last payload this tab wrote or read. pollForUpdates
   compares against it to tell "someone else changed the game" from "this is
   just my own write coming back". */

import { dbGet, dbList, dbSet } from './db.js';
import { defaultState, normalizeState, setState, state } from './state.js';
import { currentLobbyCode, setLobbyCode } from './session.js';
import { slugify } from './util.js';

export let lastSavedJSON = '';
export function setLastSaved(json){ lastSavedJSON = json; return lastSavedJSON; }

/* ===== Lobby / persistence ===== */
export function lobbyKey(code){ return 'lobby:'+(code||currentLobbyCode); }

export async function loadLobby(code){
  const res = await dbGet(lobbyKey(code));
  if(res&&res.value){
    setState(normalizeState(JSON.parse(res.value)));
    setLobbyCode(code);
    lastSavedJSON = res.value;
    return true;
  }
  return false;
}

export async function saveLobby(){
  const json = JSON.stringify(state);
  lastSavedJSON = json;
  await dbSet(lobbyKey(), json);
}

export async function createLobby(name){
  const slug=slugify(name||'game');
  setState(defaultState()); state.code=slug; state.lobbyName=name||slug;
  setLobbyCode(slug); await saveLobby(); return slug;
}

export async function listLobbies(){
  const keys=await dbList('lobby:'); const lobbies=[];
  for(const k of keys.slice(0,20)){
    const res=await dbGet(k);
    if(res&&res.value){ try{ const s=JSON.parse(res.value);
      lobbies.push({code:s.code||k.replace('lobby:',''),name:s.lobbyName||s.code||k.replace('lobby:',''),phase:s.gamePhase,playerCount:(s.players||[]).length});
    } catch(e){} }
  }
  return lobbies;
}
