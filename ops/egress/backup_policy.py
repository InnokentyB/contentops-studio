"""Select a locally verified archive; never query or mutate a database."""
import datetime
import hashlib
import json
import pathlib
import re

def reusable_backup(root, binding, schema, now):
    receipts=[]
    for path in sorted(root.glob('*.receipt.json')):
        try:
            row=json.loads(path.read_text())
        except (ValueError,OSError):
            continue  # A corrupt receipt cannot authorize reuse.
        if isinstance(row,dict):
            receipts.append(row)
    candidates=[]
    for row in receipts:
        name=row.get('file','')
        if not isinstance(name,str) or not re.fullmatch(r'contentops-production-[0-9]{8}T[0-9]{6}Z\.dump',name):
            continue
        if row.get('binding_sha256')!=binding or row.get('schema_fingerprint')!=schema:
            continue
        try:
            stamp=datetime.datetime.fromisoformat(row['completed_at'])
            age=(now-stamp).total_seconds()
        except (KeyError,ValueError,TypeError):
            continue
        if not 0<=age<86400:
            continue
        if not any(r.get('status')=='RESTORE_VERIFIED' and r.get('archive')==name
                   and r.get('sha256')==row.get('sha256') and r.get('invalid_constraints')==0 for r in receipts):
            continue
        path=root/name
        if path.is_symlink() or not path.is_file():
            continue
        digest=hashlib.sha256()
        with path.open('rb') as stream:
            for block in iter(lambda:stream.read(1048576),b''):
                digest.update(block)
        if digest.hexdigest()!=row.get('sha256'):
            continue
        candidates.append((stamp,row))
    return max(candidates,key=lambda item:item[0])[1] if candidates else None
