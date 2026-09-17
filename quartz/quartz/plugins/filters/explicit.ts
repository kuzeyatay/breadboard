import { QuartzFilterPlugin } from "../types"

export const ExplicitPublish: QuartzFilterPlugin = () => ({
  name: "ExplicitPublish",
  shouldPublish(_ctx, content) {
    const vfile = content[1]
    return vfile.data?.frontmatter?.publish === true || vfile.data?.frontmatter?.publish === "true"
  },
})
