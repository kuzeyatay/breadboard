/** Make uploaded names such as Lecture7.3 and Lecture 7.3 equally searchable. */
export function normalizeDocumentSearch(value: string): string {
  return value.normalize("NFKD").toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([\p{L}])(\d)/gu, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

