import {DatabaseSync} from 'node:sqlite';
import {z} from 'zod';

/** App IDs name a tenant: lowercase letters, digits and dashes. */
export const appId=z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/,'App ID ใช้ a–z, 0–9 และ - ยาว 2–63 ตัวอักษร');

/**
 * Opens the database, creates the base schema and applies pending migrations (PRAGMA user_version).
 * `defaultAppId` stamps rows written before apps existed, so they stay with the legacy `.env` key's app.
 */
export function openDatabase(path:string,defaultAppId='default'){
 appId.parse(defaultAppId);
 const db=new DatabaseSync(path);
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS drawing_shares(id TEXT PRIMARY KEY,owner TEXT NOT NULL,username TEXT NOT NULL,name TEXT NOT NULL,createdAt INTEGER NOT NULL);
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
 ];
 // The version is read inside the write lock, so the service and the key CLI never apply a migration twice.
 for(const [index,migrate] of migrations.entries()){
  db.exec('BEGIN IMMEDIATE');
  try{
   const version=(db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version;
   if(version<=index){migrate();db.exec(`PRAGMA user_version=${index+1}`);}
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');db.close();throw error;}
 }
 return db;
}
