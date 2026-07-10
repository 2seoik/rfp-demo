#!/bin/bash
set -e

# Enable pgvector extension
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  
  -- Verify extensions are installed
  SELECT extname, extversion FROM pg_extension ORDER BY extname;
EOSQL

echo "✅ pgvector extension enabled successfully"
