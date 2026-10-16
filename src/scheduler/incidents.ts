import {PoolClient} from 'pg';
// Must be called inside the job's transaction. Repeat failures update last_seen only.
export async function incident(db:PoolClient,project:string,resource:string,error:string|null):Promise<{changed:boolean;recovered:boolean}>{
 await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`incident:${project}:${resource}`]);
 const old=(await db.query('SELECT error_code FROM notification_incidents WHERE project_id=$1 AND resource=$2',[project,resource])).rows[0];
 const changed=!!error&&old?.error_code!==error,recovered=!error&&!!old?.error_code;
 await db.query('INSERT INTO notification_incidents(project_id,resource,error_code) VALUES($1,$2,$3) ON CONFLICT(project_id,resource) DO UPDATE SET error_code=EXCLUDED.error_code,last_seen_at=now()',[project,resource,error]);
 return {changed,recovered};
}
