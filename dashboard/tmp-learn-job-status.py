import json
import sqlite3


connection = sqlite3.connect("file:db/brain.db?mode=ro", uri=True)
connection.row_factory = sqlite3.Row
row = connection.execute(
    """
    SELECT
      id,
      status,
      mode,
      progress_percent,
      current_step,
      current_section_title,
      current_page_title,
      error,
      updated_at,
      proposed_learning_map_id,
      confirmed_learning_map_id,
      latest_textbook_version_id,
      source_ids_json,
      syllabus_source_id
    FROM learn_jobs
    WHERE garden_id = ?
    ORDER BY created_at DESC, rowid DESC
    LIMIT 1
    """,
    ("electromagnetism-1",),
).fetchone()
connection.close()
print(json.dumps(dict(row) if row else None))
