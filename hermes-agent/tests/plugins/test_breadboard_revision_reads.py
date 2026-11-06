import pytest

from plugins.breadboard.garden_revision_reads import GardenRevisionReads


def test_full_body_receipt_keeps_exact_lines_and_unicode_and_scope():
    cache = GardenRevisionReads()
    args = {"gardenId": "em1", "slug": "introduction/vectors.md"}
    first = "# Vectors\n\n🧭\n"
    second = "$$\nv\n=\nx+y\n$$"
    size = len(first.encode("utf-16-le")) // 2
    total = size + len(second)
    partial = cache.remember("chat", args, {"content": first, "offset": 0, "totalChars": total})
    assert "revisionBodyReadId" not in partial
    complete = cache.remember("chat", args, {"content": second, "offset": size, "totalChars": total})
    edit = {"gardenId": "em1", "pageSlug": "introduction/vectors", "originalBodyReadId": complete["revisionBodyReadId"], "patchOrReplacement": "Generated replacement"}
    assert cache.resolve("chat", edit) == {"gardenId": "em1", "pageSlug": "introduction/vectors", "originalText": first + second, "patchOrReplacement": "Generated replacement"}
    for session, changed in [("other", {}), ("chat", {"gardenId": "other"}), ("chat", {"pageSlug": "other"})]:
        with pytest.raises(ValueError):
            cache.resolve(session, edit | changed)
    with pytest.raises(ValueError):
        cache.resolve("chat", edit | {"originalText": "ambiguous"})


def test_incomplete_overlapping_and_oversize_reads_never_issue_full_body_receipts():
    cache = GardenRevisionReads()
    args = {"slug": "page"}
    for offset, text, total in [(0, "abc", 9), (4, "def", 9), (2, "ghi", 9), (0, "large", 100001)]:
        assert "revisionBodyReadId" not in cache.remember("s", args, {"content": text, "offset": offset, "totalChars": total})
    with pytest.raises(ValueError):
        cache.resolve("s", {"pageSlug": "page", "originalBodyReadId": "invented"})


def test_full_body_receipt_preserves_retained_draft_reference_for_server_review():
    cache = GardenRevisionReads()
    result = cache.remember("chat", {"gardenId": "course", "slug": "page"},
                            {"content": "Old body", "offset": 0, "totalChars": 8})
    args = {"gardenId": "course", "pageSlug": "page", "originalBodyReadId": result["revisionBodyReadId"],
            "replacementDraftRunId": "retained-run", "replacementDraftIndex": 0}
    resolved = cache.resolve("chat", args)
    assert resolved == {"gardenId": "course", "pageSlug": "page", "originalText": "Old body",
                        "replacementDraftRunId": "retained-run", "replacementDraftIndex": 0}
    assert "patchOrReplacement" not in resolved


def test_a_new_read_does_not_mix_with_an_older_partial_read():
    cache = GardenRevisionReads()
    args = {"slug": "page"}
    cache.remember("s", args, {"content": "old", "offset": 3, "totalChars": 6})
    first = cache.remember("s", args, {"content": "new", "offset": 0, "totalChars": 6})
    assert "revisionBodyReadId" not in first
    complete = cache.remember("s", args, {"content": "end", "offset": 3, "totalChars": 6})
    assert cache.resolve("s", {"pageSlug": "page", "originalBodyReadId": complete["revisionBodyReadId"]})["originalText"] == "newend"


def test_unicode_character_split_across_reader_chunks_is_restored():
    cache = GardenRevisionReads()
    args = {"slug": "page"}
    cache.remember("s", args, {"content": "A\ud83e", "offset": 0, "totalChars": 4})
    result = cache.remember("s", args, {"content": "\uddedB", "offset": 2, "totalChars": 4})
    original = cache.resolve("s", {"pageSlug": "page", "originalBodyReadId": result["revisionBodyReadId"]})["originalText"]
    assert original == "A🧭B"
    assert original.encode("utf-8")
