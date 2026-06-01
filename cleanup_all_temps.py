import os

files = [
    '/c:/Projects/NextJs/hub-stock-ai/close_temps.py',
    '/c:/Projects/NextJs/hub-stock-ai/cleanup_temp_files.py',
    '/c:/Projects/NextJs/hub-stock-ai/src/scripts/test-jumbo-parser.js',
    '/c:/Projects/NextJs/hub-stock-ai/src/scripts/measure-jumbo-pages.ts',
    '/c:/Projects/NextJs/hub-stock-ai/cleanup2.py',
    '/c:/Projects/NextJs/hub-stock-ai/cleanup.py',
    '/c:/Projects/NextJs/hub-stock-ai/tmp_revert_jumbo.py',
    '/c:/Projects/NextJs/hub-stock-ai/tmp_fix_jumbo.py',
    '/c:/Projects/NextJs/hub-stock-ai/test_jumbo_find_correct.js',
    '/c:/Projects/NextJs/hub-stock-ai/test_jumbo_urls.js',
    '/c:/Projects/NextJs/hub-stock-ai/fix_stuck_runs.sql',
    '/c:/Projects/NextJs/hub-stock-ai/tmp_fix.py',
    '/c:/Projects/NextJs/hub-stock-ai/tmp_edit.py',
]

for f in files:
    if os.path.exists(f):
        os.remove(f)
        print(f'Removed: {f}')
    else:
        print(f'Not found: {f}')

# Self-destruct
self = '/c:/Projects/NextJs/hub-stock-ai/cleanup_all_temps.py'
if os.path.exists(self):
    os.remove(self)
    print('Self-removed')
