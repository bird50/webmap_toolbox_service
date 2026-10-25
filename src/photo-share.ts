import {z} from "zod";

export const MAX_SHARE_PHOTOS=10;
export const MAX_SHARE_BYTES=25*1024*1024;
export const shareFields=z.object({
  eventName:z.string().trim().min(1,"กรุณาระบุชื่อเหตุการณ์").max(160),
  tags:z.array(z.string().trim().min(1).max(50).refine(tag=>!/^share\d{4}-\d{2}-\d{2}$/i.test(tag),"แท็กวันที่แชร์สร้างโดยระบบเท่านั้น")).max(10),
});

export function automaticShareTag(now=new Date()) {
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);
  const part=(type:string)=>parts.find(item=>item.type===type)!.value;
  return `share${part("year")}-${part("month")}-${part("day")}`;
}
