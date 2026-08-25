/* Tests for the question bank's text format.

   This parser is the only thing between a paste into a textarea and the whole
   question library, so it gets tested harder than anything else here. The
   cases that matter are the ones where being wrong is silent: a retired
   question quietly coming back, or a malformed line being mangled into a
   plausible-looking question instead of refused.

     node tools/test-bank-format.mjs
*/

import { parseBank, serialiseBank, describeParse, UNKNOWN_DATE } from '../src/core/bank-format.js';

let pass = 0, fail = 0;
const t = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got  ${g}\n       want ${w}`); }
};
/* Ids are random by design; strip them so comparisons are about content. */
const ids = { makeId: (() => { let n = 0; return () => 'id' + (++n); })() };
const bare = q => ({text:q.text, options:q.options, usedAt:q.usedAt});

console.log('-- a plain question --');
{
  const r = parseBank('What is the capital of France? | Paris | London | Berlin | Madrid', ids);
  t('parses', r.ok, true);
  t('splits text from answers', bare(r.questions[0]),
    {text:'What is the capital of France?', options:['Paris','London','Berlin','Madrid'], usedAt:null});
}

console.log('-- the used marker --');
{
  const r = parseBank('x2026-08-25 A? | 1 | 2\nx B? | 3 | 4\nC? | 5 | 6', ids);
  t('dated marker keeps its date', r.questions[0].usedAt, '2026-08-25');
  t('bare x means used, date unknown', r.questions[1].usedAt, UNKNOWN_DATE);
  t('no marker means never used', r.questions[2].usedAt, null);
  /* The bug this guards: an empty string is falsy, so a retired question would
     read as unused everywhere that tests !q.usedAt. */
  t('used is never an empty string', r.questions.every(q => q.usedAt !== ''), true);
}
{
  const r = parseBank('xylophone has how many strings? | 0 | 4', ids);
  t('a question merely starting with x is not retired', r.questions[0].usedAt, null);
  t('...and keeps its full text', r.questions[0].text, 'xylophone has how many strings?');
}

console.log('-- round trip is lossless --');
{
  const src = 'A? | 1 | 2\nx2026-08-25 B? | 3 | 4\nx C? | 5 | 6\n\n--- PHRASES ---\n\nMovie | THE THING\nx2026-01-02 Song | HEY JUDE\nNO CATEGORY HERE\n';
  const once = parseBank(src, ids);
  const out  = serialiseBank({questions:once.questions, phrases:once.phrases});
  const twice = parseBank(out, ids);
  t('questions survive', twice.questions.map(bare), once.questions.map(bare));
  t('phrases survive', twice.phrases.map(p=>({category:p.category,phrase:p.phrase,usedAt:p.usedAt})),
                        once.phrases.map(p=>({category:p.category,phrase:p.phrase,usedAt:p.usedAt})));
  t('serialising twice is stable', serialiseBank({questions:twice.questions, phrases:twice.phrases}), out);
}

console.log('-- editing a retired question keeps it retired --');
{
  /* The reason the marker exists rather than matching on text: fixing a typo
     must not hand the question back to the pool. */
  const first = parseBank('x2026-08-25 Waht is 2+2? | 4 | 5', ids);
  const edited = serialiseBank({questions:first.questions, phrases:[]}).replace('Waht','What');
  const after = parseBank(edited, ids);
  t('text changed', after.questions[0].text, 'What is 2+2?');
  t('still retired, same date', after.questions[0].usedAt, '2026-08-25');
}

console.log('-- bad input is refused, with the line number --');
{
  const r = parseBank('Good? | 1 | 2\nLonely question with no answers\nAlso good? | 3 | 4', ids);
  t('not ok', r.ok, false);
  t('one error', r.errors.length, 1);
  t('names the right line', r.errors[0].line, 2);
  t('says what is wrong', /at least 2 answers/.test(r.errors[0].msg), true);
}
{
  const r = parseBank('Only one answer? | 4', ids);
  t('one answer is not enough', r.ok, false);
}
{
  /* A stray pipe would otherwise produce an empty option that renders as a
     blank button - refused instead. */
  const r = parseBank('Which symbol is or? | | | & | !', ids);
  t('stray delimiter refused, not mangled', r.ok, false);
  t('flags the empty field', /stray/.test(r.errors[0].msg), true);
}

console.log('-- ignored lines --');
{
  const r = parseBank('# a comment\n\n   \nReal? | 1 | 2\n# another', ids);
  t('comments and blanks skipped', r.questions.length, 1);
  t('the real one survives', r.questions[0].text, 'Real?');
}
{
  const r = parseBank('', ids);
  t('empty input is valid', r.ok, true);
  t('and yields nothing', [r.questions.length, r.phrases.length], [0,0]);
}
{
  const r = parseBank(null, ids);
  t('null input does not throw', r.ok, true);
}

console.log('-- whitespace --');
{
  const r = parseBank('   Padded?   |   A   |   B   ', ids);
  t('fields are trimmed', bare(r.questions[0]), {text:'Padded?', options:['A','B'], usedAt:null});
}

console.log('-- the summary shown to the host --');
{
  const good = parseBank('A? | 1 | 2\nx B? | 3 | 4', ids);
  t('counts unused and retired', describeParse(good), '2 questions (1 unused, 1 retired), 0 phrases');
  const bad = parseBank('nope', ids);
  t('a failure says nothing was saved', /nothing saved/.test(describeParse(bad)), true);
  t('...and points at the line', /line 1/.test(describeParse(bad)), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
