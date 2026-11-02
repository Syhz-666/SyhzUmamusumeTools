"""Create a small, self-contained source archive, including offline resources."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root=Path(__file__).resolve().parent.parent
files=[]
for item in ['main.cjs','preload.cjs','store.cjs','package.json','package-lock.json','.gitignore','.prettierrc.json','README.md','DATA-SOURCES.md','VERIFICATION.md','ISSUES.md']:
    p=root/item
    if p.exists():files.append(p)
for folder in ['app/src','app/public','build','scripts','tests']:
    files.extend(p for p in (root/folder).rglob('*') if p.is_file() and '__pycache__' not in p.parts)
files.extend(root/p for p in ['app/index.html','app/tsconfig.json','app/vite.config.mts'])
files.extend(root/p for p in ['outputs/character-research/tables.json','outputs/race-research/tables.json','outputs/syyjsn-20261102/赛事数据.json','outputs/syyjsn-20261102/已实装马娘数据.json'])
import json
version=json.loads((root/'package.json').read_text(encoding='utf8'))['version']
dest=root/f'release/SyhzUmamusumeTools-{version}-source.zip'
dest.parent.mkdir(exist_ok=True)
with ZipFile(dest,'w',ZIP_DEFLATED,compresslevel=6) as z:
    for p in sorted(set(files)):z.write(p,Path('SyhzUmamusumeTools')/p.relative_to(root))
print(f'Source archive: {len(set(files))} files, {dest.stat().st_size} bytes')
