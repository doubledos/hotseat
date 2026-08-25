/* bank-format.js
   Parse and serialise the question bank's text form.

   The bank is edited as one big textarea, so this is the only thing standing
   between a paste and the owner's entire question library. It is pure - no
   state, no storage, no DOM - so it can be tested in plain node, and it never
   half-writes: a parse either succeeds completely or reports errors and
   changes nothing.

   Format, one question per line, first answer correct (the options[0]
   convention the rest of the app relies on - see correctDisplayIdx in
   rules/pool.js):

     What is the capital of France? | Paris | London | Berlin | Madrid
     x2026-08-25 How many sides does a triangle have? | 3 | 4 | 5 | 6

     --- PHRASES ---
     Movie Title | THE EMPIRE STRIKES BACK
     THE EMPIRE STRIKES BACK

   A leading `x` marks a question as used, and the date it was used rides along
   with it, so a download is a complete backup rather than content only. A bare
   `x` typed by hand means "used, date unknown" and is preserved as such.

   That marker is how permanence survives a round trip. The alternative - matching questions by their text -
   would silently un-retire a question every time a typo in it was fixed.
   Deleting the x by hand restores the question, which is the undo when
   something is burned by mistake.

   Blank lines are ignored and `#` starts a comment. */

export const PHRASE_DIVIDER = '--- PHRASES ---';
export const DELIM = '|';
/* A question marked used by hand carries no date. Kept as a real value rather
   than an empty string, which would be falsy and read as never used. */
export const UNKNOWN_DATE = 'unknown';
const MIN_OPTIONS = 2;

/* Serialise. The used date rides in the marker, so parse(serialise(x)) is
   lossless. */
const markerFor = (usedAt) => !usedAt ? '' : (usedAt===UNKNOWN_DATE ? 'x ' : `x${usedAt} `);
export function serialiseBank(bank){
  const lines = [];
  for(const q of (bank.questions||[])){
    const opts = (q.options||[]).join(` ${DELIM} `);
    lines.push(`${markerFor(q.usedAt)}${q.text} ${DELIM} ${opts}`);
  }
  lines.push('', PHRASE_DIVIDER, '');
  for(const p of (bank.phrases||[])){
    const mark = markerFor(p.usedAt);
    lines.push(p.category ? `${mark}${p.category} ${DELIM} ${p.phrase}` : `${mark}${p.phrase}`);
  }
  return lines.join('\n').replace(/\n+$/,'') + '\n';
}

/* Parse. Returns {ok, questions, phrases, errors}. Errors carry the 1-based
   line number, because finding one bad line in nine hundred by eye is not a
   reasonable thing to ask of anyone. */
export function parseBank(text, opts){
  const makeId = (opts && opts.makeId) || (() => Math.random().toString(36).slice(2,9));
  const questions = [], phrases = [], errors = [];
  let inPhrases = false;

  const raw = String(text==null ? '' : text).split('\n');
  for(let i=0;i<raw.length;i++){
    const lineNo = i+1;
    let line = raw[i].trim();
    if(!line || line.startsWith('#')) continue;
    if(line.toUpperCase() === PHRASE_DIVIDER){ inPhrases = true; continue; }

    /* The marker only counts at the very start, so a question whose text
       merely begins with the letter x is not silently retired. An optional
       ISO date rides with it; a bare x means used on an unknown date. */
    let usedAt = null;
    const mark = line.match(/^x(\d{4}-\d{2}-\d{2})?\s+/i);
    if(mark){ usedAt = mark[1] || UNKNOWN_DATE; line = line.slice(mark[0].length); }

    const parts = line.split(DELIM).map(s=>s.trim());
    if(parts.some(p=>p==='')){
      errors.push({line:lineNo, text:raw[i], msg:`empty field - check for a stray "${DELIM}"`});
      continue;
    }

    if(inPhrases){
      if(parts.length === 1) phrases.push({id:makeId(), category:'', phrase:parts[0], usedAt});
      else if(parts.length === 2) phrases.push({id:makeId(), category:parts[0], phrase:parts[1], usedAt});
      else errors.push({line:lineNo, text:raw[i], msg:`a phrase takes "PHRASE" or "Category ${DELIM} PHRASE", got ${parts.length} fields`});
      continue;
    }

    const [qText, ...options] = parts;
    if(options.length < MIN_OPTIONS){
      errors.push({line:lineNo, text:raw[i],
        msg:`needs at least ${MIN_OPTIONS} answers after the question, got ${options.length}`});
      continue;
    }
    questions.push({id:makeId(), text:qText, options, usedAt});
  }

  return {ok: errors.length===0, questions, phrases, errors};
}

/* A one-line summary for the host, so the editor can say what will happen
   before anything is written. */
export function describeParse(res){
  if(!res.ok){
    const n = res.errors.length;
    return `${n} problem${n===1?'':'s'} — nothing saved. ` +
           res.errors.slice(0,3).map(e=>`line ${e.line}: ${e.msg}`).join('; ') +
           (n>3 ? ` (and ${n-3} more)` : '');
  }
  const used = res.questions.filter(q=>q.usedAt).length;
  return `${res.questions.length} questions (${res.questions.length-used} unused, ${used} retired)` +
         `, ${res.phrases.length} phrase${res.phrases.length===1?'':'s'}`;
}
