/** Give the reader the spoken form of explicit units, without changing a
 * quantity or inferring an absent unit. Keep recovery offsets in the original
 * script so a longer pronunciation cannot skip the next sentence. */
export function prepareTemperatureSpeechScript(text: string, language?: string) {
  const replacements: {sourceStart:number;sourceEnd:number;spokenStart:number;spokenEnd:number}[]=[];
  let difference=0;
  const spoken=!language||!/^en(?:-|$)/iu.test(language)?text:text.replace(
    /°\s*[cf]\b|[℃℉]|\bdegrees?\s+[cf]\b/giu,
    (unit,offset:number)=>{
      const reading=(offset>0&&!/\s/u.test(text[offset-1])?' ':'')
        +'degrees '+(/f|℉/iu.test(unit)?'Fahrenheit':'Celsius');
      replacements.push({sourceStart:offset,sourceEnd:offset+unit.length,
        spokenStart:offset+difference,spokenEnd:offset+difference+reading.length});
      difference+=reading.length-unit.length;
      return reading;
    });
  return {text:spoken,sourceOffset(offset:number){
    const position=Math.max(0,Math.min(spoken.length,offset));
    let difference=0;
    for(const replacement of replacements){
      if(position<replacement.spokenStart)break;
      if(position<replacement.spokenEnd)return replacement.sourceStart;
      difference=replacement.spokenEnd-replacement.sourceEnd;
    }
    return position-difference;
  }};
}
