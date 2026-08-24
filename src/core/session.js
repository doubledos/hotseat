/* session.js
   Per-tab session state: which surface this tab is showing and which lobby it
   is attached to. Not game state - none of this is persisted to the database.

   Exported as live `let` bindings, so importers always read the current value.
   Rebinding from another module is impossible, so writes go through setters. */

export let mode = 'entry';            // entry | host | display | player
export let currentLobbyCode = '';

export function setMode(next){ mode = next; return mode; }
export function setLobbyCode(next){ currentLobbyCode = next; return currentLobbyCode; }

/* Surface-scoped UI flags. These are read across modules (rules and screens
   both touch them), so they live here as live bindings with setters. */

export let hostTab = 'game'; // game | setup | questions | rules
export function setActiveHostTab(next){ hostTab = next; return hostTab; }
export let setupStep = 'players'; // players | questions | levels | ready
export function setSetupStep(next){ setupStep = next; return setupStep; }
export let editingQuestion = null;
export function setEditingQuestion(next){ editingQuestion = next; return editingQuestion; }
export let editingPhrase = null;
export function setEditingPhrase(next){ editingPhrase = next; return editingPhrase; }
export let myPlayerId = null; // phone: which player this device has claimed
export function setMyPlayerId(next){ myPlayerId = next; return myPlayerId; }
export let phoneVotedRound = null;
export function setPhoneVotedRound(next){ phoneVotedRound = next; return phoneVotedRound; }

/* Sus mode, per tab: which round this phone has already answered and voted in.
   Held here rather than in game state so one player's phone cannot reveal
   another's progress, and so a repaint does not offer a second submission. */
export let susAnsweredRound = null;
export function setSusAnsweredRound(next){ susAnsweredRound = next; return susAnsweredRound; }
export let susVotedRound = null;
export function setSusVotedRound(next){ susVotedRound = next; return susVotedRound; }
export let susMyRole = null;   // 'sus' | 'good', fetched once per game
export function setSusMyRole(next){ susMyRole = next; return susMyRole; }
export let phoneWagerSubmitted = false;
export function setPhoneWagerSubmitted(next){ phoneWagerSubmitted = next; return phoneWagerSubmitted; }
export let seenWagerIds = new Set();
export function setSeenWagerIds(next){ seenWagerIds = next; return seenWagerIds; }
export let phoneSpinRequestedFor = null;
export function setPhoneSpinRequestedFor(next){ phoneSpinRequestedFor = next; return phoneSpinRequestedFor; }
export let phoneLifelineRequestedKey = null;
export function setPhoneLifelineRequestedKey(next){ phoneLifelineRequestedKey = next; return phoneLifelineRequestedKey; }
export let phonePromoteMenuOpen = false;
export function setPhonePromoteMenuOpen(next){ phonePromoteMenuOpen = next; return phonePromoteMenuOpen; }
export let lastWheelSeen = 0; // host+display: last wheel spin already animated
export function setLastWheelSeen(next){ lastWheelSeen = next; return lastWheelSeen; }

/* Keep the lobby slug in the URL so a refresh, or a link shared with the TV
   or a phone, reopens the same game. */
export function setLobbyInUrl(slug){ const url=new URL(location.href); url.searchParams.set('lobby',slug); history.replaceState({},'',url.toString()); }
