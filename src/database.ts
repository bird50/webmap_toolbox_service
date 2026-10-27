import {DatabaseSync} from 'node:sqlite';
import {z} from 'zod';

/** App IDs name a tenant: lowercase letters, digits and dashes. */
export const appId=z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/,'App ID ใช้ a–z, 0–9 และ - ยาว 2–63 ตัวอักษร');

/** Ordered schema changes of one part of the service; entry i is version i+1 in `schema_modules`. Never edit or reorder an applied entry. */
export type Migrations=readonly ((db:DatabaseSync)=>void)[];
export type Schema={name:string;migrations:Migrations};

// Tables every module shares: API keys and the audit log, with the columns a 1.4 database has.
const core:Schema={name:'core',migrations:[
 db=>db.exec(`CREATE TABLE api_keys(id TEXT PRIMARY KEY,appId TEXT NOT NULL,scopes TEXT NOT NULL,hash TEXT NOT NULL UNIQUE,label TEXT NOT NULL,createdAt INTEGER NOT NULL,revokedAt INTEGER);
 CREATE TABLE audit(id TEXT PRIMARY KEY,owner TEXT NOT NULL,action TEXT NOT NULL,resourceId TEXT NOT NULL,createdAt INTEGER NOT NULL,appId TEXT NOT NULL DEFAULT '');`),
]};

