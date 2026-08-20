/* session.js
   Per-tab session state: which surface this tab is showing and which lobby it
   is attached to. Not game state - none of this is persisted to the database.

   Exported as live `let` bindings, so importers always read the current value.
   Rebinding from another module is impossible, so writes go through setters. */

export let mode = 'entry';            // entry | host | display | player
export let currentLobbyCode = '';

export function setMode(next){ mode = next; return mode; }
export function setLobbyCode(next){ currentLobbyCode = next; return currentLobbyCode; }
