/** Render only known runtime values, once, without interpreting their contents. */
export function renderPromptTemplate(template: string, parameters: Record<string, string>): string {
  return template.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (token, name: string) =>
    Object.hasOwn(parameters, name) ? parameters[name] : token);
}
