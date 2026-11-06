"""Bounded receipts for exact page bodies already read by one chat session.

The normal Garden broker still authorizes, matches, reviews and applies the
revision. These receipts only spare the model from retyping the old Markdown.
"""

from collections import OrderedDict
import hashlib
import json
from threading import Lock


class GardenRevisionReads:
    def __init__(self):
        self._lock = Lock()
        self._partials = OrderedDict()
        self._bodies = OrderedDict()

    @staticmethod
    def _key(session, args, slug_field):
        slug = str(args.get(slug_field) or "").strip().replace("\\", "/")
        if slug.endswith(".md"):
            slug = slug[:-3]
        return (session, str(args.get("gardenId") or ""), slug)

    @staticmethod
    def _bound(cache):
        while len(cache) > 16:
            cache.popitem(last=False)

    def remember(self, session, args, result):
        if not isinstance(result, dict):
            return result
        content, offset, total = (result.get(name) for name in ("content", "offset", "totalChars"))
        if (not isinstance(content, str) or type(offset) is not int or
                type(total) is not int or not 0 < total <= 100000 or offset < 0):
            return result
        # Reader offsets count JavaScript UTF-16 code units, including emoji.
        size = len(content.encode("utf-16-le", errors="surrogatepass")) // 2
        if not size or offset + size > total:
            return result
        key = self._key(session, args, "slug")
        with self._lock:
            prior = self._partials.get(key)
            if offset == 0 or prior is None or prior[0] != total:
                prior = (total, {})
                self._partials[key] = prior
            prior[1][offset] = (size, content)
            self._partials.move_to_end(key)
            self._bound(self._partials)
            if sum(length for length, _ in prior[1].values()) > 100000:
                self._partials.pop(key, None)
                return result
            cursor, pieces = 0, []
            for start, (length, text) in sorted(prior[1].items()):
                if start != cursor:
                    return result
                pieces.append(text)
                cursor += length
            if cursor != total:
                return result
            # JSON chunks may split a surrogate pair at a UTF-16 boundary.
            body = "".join(pieces).encode("utf-16-le", errors="surrogatepass").decode("utf-16-le", errors="surrogatepass")
            receipt = hashlib.sha256(json.dumps([key, body], ensure_ascii=True).encode()).hexdigest()
            self._bodies[receipt] = (key, body)
            self._bodies.move_to_end(receipt)
            self._bound(self._bodies)
            return {**result, "revisionBodyReadId": receipt}

    def resolve(self, session, args):
        receipt = args.get("originalBodyReadId")
        if receipt is None:
            return args
        if "originalText" in args:
            raise ValueError("Use originalBodyReadId or originalText, not both.")
        with self._lock:
            record = self._bodies.get(receipt) if isinstance(receipt, str) else None
            if record is None or record[0] != self._key(session, args, "pageSlug"):
                raise ValueError("Read this complete page with garden_get_page first, using the same gardenId and page path, then use its revisionBodyReadId. No revision was submitted.")
            return {key: value for key, value in args.items() if key != "originalBodyReadId"} | {"originalText": record[1]}


garden_revision_reads = GardenRevisionReads()
