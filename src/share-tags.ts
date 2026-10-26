import {z} from "zod";

/** Tags a user adds to a Public share; the dated `shareYYYY-MM-DD` tag is added by the service only. */
export const shareTags=z.array(z.string().trim().min(1).max(50).refine(tag=>!/^share\d{4}-\d{2}-\d{2}$/i.test(tag),"แท็กวันที่แชร์สร้างโดยระบบเท่านั้น")).max(10);

export function automaticShareTag(now=new Date()) {
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);
  const part=(type:string)=>parts.find(item=>item.type===type)!.value;
  return `share${part("year")}-${part("month")}-${part("day")}`;
}
