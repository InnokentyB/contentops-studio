import sys,tempfile,pathlib,json,hashlib,unittest,datetime
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'ops/egress'))
from backup_policy import reusable_backup
class Backup(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name)
  self.now=datetime.datetime(2026,11,6,tzinfo=datetime.timezone.utc)
  self.name='contentops-production-20261105T230000Z.dump'
  (self.root/self.name).write_bytes(b'synthetic')
  self.receipt={'file':self.name,'sha256':hashlib.sha256(b'synthetic').hexdigest(),'completed_at':'2026-11-05T23:00:00+00:00','binding_sha256':'binding','schema_fingerprint':'schema'}
  self.save();self.restore()
 def tearDown(self):self.tmp.cleanup()
 def save(self):(self.root/'backup.receipt.json').write_text(json.dumps(self.receipt))
 def restore(self,**kw):
  x={'status':'RESTORE_VERIFIED','archive':self.name,'sha256':self.receipt['sha256'],'invalid_constraints':0};x.update(kw)
  (self.root/'restore.receipt.json').write_text(json.dumps(x))
 def choose(self):return reusable_backup(self.root,'binding','schema',self.now)
 def test_reuse(self):self.assertEqual(self.choose()['file'],self.name)
 def test_old(self):
  self.receipt['completed_at']='2026-11-04T23:00:00+00:00';self.save();self.assertIsNone(self.choose())
 def test_missing_restore(self):
  (self.root/'restore.receipt.json').unlink();self.assertIsNone(self.choose())
 def test_corruption(self):
  (self.root/self.name).write_bytes(b'bad');self.assertIsNone(self.choose())
 def test_binding_schema_future(self):
  for k,v in [('binding_sha256','wrong'),('schema_fingerprint','wrong'),('completed_at','2026-11-07T00:00:00+00:00')]:
   old=self.receipt[k];self.receipt[k]=v;self.save();self.assertIsNone(self.choose());self.receipt[k]=old
 def test_failed_restore(self):self.restore(invalid_constraints=1);self.assertIsNone(self.choose())
 def test_no_path_escape(self):self.receipt['file']='../private.dump';self.save();self.assertIsNone(self.choose())

class Driver(unittest.TestCase):
 def test_driver_reuses_verified_archive_without_invoking_pg_dump(self):
  import subprocess,os
  with tempfile.TemporaryDirectory() as folder:
   root=pathlib.Path(folder);bin_dir=root/'bin';bin_dir.mkdir();backups=root/'backups';backups.mkdir()
   driver=pathlib.Path(__file__).resolve().parents[2]/'ops/egress/backup_database.py'
   uri='postgresql://synthetic:synthetic@db:5432/synthetic'
   binding=hashlib.sha256(json.dumps(['db',5432,'/synthetic','synthetic']).encode()).hexdigest()
   name='contentops-production-20261106T000000Z.dump';(backups/name).write_bytes(b'test')
   sha=hashlib.sha256(b'test').hexdigest()
   (backups/'a.receipt.json').write_text(json.dumps({'file':name,'sha256':sha,'binding_sha256':binding,'schema_fingerprint':hashlib.sha256(b'shape:shape').hexdigest(),'completed_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}))
   (backups/'r.receipt.json').write_text(json.dumps({'status':'RESTORE_VERIFIED','archive':name,'sha256':sha,'invalid_constraints':0}))
   scripts={'railway': 'import json; print(json.dumps({"DATABASE_URL":"'+uri+'"}))',
    'psql': 'import sys,json; print(json.dumps({"database_bytes":100,"planner_tables":1,"migration_ledgers":["public._prisma_migrations"]}) if "json_build_object" in sys.argv[-1] else "shape")',
    'pg_dump': 'raise SystemExit("UNEXPECTED_FULL_DUMP")'}
   for name,body in scripts.items():
    path=bin_dir/name;path.write_text('#!/usr/bin/env python3\n'+body+'\n');path.chmod(0o755)
   env={**os.environ,'PATH':str(bin_dir)+os.pathsep+os.environ['PATH'],'CONTENTOPS_BACKUP_DIRECTORY':str(backups),'PYTHONDONTWRITEBYTECODE':'1'}
   probe=subprocess.run([str(bin_dir/"railway")],env=env,capture_output=True,text=True)
   self.assertEqual(probe.returncode,0,probe.stderr)
   result=subprocess.run([sys.executable,str(driver),'--backup','--code-only'],env=env,capture_output=True,text=True)
   self.assertEqual(result.returncode,0,result.stderr+result.stdout)
   self.assertEqual(json.loads(result.stdout.splitlines()[-1])['status'],'verified_backup_reused')
   unclassified=subprocess.run([sys.executable,str(driver),'--backup'],env=env,capture_output=True,text=True)
   self.assertNotEqual(unclassified.returncode,0);self.assertIn('BACKUP_CLASSIFICATION_REQUIRED',unclassified.stderr)
   import fcntl
   with (backups/'.contentops-backup.lock').open('a') as lock:
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    blocked=subprocess.run([sys.executable,str(driver),'--backup','--code-only'],env=env,capture_output=True,text=True)
    self.assertNotEqual(blocked.returncode,0);self.assertIn('BACKUP_ALREADY_RUNNING',blocked.stderr)

if __name__=='__main__':unittest.main()
