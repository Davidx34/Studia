-- Migration 004: Enable extensions
-- Fase 11.A · Stud.ia · Clases con IA Generativa de Mapa Educativo
--
-- Habilita las extensiones requeridas por la fase 11:
--   - vector: tipos y operadores para embeddings + índices HNSW (RAG sobre material didáctico)
--   - pg_trgm: similitud trigram para búsqueda fuzzy (futura)
--
-- Idempotente. Aditiva. No toca datos existentes.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
