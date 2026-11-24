import type { PlannedEdge, PlannedNode } from "./thoughtTopologyLayout.ts"

type Node = Pick<PlannedNode, "id" | "kind" | "title" | "sectorId" | "folderTitle" | "concepts" | "summary">
type Context = {
  selectedNodeId?: string | null
  selectedEdge?: PlannedEdge
  multipleGardens: boolean
  visibleConnectionCount: number
}
type Answer = { text: string; nodes: Node[]; edges: PlannedEdge[] }

const normalize = (s: string) => (s.toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}]+/gu) ?? []).join(" ")
const filler = new Set(("a an and are as at be between by can connections connection connected connects connecting connect different do does each " +
  "explain find for from garden gardens give strongest strong how i in inter intra is it link linked links map me most my node nodes of on or " +
  "page pages path paths please related relate relates relationship relationships show some the these this those through to what which why with " +
  "across cross within same selected has have any there their they shared tell list trace other overlap your knowledge").split(" "))
const scopeMessage = "I can answer questions about this map’s Gardens, pages, and connections. Try “Which pages connect across Gardens?” or enter a page title."
const empty = (text: string): Answer => ({ text, nodes: [], edges: [] })
const hasWord = (text: string, phrase: string) => (" " + text + " ").includes(" " + phrase + " ")

function shortestPath(edges: PlannedEdge[], start: string, end: string) {
  const adjacent = new Map<string, PlannedEdge[]>()
  for (const edge of edges) {
    for (const id of [edge.source, edge.target]) {
      const list = adjacent.get(id)
      if (list) list.push(edge)
      else adjacent.set(id, [edge])
    }
  }
  const queue = [start], seen = new Set(queue), previous = new Map<string, PlannedEdge>()
  for (let i = 0; i < queue.length && !seen.has(end); i++) {
    for (const edge of adjacent.get(queue[i]) ?? []) {
      const next = edge.source === queue[i] ? edge.target : edge.source
      if (seen.has(next)) continue
      previous.set(next, edge)
      seen.add(next)
      queue.push(next)
    }
  }
  const path: PlannedEdge[] = []
  for (let id = end; previous.has(id);) {
    const edge = previous.get(id)!
    path.push(edge)
    id = edge.source === id ? edge.target : edge.source
  }
  return path.reverse()
}

