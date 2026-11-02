from pathlib import Path
from html import unescape
import json,re,sys
sys.stdout.reconfigure(encoding='utf8')
root=Path(__file__).resolve().parent.parent
d=json.loads((root/'app/public/catalog.json').read_text(encoding='utf8'))
out=[]
for r in d['routes']:
    s=(root/'outputs/character-research/goals'/f'{r["id"]}.html').read_text(encoding='utf8')
    s=s[s.index('培育目标</div>'):].split('</table>')[0]
    blanks=re.findall(r'<tr(?![^>]*display:none)[^>]*>\s*<th colspan="2">目标(\d+)：\s*</th>',s)
    if blanks:out.append((r['id'],r['name'],blanks))
print('Blank visible goal titles:',json.dumps(out,ensure_ascii=False,indent=2))
tables=json.loads((root/'outputs/character-research/tables.json').read_text(encoding='utf8'))
for row in tables['jp_gallery']:
    if any('Chr icon 1046 104601' in i.get('alt','') for i in row['images']):print('Falcon JP',row['links'][0]['href'])
