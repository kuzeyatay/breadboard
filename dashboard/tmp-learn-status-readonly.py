import json
import sqlite3


connection = sqlite3.connect("file:db/brain.db?mode=ro", uri=True)
connection.row_factory = sqlite3.Row
row = connection.execute(
    """
    SELECT *
    FROM learn_maps
    WHERE id = ?
    """,
    ("learn_map_mt3h0b43_3czpdig",),
).fetchone()
connection.close()


def summarize(value):
    if isinstance(value, dict):
        return {
            "kind": "object",
            "keys": sorted(value.keys()),
            "child_shapes": {
                key: (
                    {"kind": "list", "length": len(item)}
                    if isinstance(item, list)
                    else {"kind": "object", "keys": sorted(item.keys())}
                    if isinstance(item, dict)
                    else {"kind": type(item).__name__}
                )
                for key, item in value.items()
            },
        }
    if isinstance(value, list):
        return {
            "kind": "list",
            "length": len(value),
            "first_shape": summarize(value[0]) if value else None,
        }
    return {"kind": type(value).__name__}


json_fields = [
    "source_map_json",
    "scope_contract_json",
    "learning_map_json",
    "proposed_order_json",
    "visual_opportunities_json",
    "coverage_plan_json",
    "source_ids_json",
    "syllabus_coverage_json",
    "visual_necessity_review_json",
    "visualization_plan_json",
    "visual_contract_executability_ledger_json",
    "visual_route_binding_json",
]
result = {
    "id": row["id"],
    "status": row["status"],
    "garden_id": row["garden_id"],
    "job_id": row["job_id"],
    "source_set_hash": row["source_set_hash"],
    "source_artifact_inventory_hash": row["source_artifact_inventory_hash"],
    "syllabus_source_id": row["syllabus_source_id"],
    "confirmed_at": row["confirmed_at"],
    "source_ids": json.loads(row["source_ids_json"]),
    "json": {
        field: summarize(json.loads(row[field])) if row[field] else None
        for field in json_fields
    },
}
source_map = json.loads(row["source_map_json"])
coverage_plan = json.loads(row["coverage_plan_json"])
syllabus_coverage = json.loads(row["syllabus_coverage_json"])
route_binding = json.loads(row["visual_route_binding_json"])
result["binding_checks"] = {
    "source_map_sources": source_map.get("sources", []),
    "coverage_plan_sources": coverage_plan.get("sources", []),
    "syllabus_available_source_ids": syllabus_coverage.get("availableSourceIds"),
    "syllabus_missing_citation_count": len(syllabus_coverage.get("missingCitations", [])),
    "syllabus_untaught_unit_count": len(syllabus_coverage.get("untaughtUnitTitles", [])),
    "coverage_source_set_hash_matches_map": coverage_plan.get("sourceSetHash") == row["source_set_hash"],
    "coverage_inventory_hash_matches_map": (
        coverage_plan.get("sourceArtifactInventoryHash") == row["source_artifact_inventory_hash"]
    ),
    "visual_route_source_set_hash_matches_map": (
        route_binding.get("sourceSetHash") == row["source_set_hash"]
    ),
    "visual_route_inventory_hash_matches_map": (
        route_binding.get("sourceArtifactInventoryHash") == row["source_artifact_inventory_hash"]
    ),
}
print(json.dumps(result))
