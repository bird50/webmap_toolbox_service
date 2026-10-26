import {z} from "zod";
import {shareTags} from "./share-tags.js";
import {viewportBbox} from "./public-photo-query.js";

/** GeoJSON accepted from data files and Public data file shares: WGS84 Point/Line/Polygon (and Multi), flat properties. */
export const MAX_DATA_FEATURES=5000;
export const MAX_DATA_POSITIONS=50000;
export const MAX_DATA_SHARE_BYTES=5*1024*1024;
const position=z.array(z.number().finite()).min(2).max(3).refine(p=>Math.abs(p[0])<=180&&Math.abs(p[1])<=90,"พิกัดต้องเป็น WGS84 (longitude, latitude)");
const line=z.array(position).min(2);
const ring=z.array(position).min(4).refine(p=>JSON.stringify(p[0])===JSON.stringify(p[p.length-1]),"Polygon ต้องปิดวง");
const polygon=z.array(ring).min(1);
export const dataGeometry=z.discriminatedUnion("type",[
 z.object({type:z.literal("Point"),coordinates:position}),z.object({type:z.literal("MultiPoint"),coordinates:z.array(position).min(1)}),
 z.object({type:z.literal("LineString"),coordinates:line}),z.object({type:z.literal("MultiLineString"),coordinates:z.array(line).min(1)}),
 z.object({type:z.literal("Polygon"),coordinates:polygon}),z.object({type:z.literal("MultiPolygon"),coordinates:z.array(polygon).min(1)})
]);
export const dataFeature=z.object({type:z.literal("Feature"),geometry:dataGeometry,properties:z.record(z.string(),z.union([z.string().max(2000),z.number().finite(),z.boolean(),z.null()])).nullable()});
/** Every [x,y] position of a geometry, for counting and bounds. */
export function positions(coordinates:unknown,out:number[][]=[]):number[][]{
 if(Array.isArray(coordinates)){if(typeof coordinates[0]==="number")out.push(coordinates as number[]);else coordinates.forEach(item=>positions(item,out));}
 return out;
}
export const dataFeatureCollection=z.object({type:z.literal("FeatureCollection"),features:z.array(dataFeature).min(1).max(MAX_DATA_FEATURES)})
 .refine(data=>data.features.reduce((sum,feature)=>sum+positions(feature.geometry.coordinates).length,0)<=MAX_DATA_POSITIONS,`เกิน ${MAX_DATA_POSITIONS.toLocaleString("en-US")} จุดพิกัด`);

export const dataFileShareFields=z.object({
 name:z.string().trim().min(1,"กรุณาระบุชื่อชุดข้อมูล").max(160),
 description:z.string().trim().max(1000).default(""),
 tags:shareTags,
});
export const dataFileShareSchema=dataFileShareFields.extend({data:dataFeatureCollection});

/**
 * Public data file features carry the share in reserved properties; a file's own property with one of
 * these names is replaced.
 */
export const SHARE_PROPERTIES=["share_name","share_description","share_tags","share_username","share_id"] as const;
export const publicDataFileFilters=z.object({search:z.string().trim().max(160).default(""),tag:z.string().trim().max(50).default("")});
export type PublicDataFileFilters=z.infer<typeof publicDataFileFilters>;
export const emptyPublicDataFileFilters:PublicDataFileFilters={search:"",tag:""};
export const publicDataFileQuery=z.object({bbox:viewportBbox,limit:z.coerce.number().int().min(1).max(1000).default(500)}).and(publicDataFileFilters);
export const publicDataFileResponse=z.object({features:z.array(dataFeature).max(1000),hasMore:z.boolean()});
