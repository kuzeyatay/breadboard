declare module "*.scss" {
  const content: string
  export = content
}

declare module "reading-time/lib/reading-time.js" {
  import readingTime from "reading-time"
  export default readingTime
}

// dom custom event
interface CustomEventMap {
  prenav: CustomEvent<{}>
  nav: CustomEvent<{ url: FullSlug }>
  themechange: CustomEvent<{ theme: "light" | "dark" }>
  readermodechange: CustomEvent<{ mode: "on" | "off" }>
}

type ContentIndex = Record<FullSlug, ContentDetails>
declare const fetchData: Promise<ContentIndex>
declare const fetchSearchData: (() => Promise<ContentIndex>) | undefined
