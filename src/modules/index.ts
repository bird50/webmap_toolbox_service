import {z} from 'zod';
import {MODULE_NAMES,type ModuleName,type ToolModule} from './context.js';
import {photos} from './photos.js';
import {drawings} from './drawings.js';
import {dataFiles} from './data-files.js';

export {MODULE_NAMES,type ModuleName};
export const MODULES:Record<ModuleName,ToolModule>={photos,drawings,'data-files':dataFiles};

/** At least one known module; duplicates collapse. */
export const moduleList=z.array(z.enum(MODULE_NAMES,{error:issue=>`Unknown module "${String(issue.input)}"; use ${MODULE_NAMES.join(', ')}`})).min(1,'List at least one module').transform(list=>[...new Set(list)]);

/** TOOLBOX_MODULES: comma list; unset or blank serves every module. Unknown names throw so a misspelt list fails at startup. */
export function parseModules(value:string|undefined):ModuleName[]{
 const result=moduleList.safeParse(value?.trim()?value.split(',').map(name=>name.trim()):[...MODULE_NAMES]);
 if(!result.success)throw new Error(`TOOLBOX_MODULES: ${result.error.issues.map(issue=>issue.message).join('; ')}`);
 return result.data;
}
