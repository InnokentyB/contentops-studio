"""Read-only database backup administration; never persist connection secrets."""
import fcntl
from backup_policy import reusable_backup
import datetime
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys
from urllib.parse import unquote, urlsplit


def checked(command, env=None):
    result = subprocess.run(command, env=env, capture_output=True, text=True)
    if result.returncode:
        reason = "unclassified_failure"
        for marker, safe in (("password authentication failed", "authentication_failed"),
                             ("Permission denied", "filesystem_permission_denied"),
                             ("permission denied", "database_permission_denied"),
                             ("server version", "client_server_version_mismatch"),
                             ("could not connect", "connection_unavailable"),
                             ("could not translate", "dns_unavailable")):
            if marker in result.stderr:
                reason = safe
                break
        raise SystemExit(json.dumps({"status": "failed", "operation": command[0],
                                     "cause": reason, "raw_output_withheld": True}))
    return result.stdout


def service_values(service):
    return json.loads(checked(["railway", "variables", "--service", service,
                               "--environment", "production", "--json"]))


root = pathlib.Path(os.environ.get("CONTENTOPS_BACKUP_DIRECTORY", "/backups"))
os.umask(0o077)
# Locks are held across inspection, reuse decision and the entire full dump.
lock = (root / ".contentops-backup.lock").open("a")
try:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    raise SystemExit("BACKUP_ALREADY_RUNNING; wait for the current backup receipt")
app = service_values("planner-app")
mcp = service_values("planner-mcp")
runtime_url = app.get('APP_DATABASE_URL') or app.get('DATABASE_URL')
if not runtime_url or runtime_url != (mcp.get('APP_DATABASE_URL') or mcp.get('DATABASE_URL')):
    raise SystemExit("Database binding missing or different across production services; no backup started")
url = urlsplit(runtime_url)
env = dict(os.environ)
env.update({"PGHOST": url.hostname or "", "PGPORT": str(url.port or 5432),
            "PGDATABASE": unquote(url.path.lstrip("/")),
            "PGUSER": unquote(url.username or ""), "PGPASSWORD": unquote(url.password or ""),
            "PGSSLMODE": "require", "PGCONNECT_TIMEOUT": "15",
            "PGAPPNAME": "contentops-owner-backup",
            "PGOPTIONS": "-c default_transaction_read_only=on -c statement_timeout=300000"})
sql = """SELECT json_build_object(
 'server_version',current_setting('server_version'),
 'database_bytes',pg_database_size(current_database()),
 'planner_tables',(SELECT count(*) FROM pg_tables WHERE schemaname='planner'),
 'schemas',(SELECT json_agg(nspname ORDER BY nspname) FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'),
 'extensions',(SELECT json_agg(extname ORDER BY extname) FROM pg_extension),
 'migration_ledgers',(SELECT json_agg(schemaname||'.'||tablename) FROM pg_tables WHERE tablename='_prisma_migrations'),
 'cross_schema_fks',(SELECT count(*) FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_class r ON r.oid=c.confrelid JOIN pg_namespace rn ON rn.oid=r.relnamespace WHERE c.contype='f' AND n.nspname='planner' AND rn.nspname<>'planner'))"""
metadata = json.loads(checked(["psql", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql], env))
metadata.update({"provider": "supabase", "app_mcp_binding_equal": True,
                 "inspected_at": datetime.datetime.now(datetime.timezone.utc).isoformat()})
metadata["binding_sha256"] = hashlib.sha256(
    json.dumps([url.hostname,url.port or 5432,unquote(url.path),unquote(url.username or "")]).encode()
).hexdigest()
fingerprint_sql = pathlib.Path(__file__).with_name("schema-fingerprint.sql").read_text()
metadata["schema_fingerprint"] = checked(["psql","-XAt","-v","ON_ERROR_STOP=1","-c",fingerprint_sql],env).strip()
if "public._prisma_migrations" not in metadata.get("migration_ledgers", []):
    raise SystemExit("BACKUP_LEDGER_UNSUPPORTED; inspect the migration ledger before reusing backups")
ledger_sql = "SELECT md5(coalesce(string_agg(concat_ws(':',migration_name,checksum,finished_at,rolled_back_at,applied_steps_count),'|' ORDER BY migration_name),'')) FROM public._prisma_migrations"
ledger_fingerprint = checked(["psql","-XAt","-v","ON_ERROR_STOP=1","-c",ledger_sql],env).strip()
metadata["schema_fingerprint"] = hashlib.sha256((metadata["schema_fingerprint"]+":"+ledger_fingerprint).encode()).hexdigest()
print(json.dumps(metadata), flush=True)
if "--backup" not in sys.argv:
    raise SystemExit(0)
force_reason = None
if "--force-reason" in sys.argv:
    index = sys.argv.index("--force-reason")
    if index+1 >= len(sys.argv) or not sys.argv[index+1].strip() or sys.argv[index+1].startswith("--"):
        raise SystemExit("FORCE_REASON_REQUIRED")
    force_reason = sys.argv[index+1].strip()
if not force_reason:
    existing = reusable_backup(root,metadata["binding_sha256"],metadata["schema_fingerprint"],
                               datetime.datetime.now(datetime.timezone.utc))
    if existing and "--code-only" not in sys.argv:
        raise SystemExit("BACKUP_CLASSIFICATION_REQUIRED; use --code-only to reuse a verified snapshot for ordinary code, or --force-reason before migration/destructive work")
    if existing:
        print(json.dumps({"status":"verified_backup_reused","file":existing["file"],
                          "sha256":existing["sha256"],"recovery_point":existing["completed_at"],
                          "new_dump":False,"rpo_hours":24}),flush=True)
        raise SystemExit(0)

os.umask(0o077)
root = pathlib.Path(os.environ.get("CONTENTOPS_BACKUP_DIRECTORY", "/backups"))
stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
target = root / ("contentops-production-" + stamp + ".dump")
partial = target.with_suffix(".dump.partial")
if target.exists() or partial.exists():
    raise SystemExit("BACKUP_NAME_COLLISION; preserve archive and wait before retry")
free = shutil.disk_usage(root).free
if free < max(metadata["database_bytes"] * 3, 5 * 1024**3):
    raise SystemExit("Insufficient backup/restore disk reserve; no dump started")
checked(["pg_dump", "--format=custom", "--no-owner", "--no-acl", "--lock-wait-timeout=15000",
         "--file=" + str(partial)], env)
checked(["pg_restore", "--list", str(partial)])
digest = hashlib.sha256()
with partial.open("rb") as stream:
    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
        digest.update(chunk)
partial.rename(target)
metadata.update({"status": "dump_created_archive_list_verified", "file": target.name,
                 "dump_bytes": target.stat().st_size, "sha256": digest.hexdigest(),
                 "completed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                 "restore_verified": False,
                 "scope": "full logical database; no role ownership/ACL export; external storage files excluded"})
target.with_suffix(".receipt.json").write_text(json.dumps(metadata, indent=2) + "\n")
print(json.dumps(metadata), flush=True)
