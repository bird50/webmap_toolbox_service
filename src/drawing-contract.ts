import {z} from "zod";
import {shareTags} from "./share-tags.js";
const color=z.string().regex(/^#[0-9a-f]{6}$/i);
const coordinate=z.tuple([z.number().min(-180).max(180),z.number().min(-90).max(90)]);
export const drawingSchema=z.object({
 id:z.string().uuid(),tool:z.enum(["pen","highlighter","point","line","polygon","rectangle","circle","arrow","text","textbox","callout","label","sticky","number","legend"]),
 points:z.array(coordinate).min(1).max(2001),text:z.string().max(1000),
 style:z.object({color,background:color,border:color,font:z.enum(["sans-serif","serif","monospace"]),fontSize:z.number().min(10).max(96),width:z.number().min(1).max(40),opacity:z.number().min(0).max(1),rotation:z.number().min(-180).max(180),alignment:z.enum(["left","center","right"])}),
 boxWidth:z.number().min(1).max(10000),boxHeight:z.number().min(1).max(10000),
}).superRefine((d,ctx)=>{
 const minimum=["polygon","rectangle","circle"].includes(d.tool)?4:["pen","highlighter","line","arrow","callout"].includes(d.tool)?2:1;
 if(d.points.length<minimum)ctx.addIssue({code:"custom",message:"รูปวาดมีจุดไม่ครบ"});
 if(minimum===4){const first=d.points[0],last=d.points.at(-1)!;if(first[0]!==last[0]||first[1]!==last[1])ctx.addIssue({code:"custom",message:"พื้นที่ต้องปิดวง"});}
});
export const drawingCollection=z.array(drawingSchema).max(500).superRefine((items,ctx)=>{
 if(new Set(items.map(d=>d.id)).size!==items.length||items.reduce((n,d)=>n+d.points.length,0)>20000)ctx.addIssue({code:"custom",message:"ID ซ้ำ หรือเกิน 20,000 จุด"});
});
/** A drawing set published to Public: its name, up to 10 tags (the dated `shareYYYY-MM-DD` tag is added by the service) and 1–100 objects. */
export const drawingShareSchema=z.object({name:z.string().trim().min(1).max(160),tags:shareTags.default([]),drawings:drawingCollection.refine(items=>items.length>0&&items.length<=100,"แชร์ครั้งละ 1–100 วัตถุ")});
