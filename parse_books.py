#!/usr/bin/env python3
"""Parse real Project Gutenberg books into chaptered JSON for the War Room library."""
import json, re, os

RAW = '/home/user/webapp/books_raw'
OUT = '/home/user/webapp/public/static/books'
os.makedirs(OUT, exist_ok=True)

def strip_gutenberg(text):
    start = re.search(r'\*\*\* START OF (THE|THIS) PROJECT GUTENBERG EBOOK.*?\*\*\*', text, re.I)
    end = re.search(r'\*\*\* END OF (THE|THIS) PROJECT GUTENBERG EBOOK.*?\*\*\*', text, re.I)
    s = start.end() if start else 0
    e = end.start() if end else len(text)
    return text[s:e].replace('\r\n', '\n').strip()

def read(fname):
    with open(os.path.join(RAW, fname), encoding='utf-8', errors='replace') as f:
        return strip_gutenberg(f.read())

def clean_paras(chunk):
    """Collapse to paragraphs."""
    paras = [re.sub(r'\s+', ' ', p).strip() for p in re.split(r'\n\s*\n', chunk)]
    return [p for p in paras if p]

def save(book_id, title, author, translator, chapters, note=''):
    data = {'id': book_id, 'title': title, 'author': author, 'translator': translator,
            'note': note, 'chapters': [{'title': t, 'paras': clean_paras(c)} for t, c in chapters if clean_paras(c)]}
    with open(f'{OUT}/{book_id}.json', 'w') as f:
        json.dump(data, f)
    total = sum(len(ch['paras']) for ch in data['chapters'])
    print(f"{book_id}: {len(data['chapters'])} chapters, {total} paragraphs")

def split_by(text, pattern, title_fmt=None):
    """Split text by regex heading pattern; returns [(title, body)]."""
    matches = list(re.finditer(pattern, text, re.M))
    out = []
    for i, m in enumerate(matches):
        body = text[m.end(): matches[i+1].start() if i+1 < len(matches) else len(text)]
        title = title_fmt(m) if title_fmt else re.sub(r'\s+', ' ', m.group(0)).strip()
        out.append((title, body))
    return out

# ===== 1. THE ART OF WAR (Lionel Giles) =====
t = read('art_of_war.txt')
chs = split_by(t, r'^Chapter [IVX]+\.\s+.+$')
chs = [(ti, b) for ti, b in chs if len(b) > 1500][:13]
save('art_of_war', 'The Art of War', 'Sun Tzu', 'Lionel Giles (1910)', chs)

# ===== 2. THE PRINCE (Marriott) =====
t = read('the_prince.txt')
chs = split_by(t, r'^CHAPTER [IVXL]+.*$')
# drop front matter chapters that are actually the dedication etc: keep those with substantial body
chs = [(ti, b) for ti, b in chs if len(b) > 200]
save('the_prince', 'The Prince', 'Niccolò Machiavelli', 'W. K. Marriott (1908)', chs)

# ===== 3. DISCOURSES ON LIVY (Thomson) =====
t = read('discourses_livy.txt')
chs = split_by(t, r'^CHAPTER [IVXL]+\.?.*$')
chs = [(ti, b) for ti, b in chs if len(b) > 500]
save('discourses', 'Discourses on the First Decade of Titus Livius', 'Niccolò Machiavelli', 'N. H. Thomson (1883)', chs)

# ===== 4. MEDITATIONS (Long) =====
t = read('meditations.txt')
chs = split_by(t, r'^(?:THE )?(?:FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|NINTH|TENTH|ELEVENTH|TWELFTH) BOOK$')
if len(chs) < 10:
    chs = split_by(t, r'^BOOK (?:THE )?[IVX]+.*$|^(?:THE )?\w+ BOOK$')
chs = [(ti, b) for ti, b in chs if len(b) > 2000]
save('meditations', 'Meditations', 'Marcus Aurelius', 'George Long (1862)', chs)

