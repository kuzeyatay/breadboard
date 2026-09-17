$db = Join-Path $env:APPDATA "breadboard-desktop\Data\database\brain.db"
sqlite3 -json $db @"
select id,status,mode,model,current_step,progress_percent,current_section_title,current_page_title,error,json_array_length(source_ids_json) as source_count,syllabus_source_id,source_only,include_source_snapshots,confirmed_learning_map_id,latest_textbook_version_id,updated_at from learn_jobs order by created_at desc limit 1;
select * from learn_job_token_usage order by usage_updated_at desc limit 1;
select count(*) as maps from learn_maps where garden_id='electromagnetism-1';
select count(*) as versions from learn_versions where garden_id='electromagnetism-1';
select * from learn_publication_retries where garden_id='electromagnetism-1';
"@
