"""Extract the game's trophy display order, or apply the checked-in snapshot.

Usage: python scripts/trophy-order.py [path/to/master.mdb]
Only the 155 trophies already in the CN catalog are retained. The public JP
master data uses 9046/9047/9048 for the three overseas trophies; the catalog
uses its existing stable IDs 1201/2201/2202 so old progress remains valid.
"""
import hashlib
import json
from pathlib import Path
import sqlite3
import sys

root = Path(__file__).resolve().parent.parent
catalog_path = root / 'app/public/catalog.json'
snapshot_path = root / 'app/public/trophy-order.json'
catalog = json.loads(catalog_path.read_text(encoding='utf8'))
if len(sys.argv) > 1:
    database = Path(sys.argv[1]).resolve()
    with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True) as connection:
        rows = connection.execute(
            'SELECT trophy_id, MIN(disp_order) FROM race_trophy GROUP BY trophy_id'
        ).fetchall()
    orders = {str(trophy): order for trophy, order in rows}
    aliases = {'1201': '9046', '2201': '9047', '2202': '9048'}
    snapshot = {
        'source': 'https://github.com/SimpleSandman/UmaMusumeMetaMasterMDB/blob/master/master/master.mdb',
        'field': 'race_trophy.disp_order',
        'sha256': hashlib.sha256(database.read_bytes()).hexdigest(),
        'orders': {r['id']: orders[aliases.get(r['id'], r['id'])] for r in catalog['races']},
    }
    snapshot_path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
else:
    snapshot = json.loads(snapshot_path.read_text(encoding='utf8'))
for race in catalog['races']:
    race['trophyOrder'] = snapshot['orders'][race['id']]
catalog['races'].sort(key=lambda r: r['trophyOrder'])
catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
print('Applied game trophy display order:', len(catalog['races']))
