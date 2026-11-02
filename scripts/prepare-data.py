"""Build the offline catalog from the reviewed 2026-11-02 public snapshots."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from html import unescape
import urllib.request, re, json, time, sys

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'app/public'
CACHE = ROOT / 'outputs/character-research/goals'
OUT.mkdir(parents=True, exist_ok=True)
CACHE.mkdir(parents=True, exist_ok=True)
def read(p): return json.loads((ROOT / p).read_text(encoding='utf8'))
def fetch(url, dest):
    if dest.exists() and dest.stat().st_size > 100: return dest.read_bytes()
    for retry in range(4):
        try:
            req=urllib.request.Request(url, headers={'User-Agent':'Mozilla/5.0 (offline fan planner; public data)'})
            data=urllib.request.urlopen(req, timeout=45).read()
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
            return data
        except Exception:
            if retry==3: raise
            time.sleep(1+retry)
def clean(s): return re.sub(r'\s+', ' ', unescape(re.sub('<[^>]+>', '', s))).strip()
roster=read('outputs/syyjsn-20261102/已实装马娘数据.json')
race_data=read('outputs/syyjsn-20261102/赛事数据.json')
tables=read('outputs/character-research/tables.json')
cards={}
for row in tables['cn_gallery']+tables['jp_gallery']:
    if len(row['cells'])!=18: continue
    m=next((re.search(r'Chr icon (\d+) (\d+)',i.get('alt','')) for i in row['images'] if re.search(r'Chr icon (\d+) (\d+)',i.get('alt',''))),None)
    if not m or m[2] in cards: continue
    cards[m[2]]={'id':m[2], 'characterId':m[1], 'name':row['cells'][1], 'source':'https://wiki.biligame.com'+row['links'][0]['href']}
implemented={c['card_id'] for c in roster['characters']}
for row in tables['cn_gacha']:
    if row['heading']!='已实装卡池' or '赛马娘卡池' not in row['cells']: continue
    dates=re.findall(r'20\d\d/\d\d/\d\d', row['cells'][0])
    if dates and min(dates)>'2026/11/02': continue
    for i in row['images']:
        m=re.search(r'Chr icon (\d+) (\d+)',i.get('alt',''))
        if m: implemented.add(m[2])
# Story reward Special Week and the two announced 2026-10-29 Christmas outfits.
implemented.add('100103')
for row in tables['jp_gallery']:
    if len(row['cells'])!=18 or not any(n in row['cells'][1] for n in ('赤心のトナカイ','清らに星澄む')):continue
    for img in row['images']:
        m=re.search(r'Chr icon (\d+) (\d+)',img.get('alt',''))
        if m:implemented.add(m[2])
ids={c['id'] for c in roster['characters']}
routes=[c for id,c in sorted(cards.items()) if id in implemented and c['characterId'] in ids]

def goal_data(route):
    data=fetch(route['source'], CACHE/(route['id']+'.html')).decode('utf8')
    idx=data.find('培育目标</div>')
    if idx<0: idx=data.find('育成目標</div>')
    if idx<0: raise ValueError('No goal section: '+route['id'])
    table=data[idx:].split('</table>',1)[0]
    goals=[]; current=None
    for attrs,row in re.findall(r'<tr\b([^>]*)>(.*?)</tr>',table,re.S):
        if re.search(r'display\s*:\s*none',attrs):continue
        cells=[clean(x) for x in re.findall(r'<t[hd]\b[^>]*>(.*?)</t[hd]>',row,re.S)]
        if not cells: continue
        title=re.match(r'(?:目标|目標)(\d+)[：:]\s*(.*)',cells[0])
        if title:
            current={'title':title[2],'number':int(title[1])}; goals.append(current)
        elif current and len(cells)>1:
            if cells[0] in ('时间','時期','時限','期限'): current['time']=cells[1]
            if cells[0]=='条件': current['condition']=cells[1]
    result=[]
    for g in goals:
        match=re.search(r'第(\d)年\s*(\d+)月\s*(前半|后半|後半)',g.get('time',''))
        if not match: continue
        y,m,h=match.groups(); slot=(int(y)-1)*24+(int(m)-1)*2+(h!='前半')
        title=g['title']
        if not title and route['characterId']=='1046' and g['number']==2:
            title='在 Pre-OP 以上赛事中获得 2 次第1名'
            g['title']=title
            g['correctionSource']='https://gametora.com/ja/umamusume/characters/104601-smart-falcon'
        if not title:raise ValueError('Visible goal has no title: '+route['id'])
        deadline=bool(re.search(r'粉[丝絲]|ファン|在[一二三]级赛事中\d+次|Pre-OP.*次',title))
        if re.search(r'初级新人|メイクデビュー|ジュニア級メイクデビュー',title): kind='debut'
        elif deadline: kind='deadline'
        else: kind='race'
        # Preserve branches verbatim. Only exact race-name matching grants a trophy link.
        norm=lambda s:re.sub(r'锦标(?:赛)?|[\s（）()・·]', '',s).replace('ステークス','S')
        goal_race=re.sub(r'^参加\s*','',re.split(r'\s*中(?:进入|获得)',title)[0])
        matches=[r['id'] for r in race_data['races'] if any(norm(n)==norm(goal_race) for n in [r['name'],r['jp']]) and any((p['year']-1)*24+(p['month']-1)*2+(p['half']!='前半')==slot for p in r['periods'])]
        result.append({**g,'slot':slot,'kind':kind,'raceIds':matches if kind=='race' else []})
    if len(result)<5: raise ValueError(f'Incomplete goals: {route["id"]} ({len(result)})')
    if route['characterId']=='1009':
        g=next(g for g in result if g['slot']==33)
        g['raceIds']=[r['id'] for n in ('奥克斯','全国德比') for r in race_data['races'] if r['name']==n]
        g['title']='奥克斯 / 全国德比 中进入前5（选择其一）'
        g['branchSource']='https://gamerch.com/umamusume/231593'
    if route['characterId']=='1093':
        # The source template exposes the canceled race, a hidden empty alternative,
        # and only twelve slots. The final senior Sprint is verified separately.
        g=next(g for g in result if g['slot']==41)
        g.update(title='强制休息（短途者锦标赛出走中止）',kind='rest',raceIds=[])
        result.append({'title':'短途者锦标赛 中获得第1名','slot':65,'kind':'race','raceIds':['1013'],'correctionSource':'https://gametora.com/ja/umamusume/characters/ksmiracle'})
    if route['characterId']=='1062':
        g=next(g for g in result if g['slot']==69)
        g.update(title='固定休息（全国杯因剧情取消参赛）',kind='rest',raceIds=[])
        g['correctionSource']='https://wikiwiki.jp/vip_umamusu/マチカネタンホイザ【ぱんぱかティルトット】'
    branches=[]
    def race_goal(jp,year,requirement):
        r=next(r for r in race_data['races'] if r['jp']==jp or r['name']==jp)
        p=next(p for p in r['periods'] if p['year']==year)
        return {'title':r['name']+' '+requirement,'slot':(year-1)*24+(p['month']-1)*2+(p['half']!='前半'),'kind':'race','raceIds':[r['id']],'condition':f'参赛粉丝数 {r["fans"]} 人以上'}
    def group(key,label,remove,options,default=0,note='按游戏中的目标选择分支'):
        choices=[{'id':goals[0]['raceIds'][0],'label':name,'goals':goals} for name,goals in options]
        branches.append({'key':str(key),'label':label,'removeSlots':remove,'options':choices,'defaultChoice':choices[default]['id'],'note':note})
    cid=route['characterId']
    if cid=='1005':
        group(33,'经典 / 英里路线',[33,45],[('经典三冠路线',[race_goal('全国德比',2,'中进入前5'),race_goal('菊花奖',2,'出赛')]),('英里路线',[race_goal('NHKマイルカップ',2,'中进入前5'),race_goal('マイルチャンピオンシップ',2,'中进入前3')])],1)
    if cid=='1032':
        group(33,'皋月奖后目标分支',[33],[('状态好：全国德比',[race_goal('全国德比',2,'中进入前5')]),('状态普通或以下：英里杯',[race_goal('NHKマイルカップ',2,'中进入前5')])],note='根据皋月奖后的干劲状态确认实际目标')
    if cid=='1022':
        group(71,'最终目标赛事',[71],[(n,[race_goal(n,3,'中获得第1名')]) for n in ['天王奖（秋）','伊丽莎白女王杯','英里冠军赛','中山大奖赛']],3)
    if cid=='1031':
        group(71,'最终目标赛事',[71],[('全国杯（通常路线）',[race_goal('全国杯',3,'中获得第1名')]),('中山大奖赛（需满足剧情条件）',[race_goal('中山大奖赛',3,'中获得第1名')])],note='选择中山大奖赛需要先满足游戏内经典级中山大奖赛胜利等剧情条件')
    if cid=='1069':
        group(59,'高级年中目标',[59],[(n,[race_goal(n,3,'中进入前3')]) for n in ['宝冢纪念','东京英里赛']])
    if cid=='1071':
        group(43,'经典年秋季路线',[43],[('天王奖（秋）',[race_goal('天王奖（秋）',2,'中进入前3')]),('菊花奖',[race_goal('菊花奖',2,'出赛')])])
    if cid=='1056':
        group(28,'经典年春季随机目标',[28],[(n,[race_goal(n,2,'中进入前5')]) for n in ['弥生奖','スプリングステークス','毎日杯']],note='随机目标：按游戏实际抽到的赛事设置')
        group(62,'高级年夏秋随机目标',[62],[(n,[race_goal(n,3,'中进入前2')]) for n in ['小仓纪念','函館記念','札幌記念','京都大賞典','毎日王冠']],note='随机目标：按游戏实际抽到的赛事设置')
    return {**route,'goals':result,'branches':branches}

errors=[]; completed=[]
with ThreadPoolExecutor(max_workers=8) as ex:
    fut={ex.submit(goal_data,r):r for r in routes}
    for f in as_completed(fut):
        try: completed.append(f.result())
        except Exception as e: errors.append({'route':fut[f], 'error':str(e)})
print('Routes',len(completed),'errors',len(errors),flush=True)
(CACHE/'errors.json').write_text(json.dumps(errors,ensure_ascii=False,indent=2),encoding='utf8')

jobs=[]
for c in roster['characters']:
    dest=OUT/'assets/characters'/f'{c["id"]}.png'; jobs.append((c['image'],dest))
    c['portrait']=f'./assets/characters/{c["id"]}.png'
for r in race_data['races']:
    dest=OUT/'assets/trophies'/f'{r["id"]}.png'; jobs.append((r['image'],dest))
    r['trophy']=f'./assets/trophies/{r["id"]}.png'
banner={}
for row in read('outputs/race-research/tables.json')['jp']:
    for img in row['images']:
        m=re.search(r'Thum race rt \d+ (\d+)',img.get('alt',''))
        if m: banner[m[1]]=img['src']
for r in race_data['races']:
    if r['id'] in banner:
        jobs.append((banner[r['id']], OUT/'assets/races'/f'{r["id"]}.png'))
        r['banner']=f'./assets/races/{r["id"]}.png'
asset_errors=[]
with ThreadPoolExecutor(max_workers=10) as ex:
    futures={ex.submit(fetch,u,p):(u,p) for u,p in jobs}
    for f in as_completed(futures):
        try:
            data=f.result()
            if not data.startswith((b'\x89PNG',b'\xff\xd8',b'GIF8',b'RIFF')): raise ValueError('Invalid image')
        except Exception as e: asset_errors.append((str(futures[f][1]),str(e)))
print('Assets',len(jobs)-len(asset_errors),'errors',len(asset_errors),asset_errors,flush=True)
trophy_orders=json.loads((OUT/'trophy-order.json').read_text(encoding='utf8'))['orders']
for r in race_data['races']: r['trophyOrder']=trophy_orders[r['id']]
race_data['races'].sort(key=lambda r:r['trophyOrder'])
catalog={'asOf':roster['as_of'],'characters':roster['characters'],'races':race_data['races'],'routes':sorted(completed,key=lambda r:r['id']), 'variants':race_data['variants'], 'sources':roster['sources']+race_data['sources'], 'notes':race_data['notes'], 'coverage':{'routes':len(completed),'failedRoutes':errors,'assets':len(jobs),'failedAssets':asset_errors}}
(OUT/'catalog.json').write_text(json.dumps(catalog,ensure_ascii=False,separators=(',',':')),encoding='utf8')
print('Catalog written',flush=True)
if errors or asset_errors: sys.exit(2)
