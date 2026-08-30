from __future__ import annotations

from datetime import datetime
from pydantic import BaseModel


class ProjectMeta(BaseModel):
    id: str
    initiative: str
    description: str | None = None
    failure_statement: str
    created_at: datetime
    updated_at: datetime
    notes: str | None = None
