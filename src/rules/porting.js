/* porting.js
   Markdown import and export for the question bank, so a host can prepare
   questions outside the app. */

import { state } from '../core/state.js';
import { saveLobby } from '../core/lobby.js';
import { R } from '../ui/rerender.js';
import { showModal } from '../ui/modal.js';
import { genId } from '../core/util.js';

/* ===== Import/Export ===== */
export function exportQuestionsMarkdown(){
  let md='# 🔥 The Hot Seat — Questions\n\n';
  ['easy','medium','hard'].forEach(diff=>{
    const qs=state.questions.filter(q=>q.difficulty===diff);
    if(!qs.length) return;
    md+=`## ${diff.charAt(0).toUpperCase()+diff.slice(1)}\n\n`;
    qs.forEach(q=>{
      md+=`### ${q.text}\n`;
      (q.options||[]).forEach((o,i)=>{ md+=`- ${i===0?'[ANSWER] ':''}${o}\n`; });
      md+='\n';
    });
  });
  md+='# Puzzle Phrases\n\n';
  state.phraseBank.forEach(p=>{ md+=`## ${p.category?p.category+': ':''}${p.phrase}\n\n`; });
  const blob=new Blob([md],{type:'text/markdown'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download='fortune-questions.md'; a.click();
  URL.revokeObjectURL(url);
}

export function importQuestionsMarkdown(file){
  const reader=new FileReader();
  reader.onload=async e=>{
    const text=e.target.result;
    const lines=text.split('\n');
    let currentDiff='easy'; let currentQ=null; let inPhrases=false;
    let imported=0; let importedPhrases=0;
    for(let i=0;i<lines.length;i++){
      const line=lines[i].trim();
      if(line.startsWith('# Puzzle Phrases')){
        if(currentQ){ state.questions.push(currentQ); imported++; currentQ=null; }
        inPhrases=true; continue;
      }
      if(!inPhrases){
        if(line.startsWith('## Easy')) currentDiff='easy';
        else if(line.startsWith('## Medium')) currentDiff='medium';
        else if(line.startsWith('## Hard')) currentDiff='hard';
        else if(line.startsWith('### ')){
          if(currentQ){ state.questions.push(currentQ); imported++; }
          currentQ={id:genId(),text:line.slice(4).trim(),options:[],difficulty:currentDiff,used:false};
        } else if(line.startsWith('- ')&&currentQ){
          const isAnswer=line.startsWith('- [ANSWER] ');
          const optText=isAnswer?line.slice(11).trim():line.slice(2).trim();
          if(isAnswer) currentQ.options.unshift(optText);
          else currentQ.options.push(optText);
        }
      } else if(line.startsWith('## ')){
        // "## Category: PHRASE" or plain "## PHRASE"
        const rest=line.slice(3);
        const colonIdx=rest.indexOf(': ');
        const cat=colonIdx>-1?rest.slice(0,colonIdx).trim():'';
        const phrase=colonIdx>-1?rest.slice(colonIdx+2).trim():rest.trim();
        if(phrase){ state.phraseBank.push({id:genId(),category:cat,phrase,used:false}); importedPhrases++; }
      }
    }
    if(currentQ&&!inPhrases){ state.questions.push(currentQ); imported++; }
    await saveLobby();
    showModal('',`Imported ${imported} question${imported===1?'':'s'} and ${importedPhrases} phrase${importedPhrases===1?'':'s'}.`,null,null);
    R.host();
  };
  reader.readAsText(file);
}
