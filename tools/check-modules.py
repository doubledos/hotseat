#!/usr/bin/env python3
"""Static checks for the module split.

Catches the three failure modes that syntax checks do not:
  1. an identifier used in one module but declared (unexported) in another
  2. an import that the target module does not actually export
  3. import statements buried inside a leading block comment, which parse
     fine and silently do nothing
"""
import re, glob, os, sys

FILES = ['src/main.js'] + sorted(f for f in glob.glob('src/**/*.js', recursive=True) if f != 'src/main.js')

def strip(s):
    s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
    return re.sub(r'//.*$', '', s, flags=re.M)

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

for p in problems:
    print('  ' + p)
print(f'{len(problems)} problem(s)')
sys.exit(1 if problems else 0)
