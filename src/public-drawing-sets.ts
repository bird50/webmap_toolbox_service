import {z} from "zod";
import {drawingCollection} from "./drawing-contract.js";
import {emptyPublicSetFilters,publicSetFilters,type PublicSetFilters} from "./share-tags.js";

export const DRAWING_SET_PAGE=20;
/** Filters of the Public drawing set search (the shared Public set filters). */
export const publicDrawingSetFilters=publicSetFilters;
export type PublicDrawingSetFilters=PublicSetFilters;
export const emptyPublicDrawingSetFilters:PublicDrawingSetFilters=emptyPublicSetFilters;
/** Search of Public drawing sets of the calling app, newest first. */
export const publicDrawingSetQuery=z.object({
  offset:z.coerce.number().int().min(0).max(10000).default(0),
  limit:z.coerce.number().int().min(1).max(50).default(DRAWING_SET_PAGE),
}).and(publicDrawingSetFilters);
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
