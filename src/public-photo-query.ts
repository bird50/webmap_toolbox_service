import {z} from "zod";

const captureDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{
  const date=new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
},"วันที่ไม่ถูกต้อง");

export const publicPhotoFilters=z.object({
  username:z.string().trim().max(100).default(""),
  eventName:z.string().trim().max(160).default(""),
  startDate:z.union([captureDate,z.literal("")]).default(""),
  endDate:z.union([captureDate,z.literal("")]).default(""),
  tag:z.string().trim().max(50).default(""),
}).refine(filters=>!filters.startDate||!filters.endDate||filters.startDate<=filters.endDate,{message:"วันสิ้นสุดต้องไม่ก่อนวันเริ่มต้น",path:["endDate"]});

export type PublicPhotoFilters=z.infer<typeof publicPhotoFilters>;
export const emptyPublicPhotoFilters:PublicPhotoFilters={username:"",eventName:"",startDate:"",endDate:"",tag:""};

export const publicPhotoQuery=z.object({
  bbox:z.string().max(160).transform((value,ctx)=>{
    const parts=value.split(",");
    const bounds=parts.map(Number);
    if(parts.length!==4||parts.some(part=>part.trim()==="")||bounds.some(value=>!Number.isFinite(value))||Math.abs(bounds[0])>180||Math.abs(bounds[2])>180||Math.abs(bounds[1])>90||Math.abs(bounds[3])>90||bounds[1]>=bounds[3]||bounds[0]===bounds[2]){
      ctx.addIssue({code:"custom",message:"Invalid bbox"});return z.NEVER;
    }
    return bounds as [number,number,number,number];
  }),
  limit:z.coerce.number().int().min(1).max(200).default(200),
}).and(publicPhotoFilters);

export function photoViewportBbox(west:number,south:number,east:number,north:number) {
  const wrap=(longitude:number)=>((longitude+180)%360+360)%360-180;
  return [east-west>=360?-180:wrap(west),Math.max(-90,south),east-west>=360?180:wrap(east),Math.min(90,north)].join(",");
}
