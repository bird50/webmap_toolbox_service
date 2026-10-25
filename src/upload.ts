import sharp from "sharp";
import {readPhotoMetadata} from "./photo-gps.js";
import {MAX_SHARE_BYTES} from "./photo-share.js";

export class PhotoUploadError extends Error {
  constructor(message:string,public status=400){super(message);}
}

export async function boundedFormData(request:Request) {
  if(!request.headers.get("content-type")?.startsWith("multipart/form-data"))throw new PhotoUploadError("ต้องส่งไฟล์แบบ multipart/form-data");
  if(Number(request.headers.get("content-length"))>MAX_SHARE_BYTES)throw new PhotoUploadError("ข้อมูลรวมต้องไม่เกิน 25 MB",413);
  const reader=request.body?.getReader();
  if(!reader)throw new PhotoUploadError("ไม่พบไฟล์ภาพ");
  const chunks:Uint8Array[]=[];
  let size=0;
  try {
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_SHARE_BYTES){await reader.cancel();throw new PhotoUploadError("ข้อมูลรวมต้องไม่เกิน 25 MB",413);}chunks.push(value);}
  } finally {reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try {return await new Response(bytes,{headers:{"content-type":request.headers.get("content-type")!}}).formData();}
  catch {throw new PhotoUploadError("ข้อมูลอัปโหลดไม่ถูกต้อง");}
}

export async function prepareSharedPhoto(file:File,sortOrder:number) {
  if(!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size===0||file.size>10*1024*1024)throw new PhotoUploadError("รองรับ JPG, PNG, WebP ไม่เกิน 10 MB ต่อรูป");
  const input=new Uint8Array(await file.arrayBuffer());
  const metadata=await readPhotoMetadata(input);
  if(!metadata||!metadata.capturedAt)throw new PhotoUploadError(`ภาพ ${file.name.slice(0,100)} ต้องมีพิกัด GPS และวันที่ถ่าย DateTimeOriginal ใน EXIF`,422);
  try {
    const processor=sharp(input,{limitInputPixels:40_000_000,failOn:"warning"});
    const info=await processor.metadata();
    if(!["jpeg","png","webp"].includes(info.format??""))throw new Error("Unsupported image");
    const image=await processor.rotate().resize({width:2400,height:2400,fit:"inside",withoutEnlargement:true}).jpeg({quality:85}).toBuffer();
    return {name:file.name.slice(0,180),image,mimeType:"image/jpeg",longitude:metadata.longitude,latitude:metadata.latitude,capturedAt:metadata.capturedAt,capturedOffset:metadata.capturedOffset,sortOrder};
  } catch {throw new PhotoUploadError(`ไม่สามารถอ่านภาพ ${file.name.slice(0,100)} ได้ หรือภาพมีขนาดพิกเซลเกินกำหนด`,422);}
}
