import {z} from "zod";
import {drawingCollection} from "./drawing-contract.js";

export const DRAWING_SET_PAGE=20;
const shareDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{
  const date=new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
},"วันที่ไม่ถูกต้อง");
/** Filters of the Public drawing set search, combined with AND; dates are the day the set was published (Thai time). */
export const publicDrawingSetFilters=z.object({
  name:z.string().trim().max(160).default(""),
  username:z.string().trim().max(100).default(""),
  tag:z.string().trim().max(50).default(""),
  startDate:z.union([shareDate,z.literal("")]).default(""),
  endDate:z.union([shareDate,z.literal("")]).default(""),
}).refine(filters=>!filters.startDate||!filters.endDate||filters.startDate<=filters.endDate,{message:"วันสิ้นสุดต้องไม่ก่อนวันเริ่มต้น",path:["endDate"]});
export type PublicDrawingSetFilters=z.infer<typeof publicDrawingSetFilters>;
export const emptyPublicDrawingSetFilters:PublicDrawingSetFilters={name:"",username:"",tag:"",startDate:"",endDate:""};
/** Search of Public drawing sets of the calling app, newest first. */
export const publicDrawingSetQuery=z.object({
  offset:z.coerce.number().int().min(0).max(10000).default(0),
  limit:z.coerce.number().int().min(1).max(50).default(DRAWING_SET_PAGE),
}).and(publicDrawingSetFilters);
/** Bounds in ms of the Thai-time days `startDate`–`endDate` (either may be empty). */
export function publishedRange(startDate:string,endDate:string):[number,number]{
  return [startDate?Date.parse(`${startDate}T00:00:00+07:00`):0,endDate?Date.parse(`${endDate}T23:59:59.999+07:00`):Number.MAX_SAFE_INTEGER];
}
/** One set in the search result; `bbox` is `[west,south,east,north]` of its drawings. */
export const publicDrawingSet=z.object({
  id:z.string().uuid(),
  name:z.string(),
  tags:z.array(z.string()),
  username:z.string(),
  appName:z.string(),
  createdAt:z.number(),
  drawingCount:z.number().int(),
  bbox:z.tuple([z.number(),z.number(),z.number(),z.number()]),
});
export type PublicDrawingSet=z.infer<typeof publicDrawingSet>;
export const publicDrawingSetResponse=z.object({sets:z.array(publicDrawingSet),hasMore:z.boolean()});
/** `GET /drawing-shares/:id`: one set with its drawings, for Add to map. */
export const publicDrawingShare=z.object({id:z.string().uuid(),name:z.string(),tags:z.array(z.string()),username:z.string(),appName:z.string(),createdAt:z.number(),drawings:drawingCollection});
export type PublicDrawingShare=z.infer<typeof publicDrawingShare>;
