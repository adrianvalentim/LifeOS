-- Task-only single authority. No public database or HTTP import endpoint.
CREATE TABLE IF NOT EXISTS lifeos_tasks (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  document TEXT NOT NULL CHECK (json_valid(document))
);
