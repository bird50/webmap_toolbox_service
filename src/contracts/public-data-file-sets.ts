import {z} from "zod";
import {dataFeatureCollection} from "./data-file-share.js";
import {publicSetFilters} from "./share-tags.js";

export const DATA_FILE_SET_PAGE=20;
/** Search of Public data file sets of the calling app, newest first, with the shared Public set filters (AND). */
export const publicDataFileSetQuery=z.object({
  offset:z.coerce.number().int().min(0).max(10000).default(0),
  limit:z.coerce.number().int().min(1).max(50).default(DATA_FILE_SET_PAGE),
}).and(publicSetFilters);
/** One set in the search result; `bbox` is `[west,south,east,north]` of its features. */
export const publicDataFileSet=z.object({
  id:z.string().uuid(),
  name:z.string(),
  description:z.string(),
  tags:z.array(z.string()),
  username:z.string(),
  appName:z.string(),
  createdAt:z.number(),
  featureCount:z.number().int(),
  bbox:z.tuple([z.number(),z.number(),z.number(),z.number()]),
});
export type PublicDataFileSet=z.infer<typeof publicDataFileSet>;
export const publicDataFileSetResponse=z.object({sets:z.array(publicDataFileSet),hasMore:z.boolean()});
/** `GET /data-file-shares/:id`: one set with its features, for Add to map. */
export const publicDataFileShare=z.object({id:z.string().uuid(),name:z.string(),description:z.string(),tags:z.array(z.string()),username:z.string(),appName:z.string(),createdAt:z.number(),data:dataFeatureCollection});
export type PublicDataFileShare=z.infer<typeof publicDataFileShare>;
