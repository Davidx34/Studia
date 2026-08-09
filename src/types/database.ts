// Protocolo 7.1.1 (post-auditoria): antes este archivo era un shim escrito
// a mano con una interfaz `Database` incompleta (12 tablas, faltaban
// lesson_questions, question_attempts, classroom_learning_objectives,
// material_chunks_processed, etc.) — por eso `.from('lesson_questions')...`
// resolvia a `never` en todo el codigo pese a que los 4 factories de
// cliente (`src/lib/supabase/{server,client,admin,anon}.ts`) ya llamaban
// `createClient<Database>` correctamente: el tipo que le pasaban estaba mal.
//
// database.generated.ts SI es el reflejo real del schema (via MCP
// generate_typescript_types / `supabase gen types`). Este archivo re-exporta
// ese `Database` real y deriva los tipos de conveniencia con nombre legible
// (Profile, TeachingMaterial, etc.) desde el, en vez de mantenerlos a mano
// — asi quedan sincronizados automaticamente la proxima vez que se
// regenere database.generated.ts, y ningun import existente en la app se
// rompe (los nombres exportados no cambiaron).

import type { Database as GeneratedDatabase, TablesGenerated as GeneratedTables } from './database.generated';

export type { Json } from './database.generated';
export type Database = GeneratedDatabase;

type TableRow<T extends keyof GeneratedDatabase['public']['Tables']> = GeneratedTables<T>;

// ============================================================
// Uniones literales para columnas que en Postgres tienen CHECK
// constraint pero que el generador de tipos de Supabase no puede inferir
// como literal (las expone como `string` a secas) — se mantienen a mano
// aqui, documentando el constraint real que las respalda.
// ============================================================

export type UserRole = 'student' | 'teacher' | 'admin'; // profiles.role: sin CHECK explicito en DB, default 'student' por app
export type ModuleStatus = 'locked' | 'available' | 'in_progress' | 'completed'; // student_progress.status
export type ContentType = 'reading' | 'video' | 'interactive' | 'quiz' | 'dialogue'; // content_modules.content_type
export type ItemType = 'avatar_skin' | 'tonito_customization' | 'power_up' | 'streak_freeze'; // shop_items.type
export type AchievementRarity = 'common' | 'rare' | 'epic' | 'legendary'; // achievements.rarity
export type CriteriaType =
  | 'xp_total'
  | 'streak_days'
  | 'modules_completed'
  | 'perfect_scores'
  | 'specific_category'
  | 'first_login'
  | 'coins_earned'
  | 'time_spent'; // achievements.criteria_type
export type MissionType =
  | 'complete_modules'
  | 'earn_xp'
  | 'maintain_streak'
  | 'perfect_score'
  | 'time_spent'
  | 'answer_questions'; // daily_missions.mission_type

export type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed'; // teaching_materials.processing_status, CHECK real (migracion 005)
export type MaterialSourceType = 'file' | 'link' | 'youtube' | 'notebooklm'; // teaching_materials.source_type, CHECK real (migraciones 005, 035, 042)
export type QuestionReviewStatus = 'pending' | 'approved' | 'rejected' | 'human_review'; // lesson_questions.review_status (Fase 1.3)

// ============================================================
// Tipos de tabla derivados del schema real, con las columnas enum
// sobrescritas a union literal donde aplica. El resto de columnas
// (nombre, nullability) vienen tal cual del generador — reflejan la
// verdad de la base, no una copia mantenida a mano que puede desviarse.
// ============================================================

export type Profile = Omit<TableRow<'profiles'>, 'role'> & { role: UserRole | null };

export type ContentModule = Omit<TableRow<'content_modules'>, 'content_type'> & {
  content_type: ContentType | null;
};

export type StudentProgress = Omit<TableRow<'student_progress'>, 'status'> & {
  status: ModuleStatus | null;
};

export type Achievement = Omit<TableRow<'achievements'>, 'criteria_type' | 'rarity'> & {
  criteria_type: CriteriaType;
  rarity: AchievementRarity | null;
};

export type UserAchievement = TableRow<'user_achievements'> & { achievement?: Achievement };

export type ShopItem = Omit<TableRow<'shop_items'>, 'type'> & { type: ItemType };

export type Classroom = TableRow<'classrooms'>;
export type ClassEnrollment = TableRow<'class_enrollments'>;
export type PendingEnrollment = TableRow<'pending_enrollments'>;

export type DailyMission = Omit<TableRow<'daily_missions'>, 'mission_type'> & {
  mission_type: MissionType;
};

export type UserMission = TableRow<'user_missions'> & { mission?: DailyMission };

export type TeachingMaterial = Omit<TableRow<'teaching_materials'>, 'processing_status' | 'source_type'> & {
  processing_status: ProcessingStatus;
  source_type: MaterialSourceType;
};

// El generador expone `embedding` como `string | null` (pgvector serializado
// en la respuesta REST cruda) — el codigo de la app siempre trabaja con
// number[] ya parseado (ver src/lib/embeddings/generate.ts). Se sobrescribe
// aqui para reflejar el shape con el que realmente se opera en TS, no el
// wire format crudo.
export type MaterialChunk = Omit<TableRow<'material_chunks'>, 'embedding'> & {
  embedding: number[] | null;
};

export type LessonQuestion = Omit<TableRow<'lesson_questions'>, 'review_status'> & {
  review_status: QuestionReviewStatus;
};

export type QuestionAttempt = TableRow<'question_attempts'>;
export type ClassroomLearningObjective = TableRow<'classroom_learning_objectives'>;
export type ClassroomConcept = TableRow<'classroom_concepts'>;
export type ClassroomAiConfig = TableRow<'classroom_ai_config'>;

// ============================================================
// Shapes que NO corresponden a ninguna tabla (payloads de API /
// respuestas de edge functions, no filas persistidas) — se mantienen a
// mano, no hay schema real del que derivarlos.
// ============================================================

export type QuestionType = 'multiple_choice' | 'true_false' | 'fill_blank';

export interface MCQuestion {
  question: string;
  options: [string, string, string, string];
  correct_index: number;
  explanation: string;
  source_quote: string;
}

export interface TFQuestion {
  statement: string;
  is_true: boolean;
  explanation: string;
  source_quote: string;
}

export interface FillQuestion {
  sentence_with_blank: string;
  correct_answer: string;
  alternatives_accepted: string[];
  explanation: string;
  source_quote: string;
}

export type GeneratedLessonQuestion =
  | { question_type: 'multiple_choice'; data: MCQuestion }
  | { question_type: 'true_false'; data: TFQuestion }
  | { question_type: 'fill_blank'; data: FillQuestion };

export interface GenerateLessonResponse {
  ok: boolean;
  module_id?: string;
  questions?: GeneratedLessonQuestion[];
  error?: string;
}
