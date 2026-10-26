import {z} from "zod";
import {shareTags} from "./share-tags.js";
export {automaticShareTag} from "./share-tags.js";

export const MAX_SHARE_PHOTOS=10;
export const MAX_SHARE_BYTES=25*1024*1024;
export const shareFields=z.object({
  eventName:z.string().trim().min(1,"กรุณาระบุชื่อเหตุการณ์").max(160),
  tags:shareTags,
});
