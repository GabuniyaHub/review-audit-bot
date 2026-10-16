export function validZone(zone:string):boolean {try{if(zone.length>80)return false;new Intl.DateTimeFormat('en-CA',{timeZone:zone}).format();return true;}catch{return false;}}
export function localDay(date:Date,zone:string):string{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);return ['year','month','day'].map(k=>parts.find(p=>p.type===k)!.value).join('-');}
export function nextDaily(after:Date,time:string,zone:string,skipDay?:string):Date {
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)||!validZone(zone)||!Number.isFinite(after.getTime()))throw new Error('Invalid daily schedule');
 const formatter=new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 for(let t=Math.floor(after.getTime()/60000)*60000+60000;t<=after.getTime()+3*86400000;t+=60000){const d=new Date(t);if(formatter.format(d)===time&&(!skipDay||localDay(d,zone)>skipDay))return d;}
 throw new Error('No next daily slot');
}
