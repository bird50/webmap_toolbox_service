// Contracts in src/contracts/ are copies of the SDK's src/contracts/ (one source of truth: the SDK).
// `npm run contracts:sync` copies them from the SDK; `npm run contracts:check` fails when any file differs.
// The SDK checkout is ../toolbox_sdk, or TOOLBOX_SDK_DIR.
import {readFileSync,readdirSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';

const sdk=resolve(process.env.TOOLBOX_SDK_DIR??'../toolbox_sdk','src/contracts');
const local='src/contracts';
if(!existsSync(sdk)){console.error(`SDK contracts not found at ${sdk}; set TOOLBOX_SDK_DIR.`);process.exit(1);}
const check=process.argv.includes('--check');
const names=new Set([...readdirSync(sdk),...readdirSync(local)].filter(name=>name.endsWith('.ts')));
const problems=[];
for(const name of [...names].sort()){
 const from=join(sdk,name),to=join(local,name);
 if(!existsSync(from)){problems.push(`${name}: only in the service (remove it or add it to the SDK)`);continue;}
 const source=readFileSync(from,'utf8');
 if(existsSync(to)&&readFileSync(to,'utf8')===source)continue;
 if(check)problems.push(`${name}: ${existsSync(to)?'differs from':'missing, present in'} the SDK`);
 else{writeFileSync(to,source);console.log(`copied ${name}`);}
}
if(problems.length){console.error(`Contracts out of sync with ${sdk}:\n- ${problems.join('\n- ')}\nRun npm run contracts:sync.`);process.exit(1);}
if(check)console.log(`Contracts match ${sdk} (${names.size} files).`);
