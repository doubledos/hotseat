/* modal.js
   The single confirm/picker dialog. Markup lives in index.html; this drives it.

   pendingModal holds the callback to run on confirm. Two callers (new game,
   score adjustment) build their own body and then set the callback directly,
   so it is exposed through setPendingModal rather than kept private. */

import { esc } from '../core/util.js';

export let pendingModal = null;
export function setPendingModal(fn){ pendingModal = fn; return pendingModal; }

/* ===== Modal ===== */
export function showModal(icon, message, confirmLabel, onConfirm){
  pendingModal = onConfirm;
  document.getElementById('modal-icon').textContent = icon||'';
  document.getElementById('modal-icon').style.display = icon?'':'none';
  document.getElementById('modal-message').innerHTML = message;
  document.getElementById('modal-picker').style.display = 'none';
  document.getElementById('modal-input-wrap').style.display = 'none';
  const confirmBtn = document.getElementById('modal-confirm-btn');
  confirmBtn.style.display = onConfirm?'':'none';
  confirmBtn.textContent = confirmLabel||'Confirm';
  document.getElementById('modal-overlay').classList.add('show');
}
export function showPicker(message, items, onPick){
  pendingModal = null;
  document.getElementById('modal-icon').style.display = 'none';
  document.getElementById('modal-message').innerHTML = message;
  const picker = document.getElementById('modal-picker');
  picker.innerHTML = items.map((it,i)=>`<button class="picker-item" data-i="${i}">${esc(it.label)}</button>`).join('');
  picker.style.display = 'flex';
  picker.querySelectorAll('button').forEach(btn=>{
    btn.addEventListener('click',()=>{ cancelModal(); onPick(items[parseInt(btn.dataset.i)].value); });
  });
  document.getElementById('modal-input-wrap').style.display = 'none';
  document.getElementById('modal-confirm-btn').style.display = 'none';
  document.getElementById('modal-overlay').classList.add('show');
}
export function cancelModal(){
  pendingModal=null;
  document.getElementById('modal-overlay').classList.remove('show');
}
export function confirmModal(){
  const fn=pendingModal; cancelModal(); if(fn) fn();
}

/* ============================================================
   Part 3: Game actions — flow, steal, lifelines, puzzle, wager, new game
   ============================================================ */
