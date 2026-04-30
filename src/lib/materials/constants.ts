// Constantes de materiales didácticos
// Fase 11.C · Stud.ia

// Coincide con allowed_mime_types del bucket teaching-materials (migración 014)
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.ms-excel',
] as const;

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_FILE_SIZE_MB = 10;

// Mapeo MIME → extensión amigable + label
export const MIME_INFO: Record<string, { ext: string; label: string }> = {
  'application/pdf': { ext: 'pdf', label: 'PDF' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    ext: 'docx',
    label: 'Word',
  },
  'application/msword': { ext: 'doc', label: 'Word (legacy)' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    ext: 'xlsx',
    label: 'Excel',
  },
  'application/vnd.ms-excel': { ext: 'xls', label: 'Excel (legacy)' },
};

// Mapeo extensión → MIME (para validación cliente cuando el navegador no detecta MIME)
export const EXT_TO_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
};

export const ACCEPT_ATTRIBUTE = '.pdf,.docx,.doc,.xlsx,.xls';

// Polling
export const POLLING_INTERVAL_MS = 5000;
export const POLLING_BACKOFF_AFTER_RETRIES = 3;
export const POLLING_BACKOFF_MS = 10000;