/** Answers come from the current graph. Every returned ID can be shown on this map. */
export function answerMapQuestion(nodes: Node[], edges: PlannedEdge[], question: string, context: Context): Answer {
  const text = normalize(question)
  const request = text.replace(/^(?:please |can you |could you )+/, "")
  const byId = new Map(nodes.map(n => [n.id, n]))
  const selected = byId.get(context.selectedNodeId ?? "")
  const deictic = /\b(this|these|it|they|selected|those)\b/.test(text)
  const lookup = request.replace(/^(?:what is|what s|tell me about|show me|describe|explain|show|find) /, "")
    .replace(/^(?:the |my )?(?:page|node|garden|folder) (?:named |called )?/, "")
    .replace(/ (?:on|in) (?:this|the|my) (?:knowledge )?map$/, "")
  const subject = nodes.find(n => normalize(n.title) === lookup) ??
    (/^(?:(?:tell me about|describe|what is|what s|explain|show) )?(?:(?:this|the selected) (?:page|node|garden|folder)|it)$/.test(request) ? selected : undefined)
  if (subject) {
    const entry = subject.summary.text?.trim()
    const location = subject.folderTitle ? " in " + subject.folderTitle : ""
    return { text: entry || (subject.title + " is a " + subject.kind + location + "."), nodes: [subject], edges: [] }
  }
  const counting = /^(?:how many|count|what is the (?:number|count) of|what s the (?:number|count) of)\b/.test(request)
  const overview = /^(?:(?:show|summarize|describe|explain) (?:me )?(?:this|the|my) (?:knowledge )?map|(?:map )?overview|what(?: s| is) (?:in|on) (?:this|the|my) (?:knowledge )?map)$/.test(request)
  const countSubject = request.replace(/^(?:how many|count|what (?:is|s) the (?:number|count) of) /, "")
  const countWords = new Set("nodes gardens pages links connections and are there shown visible on in does this the my knowledge map have here total".split(" "))
  const globalCount = counting && /\b(nodes|gardens|pages|links|connections)\b/.test(countSubject) &&
    countSubject.split(" ").every(w => countWords.has(w))
  if (overview || globalCount) {
    const gardens = context.multipleGardens ? nodes.filter(n => n.kind === "folder" && n.id === n.sectorId).length : 1
    const pages = nodes.filter(n => n.kind === "page").length
    return empty("This view shows " + gardens.toLocaleString() + (gardens === 1 ? " Garden, " : " Gardens, ") +
      nodes.length.toLocaleString() + " nodes (" + pages.toLocaleString() + " pages), and " +
      context.visibleConnectionCount.toLocaleString() + " connections.")
  }
  if (/^(?:what|why|how)\b.*\b(colou?rs?|colou?red)\b/.test(text) && /\b(map|nodes?|dots?|gardens?|mean|represent)\b/.test(text)) {
    return empty("Pages with a detected topic share its color. Other nodes use their Garden or top-level folder color. Each line takes its colors from its two endpoints.")
  }
  if (/^(?:what|why|how)\b.*\b(pulse|pulses|pulsing|highlighted)\b/.test(text) && /\b(map|nodes?|dots?|links?|connections?)\b/.test(text)) {
    return empty("An answer briefly pulses its cited nodes and links. They stay highlighted until you clear them or ask another question. Recent map activity can also pulse when it arrives.")
  }
  const relation = /\b(?:connect(?:s|ed|ing|ions?)?|relat(?:e[sd]?|ionships?|ions?)|links?|linked|paths?|bridges?|affinit(?:y|ies)|neighbou?rs?|overlap)\b/.test(text)
  const mapRequest = /^(?:what|which|where|how|why|are|is|do|does|find|show|list|tell|give|explain|trace|explore|connect|connections?|links?|paths?|strongest|cross|inter|count)\b/.test(request)
  if (!relation || !mapRequest) return empty(scopeMessage)

  const mentions = nodes.map(n => ({node: n, title: normalize(n.title)}))
    .filter(m => m.title && !filler.has(m.title) && hasWord(text, m.title))
    .sort((a,b) => b.title.length - a.title.length)
  const named = mentions.filter((m,i) => !mentions.slice(0,i).some(other => hasWord(other.title, m.title)))
    .sort((a,b) => (" " + text + " ").indexOf(" " + a.title + " ") - (" " + text + " ").indexOf(" " + b.title + " "))
    .map(m => m.node)
  if (!named.length && deictic && context.selectedEdge && /\b(link|connection|edge|they|these two|related|connected)\b/.test(text)) {
    return { text: "Here is the connection you selected.", edges: [context.selectedEdge], nodes: [] }
  }
  if (!named.length && deictic && selected) named.push(selected)
  const crossOnly = /\b(?:cross garden|across gardens|between gardens|different gardens)\b/.test(text)
  const withinOnly = /\b(?:inter garden|within (?:a |the |one )?garden|same garden)\b/.test(text)
  const isGarden = (n: Node) => context.multipleGardens && n.kind === "folder" && n.id === n.sectorId
  const includes = (n: Node, id: string) => n.id === id || (isGarden(n) && byId.get(id)?.sectorId === n.id)
  const ranked = edges.filter(e => (!crossOnly || (context.multipleGardens && e.crossFolder)) &&
    (!withinOnly || !context.multipleGardens || !e.crossFolder))
    .sort((a,b) => b.strength - a.strength || b.score - a.score || a.id.localeCompare(b.id))
  if (named.length >= 2 && !isGarden(named[0]) && !isGarden(named[1])) {
    const [a, b] = named
    const path = shortestPath(ranked, a.id, b.id)
    return { text: path.length ? (path.length === 1 ? "These pages share a direct link." : "The shortest path uses " + path.length + " links.") :
      "I couldn’t find a path between those nodes with the current filters.", edges: path, nodes: [] }
  }
  const terms = [...new Set(text.split(" ").filter(w => !filler.has(w)))]
  const explicitOverview = /\b(?:strongest|cross garden|across gardens|between gardens|on (?:this|the|my) map|in (?:this|the|my) map)\b/.test(text)
  if (!named.length && !terms.length && deictic && !explicitOverview) return empty("Select a node or connection, or include its name in your question.")
  const nodeText = new Map<string, string>()
  const searchable = (id: string) => {
    if (!nodeText.has(id)) {
      const n = byId.get(id)
      nodeText.set(id, n ? normalize([n.title, n.folderTitle, ...n.concepts].join(" ")) : "")
    }
    return nodeText.get(id)!
  }
  const found = ranked.filter(e => {
    if (named.length > 1) {
      const [a,b] = named
      return (includes(a,e.source) && includes(b,e.target)) || (includes(a,e.target) && includes(b,e.source))
    }
    if (named.length) return includes(named[0],e.source) || includes(named[0],e.target)
    if (!terms.length) return true
    const evidence = searchable(e.source) + " " + searchable(e.target) + " " + normalize(e.evidence.map(v => v.label).join(" "))
    return terms.every(t => hasWord(evidence,t))
  })
  if (!found.length) return empty("I couldn’t find a matching connection in this view. Try a page title or widen the map filters.")
  if (counting) return {text: found.length.toLocaleString() + (found.length === 1 ? " connection matches" : " connections match") +
    " in the current map filters.", edges: found.slice(0,5), nodes: []}
  const hits = found.slice(0,5)
  return { text: hits.length === 1 ? "I found one matching connection." : "Here are " + hits.length + " of the strongest matching connections.", edges: hits, nodes: [] }
}
