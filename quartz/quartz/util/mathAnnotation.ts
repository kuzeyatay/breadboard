/** A stable, readable quote shared by rendered Quartz and its document editor. */
export function mathAnnotationText(raw: string, display: boolean): string {
  const source = raw.replace(/^\${1,2}([\s\S]*?)\${1,2}$/, '$1').trim();
  const delimiter = display ? '$$' : '$';
  return `${delimiter}${source}${delimiter}`;
}
