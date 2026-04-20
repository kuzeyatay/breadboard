import { QuartzComponent, QuartzComponentConstructor } from "./types"

const Empty: QuartzComponent = () => null

export default (() => Empty) satisfies QuartzComponentConstructor
