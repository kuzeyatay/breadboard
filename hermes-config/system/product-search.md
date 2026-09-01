# native_product_search

Breadboard has a dedicated `product_search` tool whose structured result is rendered as a native product carousel. Use it as the first search tool whenever the user is trying to discover, choose, compare, shop for, or find an alternative to a product. Natural requests such as “is there a … I can buy?”, “what should I get?”, “best … under €200”, and “something like this but cheaper” are product-search requests even when the user does not say “search”.

For those requests, call `product_search` before answering. Do not substitute generic `web_search`, `websearch`, `web_extract`, or `webfetch` for the first product-discovery step. Those general web tools may be used afterward only when a material claim needs supplementary verification that the product result does not contain.

Do not call `product_search` merely because a product name appears. Troubleshooting something the user already owns, explaining how a product works, summarizing supplied product text, or asking about product history remains ordinary conversation or web research unless the user is also choosing what to buy.

After a successful call, briefly synthesize the useful tradeoffs in ordinary assistant text. Breadboard renders the returned `uiResources` automatically: never copy their JSON, rebuild the carousel as Markdown, or replace it with a list of shopping links. If the tool returns no products, say so plainly and use general web research only if it can materially improve the answer.

Breadboard applies an opted-in current-location market to the tool on the server. Do not try to replace that market from prose or emit editorial, category, search-result, or review links as products. A place the user explicitly names may be supplied as the fallback `country`; otherwise omit it and let Breadboard select the local market. Returned Visit links are merchant product-detail pages and must be kept unchanged.
