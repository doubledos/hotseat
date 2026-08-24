#!/usr/bin/env python3
"""Static checks for the module split.

Catches the three failure modes that syntax checks do not:
  1. an identifier used in one module but declared (unexported) in another
  2. an import that the target module does not actually export
  3. import statements buried inside a leading block comment, which parse
     fine and silently do nothing
  4. a function called from an inline onclick="..." that main.js never
     republishes on window - the button renders and silently does nothing
  5. a CSS custom property that is used but never defined - the declaration is
     dropped and the element renders with an inherited value, which on the TV
     means dark ink on a dark stage
"""
import re, glob, os, sys

FILES = ['src/main.js'] + sorted(f for f in glob.glob('src/**/*.js', recursive=True) if f != 'src/main.js')

def strip(s):
    """Remove comments AND string contents.

    String contents matter: this file is full of prose like 'Sus mode ready',
    and a plain scan reads the word `mode` in there as a reference to the
    session binding of the same name. Template literals are kept only for their
    ${...} expressions, which are real code.
    """
    s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
    s = re.sub(r'//.*$', '', s, flags=re.M)
    out, i, n = [], 0, len(s)
    quote, tpl_depth = None, []
    while i < n:
        c = s[i]
        if quote is None:
            if c in ('"', "'", '`'):
                quote = c
                if c == '`':
                    tpl_depth.append(0)
                out.append(' ')
            else:
                out.append(c)
            i += 1
            continue
        # inside a string
        if c == '\\':
            i += 2; continue
        if quote == '`' and c == '$' and i + 1 < n and s[i+1] == '{':
            # step back into code for the interpolation
            depth, j = 1, i + 2
            while j < n and depth:
                if s[j] == '{': depth += 1
                elif s[j] == '}': depth -= 1
                j += 1
            out.append(' ' + strip(s[i+2:j-1]) + ' ')
            i = j; continue
        if c == quote:
            quote = None
            if c == '`' and tpl_depth: tpl_depth.pop()
        i += 1
    return ''.join(out)

def exports(p):
    """Names a module makes available: direct declarations and re-exports
    (export { a, b } from './x.js'), which a barrel file uses."""
    s = open(p).read()
    e = set(re.findall(r'^export\s+(?:async\s+)?(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)', s, re.M))
    for m in re.finditer(r'^export\s*\{([^}]*)\}', s, re.M):
        e |= {n.strip().split(' as ')[-1].strip() for n in m.group(1).split(',') if n.strip()}
    return e

def declared(body):
    """Every binding introduced anywhere in the file: declarations at any depth,
    plus function/arrow/catch parameters, which are what made a naive version of
    this check report hundreds of false positives."""
    d  = set(re.findall(r'(?:^|\s)(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)', body))
    d |= set(re.findall(r'(?:^|\s)(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)', body))
    d |= set(re.findall(r'catch\s*\(\s*([A-Za-z_$][\w$]*)', body))
    d |= set(re.findall(r'(?<![.\w$])([A-Za-z_$][\w$]*)\s*=>', body))          # x => ...
    # Parameter lists only. Matching any '(...)  {' would treat `if (state.x) {`
    # as a parameter list and silently mark `state` as bound, which hides real
    # missing imports - that bug shipped a broken host tab.
    for pat in (r'function\s*[A-Za-z_$][\w$]*\s*\(([^()]*)\)',
                r'function\s*\(([^()]*)\)',
                r'\(([^()]*)\)\s*=>'):
        for m in re.finditer(pat, body):
            for part in m.group(1).split(','):
                d |= set(re.findall(r'[A-Za-z_$][\w$]*', part))
    return d

def top_level(body):
    """Only bindings at column 0 - these are the ones another module could
    plausibly be reaching for."""
    d  = set(re.findall(r'^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)', body, re.M))
    d |= set(re.findall(r'^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)', body, re.M))
    return d

owner = {}
for f in FILES:
    for n in top_level(strip(open(f).read())):
        owner.setdefault(n, f)

problems = []
for f in FILES:
    raw = open(f).read()
    if raw.startswith('/*') and re.search(r'^import ', raw[:raw.index('*/')], flags=re.M):
        problems.append(f'{f}: import statements are inside the header comment (they do nothing)')
    imported = set()
    for m in re.finditer(r"import\s*\{([^}]*)\}\s*from\s*'([^']+)'", raw):
        names = {n.strip() for n in m.group(1).split(',') if n.strip()}
        imported |= names
        tgt = os.path.normpath(os.path.join(os.path.dirname(f), m.group(2)))
        if not os.path.exists(tgt):
            problems.append(f'{f}: imports from missing module {m.group(2)}')
            continue
        for n in sorted(names - exports(tgt)):
            problems.append(f'{f}: imports {n} which {m.group(2)} does not export')
    body = re.sub(r'^export\s*\{[^}]*\}\s*from\s*\'[^\']+\';?$', '', raw, flags=re.M)
    body = strip(re.sub(r'^import .*$', '', body, flags=re.M))
    local = declared(body)
    used  = set(re.findall(r'(?<![.\w$])([A-Za-z_$][\w$]*)', body))
    for n in sorted(used - local - imported):
        if n in owner and owner[n] != f:
            problems.append(f'{f}: uses {n}, which is declared in {owner[n]} and not imported')

# 4. Inline handlers resolve in global scope at runtime, not through imports,
#    so every name called from an on*="..." attribute must appear in main.js's
#    window barrel. This is the failure mode that ships a dead button.
barrel = open('src/main.js').read()
handler_names = set()
for f in FILES:
    for m in re.finditer(r'on(?:click|change|input|keydown|blur)="([A-Za-z_$][\w$]*)\(', open(f).read()):
        handler_names.add((m.group(1), f))
for name, f in sorted(handler_names):
    if name in ('if', 'this'):
        continue
    if not re.search(r'\b' + re.escape(name) + r'\b', barrel):
        problems.append(f'{f}: onclick calls {name}, which main.js never puts on window')

# 5. CSS custom properties. A var() naming something undefined does not error;
#    the declaration is simply dropped, so text keeps its inherited colour. That
#    is how .tv-level-badge shipped as 14px dark brown on a dark maroon stage.
#    var(--x, fallback) is fine by definition, so those are skipped.
css_files = sorted(glob.glob('styles/*.css'))
if css_files:
    defined = set()
    for f in css_files + (['index.html'] if os.path.exists('index.html') else []):
        defined |= set(re.findall(r'(--[a-zA-Z0-9-]+)\s*:', open(f).read()))
    for f in css_files:
        for m in re.finditer(r'var\(\s*(--[a-zA-Z0-9-]+)\s*([,)])', open(f).read()):
            if m.group(2) == ',':
                continue  # has a fallback
            if m.group(1) not in defined:
                problems.append(f'{f}: uses {m.group(1)}, which no stylesheet defines')

for p in problems:
    print('  ' + p)
print(f'{len(problems)} problem(s)')
sys.exit(1 if problems else 0)
