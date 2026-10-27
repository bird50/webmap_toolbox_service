import {z} from "zod";

/** Tags a user adds to a Public share; the dated `shareYYYY-MM-DD` tag is added by the service only. */
export const shareTags=z.array(z.string().trim().min(1).max(50).refine(tag=>!/^share\d{4}-\d{2}-\d{2}$/i.test(tag),"แท็กวันที่แชร์สร้างโดยระบบเท่านั้น")).max(10);

export function automaticShareTag(now=new Date()) {
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);
  const part=(type:string)=>parts.find(item=>item.type===type)!.value;
  return `share${part("year")}-${part("month")}-${part("day")}`;
}

const shareDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{
  const date=new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
},"วันที่ไม่ถูกต้อง");
/** Filters of a Public set search (drawing or data file sets), combined with AND; dates are the day the set was published (Thai time). */
export const publicSetFilters=z.object({
  name:z.string().trim().max(160).default(""),
  username:z.string().trim().max(100).default(""),
  tag:z.string().trim().max(50).default(""),
  startDate:z.union([shareDate,z.literal("")]).default(""),
  endDate:z.union([shareDate,z.literal("")]).default(""),
}).refine(filters=>!filters.startDate||!filters.endDate||filters.startDate<=filters.endDate,{message:"วันสิ้นสุดต้องไม่ก่อนวันเริ่มต้น",path:["endDate"]});
export type PublicSetFilters=z.infer<typeof publicSetFilters>;
export const emptyPublicSetFilters:PublicSetFilters={name:"",username:"",tag:"",startDate:"",endDate:""};
/** Bounds in ms of the Thai-time days `startDate`–`endDate` (either may be empty). */
export function publishedRange(startDate:string,endDate:string):[number,number]{
  return [startDate?Date.parse(`${startDate}T00:00:00+07:00`):0,endDate?Date.parse(`${endDate}T23:59:59.999+07:00`):Number.MAX_SAFE_INTEGER];
}
