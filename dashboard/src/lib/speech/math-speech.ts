import katex from 'katex';
// The public system entry point starts fetching locales as an import side
// effect. Use its setup and speech processor directly to install local data
// before anything can load (including when a lazy import was cancelled).
import { setup } from 'speech-rule-engine/js/common/engine_setup.js';
import { process as processMath } from 'speech-rule-engine/js/common/processor_factory.js';
import base from 'speech-rule-engine/lib/mathmaps/base.json' with { type: 'json' };
import en from 'speech-rule-engine/lib/mathmaps/en.json' with { type: 'json' };

let ready: Promise<void> | undefined;

/** The rule data ships in the lazy chunk: no CDN, filesystem, or model call. */
function prepareEngine(): Promise<void> {
  return ready ??= (async () => {
    const custom = async (locale: string) => JSON.stringify(locale === 'base' ? base : en);
    // SRE supports a custom loader; its published feature-vector type omits it.
    const configure = setup as (options: Record<string, unknown>) => Promise<unknown>;
    const options = { mode: typeof window === 'undefined' ? 'sync' : 'http', locale: 'en', domain: 'clearspeak', style: 'default', markup: 'none', custom };
    // The first setup initializes SRE; the second awaits its locale rules.
    await configure(options);
    await configure(options);
  })().catch(error => { ready = undefined; throw error; });
}

export async function mathSpeech(source: string): Promise<string> {
  await prepareEngine();
  const markup = katex.renderToString(source, {
    output: 'mathml', throwOnError: true, strict: 'ignore', trust: false, maxExpand: 1000,
  });
  const mathml = markup.match(/<math[\s\S]*<\/math>/)?.[0];
  if (!mathml) throw new Error('The formula could not be parsed.');
  const spoken = String(processMath('speech', mathml)).trim();
  if (!spoken) throw new Error('The formula has no spoken representation.');
  return spoken;
}
