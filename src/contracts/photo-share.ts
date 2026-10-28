import {z} from "zod";
import {shareTags} from "./share-tags.js";
export {automaticShareTag} from "./share-tags.js";

export const MAX_SHARE_PHOTOS=10;
export const MAX_SHARE_BYTES=25*1024*1024;
export const shareFields=z.object({
  eventName:z.string().trim().min(1,"กรุณาระบุชื่อเหตุการณ์").max(160),
  tags:shareTags,
});
export const MAX_PHOTO_CAPTION=500;
/** Text that goes with one photo; empty means none. */
export const photoCaption=z.string().trim().max(MAX_PHOTO_CAPTION,`ข้อความประกอบรูปไม่เกิน ${MAX_PHOTO_CAPTION} ตัวอักษร`);
/** Multipart `captions`: a JSON array in the order of the `photos` files (missing entries are empty). */
export const photoCaptions=z.array(photoCaption).max(MAX_SHARE_PHOTOS);
