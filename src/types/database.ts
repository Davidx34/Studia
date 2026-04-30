// Tipos generados manualmente desde el schema SQL
// En produccion, usar: npx supabase gen types typescript --project-id <id> > types/database.ts

export type UserRole = 'student' | 'teacher' | 'admin';
export type ModuleStatus = 'locked' | 'available' | 'in_progress' | 'completed';
export type ContentType = 'reading' | 'video' | 'interactive' | 'quiz' | 'dialogue';
export type ItemType = 'avatar_skin' | 'tonito_customization' | 'power_up' | 'streak_freeze';
export type AchievementRarity = 'common' | 'rare' | 'epic' | 'legendary';
export type CriteriaType =
  | 'xp_total'
  | 'streak_days'
  | 'modules_completed'
  | 'perfect_scores'
  | 'specific_category'
  | 'first_login'
  | 'coins_earned'
  | 'time_spent';
export type MissionType =
  | 'complete_modules'
  | 'earn_xp'
  | 'maintain_streak'
  | 'perfect_score'
  | 'time_spent'
  | 'answer_questions';

export interface Profile {
  id: string;
  username: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string;
  role: UserRole;
  current_level: number;
  total_xp: number;
  coins: number;
  current_hearts: number;
  max_hearts: number;
  last_heart_lost_at: string | null;
  streak_days: number;
  last_activity_date: string | null;
  last_login_at: string | null;
  gemini_preferences: {
    tone: string;
    difficulty: string;
    interests: string[];
  };
  tonito_state: {
    mood: string;
    skin: string;
    last_interaction: string | null;
  };
  timezone: string;
  created_at: string;
  updated_at: string;
}

export interface ContentModule {
  id: string;
  teacher_id: string | null;
  classroom_id: string | null;
  title: string;
  description: string | null;
  category: string;
  difficulty_level: number;
  content_type: ContentType;
  resource_url: string | null;
  resource_metadata: Record<string, any>;
  gemini_prompt_template: string | null;
  base_xp_reward: number;
  estimated_time_minutes: number;
  prerequisites: string[];
  order_index: number;
  map_position_x: number;
  map_position_y: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface StudentProgress {
  id: string;
  student_id: string;
  module_id: string;
  status: ModuleStatus;
  completion_percentage: number;
  score: number | null;
  best_score: number;
  attempts: number;
  time_spent_seconds: number;
  gemini_feedback_history: any[];
  earned_xp: number;
  earned_coins: number;
  started_at: string | null;
  completed_at: string | null;
  last_attempt_at: string | null;
}

export interface Achievement {
  id: string;
  name: string;
  description: string | null;
  icon_name: string;
  color: string;
  criteria_type: CriteriaType;
  criteria_value: number;
  criteria_category: string | null;
  reward_coins: number;
  reward_xp: number;
  rarity: AchievementRarity;
  sort_order: number;
  is_active: boolean;
}

export interface UserAchievement {
  id: string;
  user_id: string;
  achievement_id: string;
  earned_at: string;
  seen_by_user: boolean;
  achievement?: Achievement;
}

export interface ShopItem {
  id: string;
  name: string;
  description: string | null;
  type: ItemType;
  cost_coins: number;
  effect_data: Record<string, any>;
  image_url: string | null;
  preview_color: string | null;
  duration_minutes: number | null;
  is_consumable: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface Classroom {
  id: string;
  teacher_id: string;
  name: string;
  description: string | null;
  join_code: string;
  is_active: boolean;
  subject_area: string | null;
  grade_level: string | null;
  created_at: string;
}

export interface ClassEnrollment {
  id: string;
  classroom_id: string;
  student_id: string;
  teacher_id: string;
  enrolled_at: string;
}

export interface PendingEnrollment {
  id: string;
  email: string;
  classroom_id: string;
  teacher_id: string;
  invited_at: string;
}

export interface DailyMission {
  id: string;
  title: string;
  description: string | null;
  icon_name: string;
  mission_type: MissionType;
  target_value: number;
  reward_coins: number;
  reward_xp: number;
}

export interface UserMission {
  id: string;
  user_id: string;
  mission_id: string;
  assigned_date: string;
  current_progress: number;
  is_completed: boolean;
  completed_at: string | null;
  rewards_claimed: boolean;
  mission?: DailyMission;
}

// Para el type helper de Supabase
export interface Database {
  public: {
    Tables: {
      profiles: { Row: Profile; Insert: Partial<Profile>; Update: Partial<Profile> };
      content_modules: { Row: ContentModule; Insert: Partial<ContentModule>; Update: Partial<ContentModule> };
      student_progress: { Row: StudentProgress; Insert: Partial<StudentProgress>; Update: Partial<StudentProgress> };
      achievements: { Row: Achievement; Insert: Partial<Achievement>; Update: Partial<Achievement> };
      user_achievements: { Row: UserAchievement; Insert: Partial<UserAchievement>; Update: Partial<UserAchievement> };
      shop_items: { Row: ShopItem; Insert: Partial<ShopItem>; Update: Partial<ShopItem> };
      classrooms: { Row: Classroom; Insert: Partial<Classroom>; Update: Partial<Classroom> };
      class_enrollments: { Row: ClassEnrollment; Insert: Partial<ClassEnrollment>; Update: Partial<ClassEnrollment> };
      pending_enrollments: { Row: PendingEnrollment; Insert: Partial<PendingEnrollment>; Update: Partial<PendingEnrollment> };
      teaching_materials: { Row: TeachingMaterial; Insert: Partial<TeachingMaterial>; Update: Partial<TeachingMaterial> };
      material_chunks: { Row: MaterialChunk; Insert: Partial<MaterialChunk>; Update: Partial<MaterialChunk> };
      daily_missions: { Row: DailyMission; Insert: Partial<DailyMission>; Update: Partial<DailyMission> };
      user_missions: { Row: UserMission; Insert: Partial<UserMission>; Update: Partial<UserMission> };
    };
    Functions: {
      calculate_xp: {
        Args: {
          p_base_xp: number;
          p_streak_days: number;
          p_difficulty: number;
          p_score: number;
          p_attempts: number;
          p_time_seconds: number;
          p_estimated_minutes: number;
        };
        Returns: number;
      };
      check_and_update_streak: {
        Args: { p_user_id: string };
        Returns: Record<string, any>;
      };
      recover_hearts: {
        Args: { p_user_id: string };
        Returns: number;
      };
    };
  };
}

// ============================================================
// Fase 11 · Stud.ia · Clases con IA
// ============================================================

export type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface TeachingMaterial {
  id: string;
  classroom_id: string;
  teacher_id: string;
  filename: string;
  display_name: string | null;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  extracted_text: string | null;
  extracted_text_preview: string | null;
  processing_status: ProcessingStatus;
  processing_error: string | null;
  content_hash: string | null;
  chunk_count: number | null;
  topics_detected: string[] | null;
  estimated_difficulty: number | null;
  version: number;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
}

export interface MaterialChunk {
  id: string;
  material_id: string;
  chunk_index: number;
  content: string;
  content_tokens: number | null;
  embedding: number[] | null;
  metadata: Record<string, any>;
  created_at: string;
}

// ============================================================
// Fase 11.D · Generated lesson questions (3 tipos)
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
  | { question_typ