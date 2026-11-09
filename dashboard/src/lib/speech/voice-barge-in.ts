import {VOICE_MIN_SPEECH_MS} from './voice-conversation.ts';

/** Local backup for delayed native VAD. A short consonant gap must not erase
 * an otherwise sustained interruption. Keep a bounded 320 ms window, require
 * 70% voiced audio, and forget it after a 90 ms gap. Quiet cues and isolated
 * clicks do not qualify. The caller still decides when native VAD is behind. */
export function createVoiceBargeIn() {
  let frames: {ms:number; voiced:boolean}[] = [];
  let duration=0, voiced=0, quiet=0, continuationMs=0, continuing=false;
  function reset() { frames=[];duration=0;voiced=0;quiet=0;continuationMs=0; }
  return {
    reset,
    push(level:number, frameMs:number, options:{threshold:number;active:boolean;allowed:boolean;continuationMs?:number}) {
      const continuation=options.continuationMs!==undefined;
      if(!options.active||!Number.isFinite(level)||!Number.isFinite(frameMs)||frameMs<=0){reset();return false;}
      if(continuation!==continuing){reset();continuing=continuation;}
      const loud=level>=options.threshold;
      if(continuation){
        // Preserve the existing strict continuation rule used while settling
        // recognition; an interruption improvement must not shorten that guard.
        continuationMs=loud?continuationMs+frameMs:0;
        if(options.allowed&&continuationMs>=options.continuationMs!){reset();return true;}
        return false;
      }
      quiet=loud?0:quiet+frameMs;
      if(quiet>90){reset();return false;}
      if(!frames.length&&!loud)return false;
      frames.push({ms:frameMs,voiced:loud});duration+=frameMs;if(loud)voiced+=frameMs;
      let excess=duration-VOICE_MIN_SPEECH_MS;
      while(excess>0&&frames.length){
        const head=frames[0],remove=Math.min(head.ms,excess);
        head.ms-=remove;duration-=remove;if(head.voiced)voiced-=remove;excess-=remove;
        if(head.ms<=0)frames.shift();
      }
      if(options.allowed&&duration>=VOICE_MIN_SPEECH_MS-0.001&&voiced>=VOICE_MIN_SPEECH_MS*0.7){reset();return true;}
      return false;
    },
  };
}
