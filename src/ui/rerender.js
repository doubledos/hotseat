/* rerender.js
   Late-bound render hooks.

   Rules modules need to trigger a repaint, but screens import rules, so a
   direct import the other way would create a cycle. Rules call R.host() and
   friends instead; main.js fills these in at boot via bindRenderers(). Before
   boot they are harmless no-ops. */

export const R = {
  host(){}, player(){}, display(){}, all(){}
};

export function bindRenderers(fns){ Object.assign(R, fns); }