// Up to 1.4 one list on PRAGMA user_version (1–4) changed the tables of every tool. It is frozen: such a database finishes it
// once, then each of these schemas is recorded at version 1 (its first migration is that v4 schema). user_version stays 4.
const ADOPTED=['core','photos','drawings','data-files'];
function upgradeLegacy(db:DatabaseSync,defaultAppId:string){
 db.exec(`CREATE TABLE IF NOT EXISTS drawing_shares(id TEXT PRIMARY KEY,owner TEXT NOT NULL,username TEXT NOT NULL,name TEXT NOT NULL,createdAt INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS drawings(id TEXT PRIMARY KEY,shareId TEXT NOT NULL REFERENCES drawing_shares(id),data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS drawing_bounds(rowId INTEGER PRIMARY KEY,minX REAL NOT NULL,maxX REAL NOT NULL,minY REAL NOT NULL,maxY REAL NOT NULL);
 CREATE INDEX IF NOT EXISTS drawing_bounds_lat ON drawing_bounds(maxY,minY);
 CREATE INDEX IF NOT EXISTS drawing_bounds_lon ON drawing_bounds(maxX,minX);
 CREATE TABLE IF NOT EXISTS shares(id TEXT PRIMARY KEY,owner TEXT NOT NULL,username TEXT NOT NULL,eventName TEXT NOT NULL,tags TEXT NOT NULL,createdAt INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS photos(id TEXT PRIMARY KEY,owner TEXT NOT NULL,name TEXT NOT NULL,longitude REAL NOT NULL,latitude REAL NOT NULL,capturedAt TEXT,capturedOffset TEXT,createdAt INTEGER NOT NULL,expiresAt INTEGER,shareId TEXT REFERENCES shares(id),image BLOB NOT NULL);
 CREATE INDEX IF NOT EXISTS photos_owner_expiry ON photos(owner,expiresAt);
 CREATE INDEX IF NOT EXISTS photos_viewport ON photos(latitude,longitude) WHERE shareId IS NOT NULL;
 CREATE INDEX IF NOT EXISTS photos_share ON photos(shareId);
 CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,owner TEXT NOT NULL,action TEXT NOT NULL,resourceId TEXT NOT NULL,createdAt INTEGER NOT NULL);`);
 const migrations=[
  // v1: per-app API keys and tenant column on published data.
  ()=>{
   db.exec(`CREATE TABLE api_keys(id TEXT PRIMARY KEY,appId TEXT NOT NULL,scopes TEXT NOT NULL,hash TEXT NOT NULL UNIQUE,label TEXT NOT NULL,createdAt INTEGER NOT NULL,revokedAt INTEGER);
   ALTER TABLE shares ADD COLUMN appId TEXT NOT NULL DEFAULT '';
   ALTER TABLE drawing_shares ADD COLUMN appId TEXT NOT NULL DEFAULT '';
   ALTER TABLE audit ADD COLUMN appId TEXT NOT NULL DEFAULT '';
   CREATE INDEX shares_app ON shares(appId,createdAt);
   CREATE INDEX drawing_shares_app ON drawing_shares(appId);`);
   for(const table of ['shares','drawing_shares','audit'])db.prepare(`UPDATE ${table} SET appId=? WHERE appId=''`).run(defaultAppId);
  },
  // v2: Public data file shares; one row per feature with numeric bounds for viewport queries.
  ()=>db.exec(`CREATE TABLE data_file_shares(id TEXT PRIMARY KEY,appId TEXT NOT NULL,owner TEXT NOT NULL,username TEXT NOT NULL,name TEXT NOT NULL,description TEXT NOT NULL,tags TEXT NOT NULL,featureCount INTEGER NOT NULL,createdAt INTEGER NOT NULL);
   CREATE INDEX data_file_shares_app ON data_file_shares(appId,createdAt);
   CREATE TABLE data_features(id INTEGER PRIMARY KEY,shareId TEXT NOT NULL REFERENCES data_file_shares(id),data TEXT NOT NULL);
   CREATE INDEX data_features_share ON data_features(shareId);
   CREATE TABLE data_feature_bounds(featureId INTEGER PRIMARY KEY REFERENCES data_features(id),minX REAL NOT NULL,maxX REAL NOT NULL,minY REAL NOT NULL,maxY REAL NOT NULL);
   CREATE INDEX data_feature_bounds_lat ON data_feature_bounds(maxY,minY);
   CREATE INDEX data_feature_bounds_lon ON data_feature_bounds(maxX,minX);`),
  // v3: the publishing app's display name on every share; older rows take their app ID.
  ()=>{for(const table of ['shares','drawing_shares','data_file_shares'])db.exec(`ALTER TABLE ${table} ADD COLUMN appName TEXT NOT NULL DEFAULT '';UPDATE ${table} SET appName=appId;`);},
  // v4: the uploader's caption for each Public photo.
  ()=>db.exec(`ALTER TABLE photos ADD COLUMN caption TEXT NOT NULL DEFAULT ''`),
 ];
 const version=(db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version;
 for(const [index,migrate] of migrations.entries())if(version<=index)migrate();
 db.exec('PRAGMA user_version=4');
}

/**
 * Opens the database and applies pending migrations of the core tables and of each schema in `schemas` (the enabled
 * tool modules), so a module that is not enabled creates no tables. `defaultAppId` stamps rows written before apps existed,
 * so they stay with the legacy `.env` key's app.
 */
export function openDatabase(path:string,defaultAppId='default',schemas:readonly Schema[]=[]){
 appId.parse(defaultAppId);
 const db=new DatabaseSync(path);
 db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
 // Versions are read inside the write lock, so the service and the key CLI never apply a migration twice.
 const locked=(fn:()=>void)=>{db.exec('BEGIN IMMEDIATE');try{fn();db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');db.close();throw error;}};
 const exists=(table:string)=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
 locked(()=>{
  if(exists('schema_modules'))return;
  const legacy=['shares','drawing_shares','audit'].some(table=>exists(table));
  if(legacy)upgradeLegacy(db,defaultAppId);
  db.exec('CREATE TABLE schema_modules(module TEXT PRIMARY KEY,version INTEGER NOT NULL)');
  if(legacy)for(const name of ADOPTED)db.prepare('INSERT INTO schema_modules(module,version) VALUES(?,1)').run(name);
  else db.exec('PRAGMA user_version=4');
 });
 for(const schema of [core,...schemas])for(const [index,migrate] of schema.migrations.entries())locked(()=>{
  const version=(db.prepare('SELECT version FROM schema_modules WHERE module=?').get(schema.name) as {version:number}|undefined)?.version??0;
  if(version>index)return;
  migrate(db);
  db.prepare('INSERT INTO schema_modules(module,version) VALUES(?,?) ON CONFLICT(module) DO UPDATE SET version=excluded.version').run(schema.name,index+1);
 });
 return db;
}
