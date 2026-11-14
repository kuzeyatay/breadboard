import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { FEATURE_SYSTEM_PROMPTS } from '../../src/lib/system-prompts/feature-defaults.ts';

// Exercise real generation with built-in prompts, without opening the user's
// prompt/settings database through the system-prompt service import.
const root=path.resolve(import.meta.dirname,'../..');
const defaults=Object.fromEntries(FEATURE_SYSTEM_PROMPTS.map(item=>[item.id,item.defaultContent]));
const built=await build({bundle:true,write:false,format:'cjs',platform:'node',
  stdin:{resolveDir:root,contents:`export {generateRecommendations} from './src/lib/recommendations/generate.ts';
    export {generateSentenceCompletion} from './src/lib/sentence-completion-service.ts';
    export {generatePromptSuggestion,generatePdfSuggestions} from './src/lib/chat-prompt-suggestion-service.ts';`},
  plugins:[{name:'prompt-store-boundary',setup(b){
    b.onResolve({filter:/system-prompts\/service\.ts$/},()=>({path:'prompt-defaults',namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`const defaults=${JSON.stringify(defaults)};
      export const systemPromptText=id=>defaults[id]; export const renderSystemPrompt=id=>defaults[id];`,loader:'js'}));
  }}]});
const module={exports:{}};
new Function('module','exports','require',built.outputFiles[0].text)(module,module.exports,createRequire(import.meta.url));
export const {generateRecommendations,generatePromptSuggestion,generatePdfSuggestions,generateSentenceCompletion}=module.exports;