# ===== 5. ENCHIRIDION (Epictetus) =====
t = read('enchiridion.txt')
# split by numbered sections; fallback: whole as one
chs = split_by(t, r'^[IVXL]+\.?$|^CHAPTER [IVXL]+.*$')
if len(chs) < 5:
    # keep as sections of ~40 paragraphs
    paras = re.split(r'\n\s*\n', t)
    group, chs = 40, []
    for i in range(0, len(paras), group):
        chs.append((f'Sections {i//group + 1}', '\n\n'.join(paras[i:i+group])))
save('enchiridion', 'The Enchiridion', 'Epictetus', 'T. W. Higginson (1890)', chs)

# ===== 6. APOLOGY (Jowett) =====
t = read('apology.txt')
paras = re.split(r'\n\s*\n', t)
n = max(1, len(paras)//4)
chs = [(f'Part {i+1}', '\n\n'.join(paras[i*n:(i+1)*n])) for i in range(4)]
save('apology', 'Apology (The Trial of Socrates)', 'Plato', 'Benjamin Jowett (1892)', chs)

# ===== 7. CRITO (Jowett) =====
t = read('crito.txt')
paras = re.split(r'\n\s*\n', t)
n = max(1, len(paras)//3)
chs = [(f'Part {i+1}', '\n\n'.join(paras[i*n:(i+1)*n])) for i in range(3)]
save('crito', 'Crito', 'Plato', 'Benjamin Jowett (1892)', chs)

# ===== 8. THE REPUBLIC Books 1-4 (Jowett) =====
t = read('republic.txt')
matches = list(re.finditer(r'^BOOK ([IVX]+)\.', t, re.M))
chs = []
for i, m in enumerate(matches):
    body = t[m.end(): matches[i+1].start() if i+1 < len(matches) else len(t)]
    chs.append(('Book ' + m.group(1), body))
chs = [(ti, b) for ti, b in chs if len(b) > 5000][:4]
save('republic', 'The Republic (Books I-IV)', 'Plato', 'Benjamin Jowett (1892)', chs,
     note='Curriculum covers Books I-IV: the Ring of Gyges, the tripartite soul, justice as inner order.')

# ===== 9. THUS SPAKE ZARATHUSTRA Part 1 (Common) =====
t = read('zarathustra.txt')
chs = split_by(t, r'^[IVXL]+\.\s+.+$|^(?:ZARATHUSTRA\'S )?PROLOGUE\.?$')
if len(chs) < 5:
    chs = split_by(t, r'^\s*(?:[0-9IVXL]+\.)?\s*(?:THE|OF|ON)\s+[A-Z][A-Z \-,\']+\.?$')
chs = [(ti, b) for ti, b in chs if len(b) > 1500][:25]  # Prologue + Part 1
save('zarathustra', 'Thus Spake Zarathustra (Prologue & Part I)', 'Friedrich Nietzsche', 'Thomas Common (1909)', chs)

# ===== 10. BEYOND GOOD AND EVIL (Zimmern) =====
t = read('beyond_good_evil.txt')
chs = split_by(t, r'^CHAPTER [IVXL]+\..*$|^PREFACE$')
chs = [(ti, b) for ti, b in chs if len(b) > 2000]
save('beyond_good_evil', 'Beyond Good and Evil', 'Friedrich Nietzsche', 'Helen Zimmern (1906)', chs)

# ===== 11. ON WAR Book 1 + friction (Graham) =====
t = read('on_war.txt')
chs = split_by(t, r'^CHAPTER [IVXL]+\.?.*$')
chs = [(ti, b) for ti, b in chs if len(b) > 3000][:12]
save('on_war', 'On War (Book I selections)', 'Carl von Clausewitz', 'J. J. Graham (1873)', chs,
     note='Curriculum selections: Book 1 Ch.1 (What is War) and the friction chapters.')

print('DONE')
