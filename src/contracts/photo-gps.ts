export type GeotaggedPhoto={file:File;longitude:number;latitude:number};
export type PhotoMetadata={longitude:number;latitude:number;capturedAt:string|null;capturedOffset:string|null};

export async function readPhotoMetadata(input:Blob|Uint8Array):Promise<PhotoMetadata|null> {
  try {
    const {gps,parse}=await import("exifr");
    const result=await gps(input);
    if(!result||!Number.isFinite(result.latitude)||!Number.isFinite(result.longitude)||Math.abs(result.latitude)>90||Math.abs(result.longitude)>180)return null;
    let capturedAt:string|null=null;
    let capturedOffset:string|null=null;
    try {
      const tags=await parse(input,{pick:["DateTimeOriginal","OffsetTimeOriginal"],reviveValues:false});
      const raw=tags?.DateTimeOriginal;
      if(typeof raw==="string"){
        const match=raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})\s*$/);
        if(match){
          const [,y,m,d,h,min,sec]=match;
          const normalized=`${y}-${m}-${d}T${h}:${min}:${sec}`;
          const date=new Date(`${normalized}Z`);
          if(Number.isFinite(date.getTime())&&date.toISOString().slice(0,19)===normalized)capturedAt=normalized;
        }
      }
      if(typeof tags?.OffsetTimeOriginal==="string"&&/^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(tags.OffsetTimeOriginal))capturedOffset=tags.OffsetTimeOriginal;
    } catch { /* GPS remains usable locally when the capture date is unavailable. */ }
    return {...result,capturedAt,capturedOffset};
  } catch {return null;}
}

export async function readPhotoGps(file:File):Promise<PhotoMetadata|null> {
  return readPhotoMetadata(file);
}
