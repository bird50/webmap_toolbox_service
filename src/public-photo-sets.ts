import {z} from "zod";
import {publicPhotoFilters} from "./public-photo-query.js";

export const PHOTO_SET_PAGE=20;
/**
 * Search of Public photo sets (shares) of the calling app, newest first. Filters combine with AND: event name and
 * username match in part, the tag matches whole, the dates keep sets with a photo taken in the range.
 */
export const publicPhotoSetQuery=z.object({
  offset:z.coerce.number().int().min(0).max(10000).default(0),
  limit:z.coerce.number().int().min(1).max(50).default(PHOTO_SET_PAGE),
}).and(publicPhotoFilters);
export type PublicPhotoSetQuery=z.infer<typeof publicPhotoSetQuery>;
/** One set in the search result; `bbox` is `[west,south,east,north]` of its photos. */
export const publicPhotoSet=z.object({
  id:z.string().uuid(),
  eventName:z.string(),
  tags:z.array(z.string()),
  username:z.string(),
  appName:z.string(),
  createdAt:z.number(),
  photoCount:z.number().int(),
  capturedFrom:z.string().nullable(),
  capturedTo:z.string().nullable(),
  bbox:z.tuple([z.number(),z.number(),z.number(),z.number()]),
  url:z.string(),
});
export type PublicPhotoSet=z.infer<typeof publicPhotoSet>;
export const publicPhotoSetResponse=z.object({sets:z.array(publicPhotoSet),hasMore:z.boolean()});
