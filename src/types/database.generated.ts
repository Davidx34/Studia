// Generado por: npx supabase gen types typescript --project-id roulrdmxsazjkczxkzax
// (o el equivalente MCP generate_typescript_types). NO EDITAR A MANO — este
// archivo es el reflejo exacto del schema real de Supabase. Regenerar tras
// cada migración que agregue/cambie tablas o columnas.
//
// src/types/database.ts importa de aquí y agrega tipos de conveniencia
// (uniones literales para columnas CHECK-constrained, interfaces con nombre
// legible) — edita ESE archivo para ajustar tipos de la app, no este.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      achievements: {
        Row: {
          color: string | null
          created_at: string | null
          criteria_category: string | null
          criteria_type: string
          criteria_value: number
          description: string | null
          icon_name: string | null
          id: string
          is_active: boolean | null
          name: string
          rarity: string | null
          reward_coins: number | null
          reward_xp: number | null
          sort_order: number | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          criteria_category?: string | null
          criteria_type: string
          criteria_value: number
          description?: string | null
          icon_name?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          rarity?: string | null
          reward_coins?: number | null
          reward_xp?: number | null
          sort_order?: number | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          criteria_category?: string | null
          criteria_type?: string
          criteria_value?: number
          description?: string | null
          icon_name?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          rarity?: string | null
          reward_coins?: number | null
          reward_xp?: number | null
          sort_order?: number | null
        }
        Relationships: []
      }
      class_enrollments: {
        Row: {
          classroom_id: string
          enrolled_at: string | null
          id: string
          student_id: string
          teacher_id: string
        }
        Insert: {
          classroom_id: string
          enrolled_at?: string | null
          id?: string
          student_id: string
          teacher_id: string
        }
        Update: {
          classroom_id?: string
          enrolled_at?: string | null
          id?: string
          student_id?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_enrollments_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_enrollments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_enrollments_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      classroom_ai_config: {
        Row: {
          classroom_id: string
          created_at: string | null
          custom_instructions: string | null
          example_bad_question: string | null
          example_good_question: string | null
          grade_level_detail: string | null
          id: string
          language_level: string | null
          learning_objectives: string | null
          question_depth: number | null
          question_style: string | null
          skill_analysis: boolean | null
          skill_application: boolean | null
          skill_comprehension: boolean | null
          skill_evaluation: boolean | null
          skill_memory: boolean | null
          skill_synthesis: boolean | null
          subject_description: string | null
          teacher_id: string
          topics_avoid: string | null
          topics_emphasize: string | null
          type_fill_blank: boolean | null
          type_match: boolean | null
          type_multiple_choice: boolean | null
          type_order: boolean | null
          type_short_answer: boolean | null
          type_true_false: boolean | null
          updated_at: string | null
        }
        Insert: {
          classroom_id: string
          created_at?: string | null
          custom_instructions?: string | null
          example_bad_question?: string | null
          example_good_question?: string | null
          grade_level_detail?: string | null
          id?: string
          language_level?: string | null
          learning_objectives?: string | null
          question_depth?: number | null
          question_style?: string | null
          skill_analysis?: boolean | null
          skill_application?: boolean | null
          skill_comprehension?: boolean | null
          skill_evaluation?: boolean | null
          skill_memory?: boolean | null
          skill_synthesis?: boolean | null
          subject_description?: string | null
          teacher_id: string
          topics_avoid?: string | null
          topics_emphasize?: string | null
          type_fill_blank?: boolean | null
          type_match?: boolean | null
          type_multiple_choice?: boolean | null
          type_order?: boolean | null
          type_short_answer?: boolean | null
          type_true_false?: boolean | null
          updated_at?: string | null
        }
        Update: {
          classroom_id?: string
          created_at?: string | null
          custom_instructions?: string | null
          example_bad_question?: string | null
          example_good_question?: string | null
          grade_level_detail?: string | null
          id?: string
          language_level?: string | null
          learning_objectives?: string | null
          question_depth?: number | null
          question_style?: string | null
          skill_analysis?: boolean | null
          skill_application?: boolean | null
          skill_comprehension?: boolean | null
          skill_evaluation?: boolean | null
          skill_memory?: boolean | null
          skill_synthesis?: boolean | null
          subject_description?: string | null
          teacher_id?: string
          topics_avoid?: string | null
          topics_emphasize?: string | null
          type_fill_blank?: boolean | null
          type_match?: boolean | null
          type_multiple_choice?: boolean | null
          type_order?: boolean | null
          type_short_answer?: boolean | null
          type_true_false?: boolean | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "classroom_ai_config_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: true
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classroom_ai_config_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      classroom_concepts: {
        Row: {
          classroom_id: string
          created_at: string
          id: string
          label: string
          module_id: string
          tag: string
        }
        Insert: {
          classroom_id: string
          created_at?: string
          id?: string
          label: string
          module_id: string
          tag: string
        }
        Update: {
          classroom_id?: string
          created_at?: string
          id?: string
          label?: string
          module_id?: string
          tag?: string
        }
        Relationships: [
          {
            foreignKeyName: "classroom_concepts_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classroom_concepts_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "content_modules"
            referencedColumns: ["id"]
          },
        ]
      }
      classroom_learning_objectives: {
        Row: {
          classroom_id: string
          created_at: string
          description: string | null
          difficulty_level: number
          expected_duration_weeks: number
          id: string
          teacher_id: string
          title: string
          updated_at: string
        }
        Insert: {
          classroom_id: string
          created_at?: string
          description?: string | null
          difficulty_level?: number
          expected_duration_weeks?: number
          id?: string
          teacher_id: string
          title: string
          updated_at?: string
        }
        Update: {
          classroom_id?: string
          created_at?: string
          description?: string | null
          difficulty_level?: number
          expected_duration_weeks?: number
          id?: string
          teacher_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "classroom_learning_objectives_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classroom_learning_objectives_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      classrooms: {
        Row: {
          created_at: string | null
          description: string | null
          grade_level: string | null
          id: string
          is_active: boolean | null
          join_code: string | null
          name: string
          subject_area: string | null
          teacher_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          grade_level?: string | null
          id?: string
          is_active?: boolean | null
          join_code?: string | null
          name: string
          subject_area?: string | null
          teacher_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          grade_level?: string | null
          id?: string
          is_active?: boolean | null
          join_code?: string | null
          name?: string
          subject_area?: string | null
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "classrooms_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      content_modules: {
        Row: {
          auto_generated: boolean | null
          base_xp_reward: number | null
          category: string
          classroom_id: string | null
          configured_question_count: number | null
          content_type: string | null
          created_at: string | null
          description: string | null
          difficulty_level: number | null
          estimated_time_minutes: number | null
          gemini_prompt_template: string | null
          id: string
          is_active: boolean | null
          learning_objective_id: string | null
          map_position_x: number | null
          map_position_y: number | null
          minigame_types: string[] | null
          order_in_objective: number | null
          order_index: number | null
          prerequisites: string[] | null
          resource_metadata: Json | null
          resource_url: string | null
          source_material_ids: string[] | null
          teacher_id: string | null
          title: string
          topic_keywords: string[] | null
          updated_at: string | null
        }
        Insert: {
          auto_generated?: boolean | null
          base_xp_reward?: number | null
          category: string
          classroom_id?: string | null
          configured_question_count?: number | null
          content_type?: string | null
          created_at?: string | null
          description?: string | null
          difficulty_level?: number | null
          estimated_time_minutes?: number | null
          gemini_prompt_template?: string | null
          id?: string
          is_active?: boolean | null
          learning_objective_id?: string | null
          map_position_x?: number | null
          map_position_y?: number | null
          minigame_types?: string[] | null
          order_in_objective?: number | null
          order_index?: number | null
          prerequisites?: string[] | null
          resource_metadata?: Json | null
          resource_url?: string | null
          source_material_ids?: string[] | null
          teacher_id?: string | null
          title: string
          topic_keywords?: string[] | null
          updated_at?: string | null
        }
        Update: {
          auto_generated?: boolean | null
          base_xp_reward?: number | null
          category?: string
          classroom_id?: string | null
          configured_question_count?: number | null
          content_type?: string | null
          created_at?: string | null
          description?: string | null
          difficulty_level?: number | null
          estimated_time_minutes?: number | null
          gemini_prompt_template?: string | null
          id?: string
          is_active?: boolean | null
          learning_objective_id?: string | null
          map_position_x?: number | null
          map_position_y?: number | null
          minigame_types?: string[] | null
          order_in_objective?: number | null
          order_index?: number | null
          prerequisites?: string[] | null
          resource_metadata?: Json | null
          resource_url?: string | null
          source_material_ids?: string[] | null
          teacher_id?: string | null
          title?: string
          topic_keywords?: string[] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_modules_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_modules_learning_objective_id_fkey"
            columns: ["learning_objective_id"]
            isOneToOne: false
            referencedRelation: "classroom_learning_objectives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_modules_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_missions: {
        Row: {
          created_at: string | null
          description: string | null
          icon_name: string | null
          id: string
          is_active: boolean | null
          mission_type: string
          reward_coins: number | null
          reward_xp: number | null
          target_value: number
          title: string
          valid_from: string | null
          valid_until: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          icon_name?: string | null
          id?: string
          is_active?: boolean | null
          mission_type: string
          reward_coins?: number | null
          reward_xp?: number | null
          target_value: number
          title: string
          valid_from?: string | null
          valid_until?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          icon_name?: string | null
          id?: string
          is_active?: boolean | null
          mission_type?: string
          reward_coins?: number | null
          reward_xp?: number | null
          target_value?: number
          title?: string
          valid_from?: string | null
          valid_until?: string | null
        }
        Relationships: []
      }
      generated_questions: {
        Row: {
          avg_correct_rate: number | null
          content_hash: string
          correct_index: number
          created_at: string | null
          difficulty: number | null
          expires_at: string | null
          explanation: string | null
          id: string
          module_id: string
          options: Json
          question_text: string
          question_type: string | null
          times_served: number | null
        }
        Insert: {
          avg_correct_rate?: number | null
          content_hash: string
          correct_index: number
          created_at?: string | null
          difficulty?: number | null
          expires_at?: string | null
          explanation?: string | null
          id?: string
          module_id: string
          options: Json
          question_text: string
          question_type?: string | null
          times_served?: number | null
        }
        Update: {
          avg_correct_rate?: number | null
          content_hash?: string
          correct_index?: number
          created_at?: string | null
          difficulty?: number | null
          expires_at?: string | null
          explanation?: string | null
          id?: string
          module_id?: string
          options?: Json
          question_text?: string
          question_type?: string | null
          times_served?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "generated_questions_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "content_modules"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_generations: {
        Row: {
          classroom_id: string
          created_at: string | null
          difficulty_level: number
          expires_at: string | null
          id: string
          materials_version_hash: string
          module_id: string
          outline: Json
        }
        Insert: {
          classroom_id: string
          created_at?: string | null
          difficulty_level: number
          expires_at?: string | null
          id?: string
          materials_version_hash: string
          module_id: string
          outline: Json
        }
        Update: {
          classroom_id?: string
          created_at?: string | null
          difficulty_level?: number
          expires_at?: string | null
          id?: string
          materials_version_hash?: string
          module_id?: string
          outline?: Json
        }
        Relationships: [
          {
            foreignKeyName: "lesson_generations_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_generations_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "content_modules"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_questions: {
        Row: {
          answers: string[] | null
          backup_pool_size: number
          concept_tag: string | null
          created_at: string
          exp: string | null
          game_data: Json | null
          game_type: string | null
          id: string
          is_backup: boolean
          keywords: string[] | null
          module_id: string
          ok: Json | null
          opts: Json | null
          pairs: Json | null
          q: string
          review_status: string
          type: string
        }
        Insert: {
          answers?: string[] | null
          backup_pool_size?: number
          concept_tag?: string | null
          created_at?: string
          exp?: string | null
          game_data?: Json | null
          game_type?: string | null
          id?: string
          is_backup?: boolean
          keywords?: string[] | null
          module_id: string
          ok?: Json | null
          opts?: Json | null
          pairs?: Json | null
          q: string
          review_status?: string
          type: string
        }
        Update: {
          answers?: string[] | null
          backup_pool_size?: number
          concept_tag?: string | null
          created_at?: string
          exp?: string | null
          game_data?: Json | null
          game_type?: string | null
          id?: string
          is_backup?: boolean
          keywords?: string[] | null
          module_id?: string
          ok?: Json | null
          opts?: Json | null
          pairs?: Json | null
          q?: string
          review_status?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_questions_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "content_modules"
            referencedColumns: ["id"]
          },
        ]
      }
      material_chunks: {
        Row: {
          chunk_index: number
          content: string
          content_tokens: number | null
          created_at: string | null
          embedding: string | null
          id: string
          material_id: string
          metadata: Json | null
        }
        Insert: {
          chunk_index: number
          content: string
          content_tokens?: number | null
          created_at?: string | null
          embedding?: string | null
          id?: string
          material_id: string
          metadata?: Json | null
        }
        Update: {
          chunk_index?: number
          content?: string
          content_tokens?: number | null
          created_at?: string | null
          embedding?: string | null
          id?: string
          material_id?: string
          metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "material_chunks_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "teaching_materials"
            referencedColumns: ["id"]
          },
        ]
      }
      material_chunks_processed: {
        Row: {
          chunk_id: string
          id: string
          key_points: string[]
          main_concepts: string[]
          material_id: string
          processed_at: string
          summary: string
        }
        Insert: {
          chunk_id: string
          id?: string
          key_points?: string[]
          main_concepts?: string[]
          material_id: string
          processed_at?: string
          summary: string
        }
        Update: {
          chunk_id?: string
          id?: string
          key_points?: string[]
          main_concepts?: string[]
          material_id?: string
          processed_at?: string
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "material_chunks_processed_chunk_id_fkey"
            columns: ["chunk_id"]
            isOneToOne: true
            referencedRelation: "material_chunks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_chunks_processed_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "teaching_materials"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_enrollments: {
        Row: {
          classroom_id: string
          email: string
          id: string
          invited_at: string | null
          teacher_id: string
        }
        Insert: {
          classroom_id: string
          email: string
          id?: string
          invited_at?: string | null
          teacher_id: string
        }
        Update: {
          classroom_id?: string
          email?: string
          id?: string
          invited_at?: string | null
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_enrollments_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_enrollments_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_registrations: {
        Row: {
          created_at: string
          email: string
          id: string
          role: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          role: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          role?: string
          used_at?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          coins: number | null
          created_at: string
          current_hearts: number | null
          current_level: number | null
          email: string | null
          full_name: string | null
          gemini_preferences: Json | null
          id: string
          last_activity_date: string | null
          last_heart_lost_at: string | null
          last_login_at: string | null
          max_hearts: number | null
          role: string | null
          streak_days: number | null
          timezone: string | null
          tonito_state: Json | null
          total_xp: number | null
          updated_at: string
          username: string
        }
        Insert: {
          avatar_url?: string | null
          coins?: number | null
          created_at?: string
          current_hearts?: number | null
          current_level?: number | null
          email?: string | null
          full_name?: string | null
          gemini_preferences?: Json | null
          id: string
          last_activity_date?: string | null
          last_heart_lost_at?: string | null
          last_login_at?: string | null
          max_hearts?: number | null
          role?: string | null
          streak_days?: number | null
          timezone?: string | null
          tonito_state?: Json | null
          total_xp?: number | null
          updated_at?: string
          username: string
        }
        Update: {
          avatar_url?: string | null
          coins?: number | null
          created_at?: string
          current_hearts?: number | null
          current_level?: number | null
          email?: string | null
          full_name?: string | null
          gemini_preferences?: Json | null
          id?: string
          last_activity_date?: string | null
          last_heart_lost_at?: string | null
          last_login_at?: string | null
          max_hearts?: number | null
          role?: string | null
          streak_days?: number | null
          timezone?: string | null
          tonito_state?: Json | null
          total_xp?: number | null
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      question_attempts: {
        Row: {
          answer_given: Json | null
          attempted_at: string
          classroom_id: string
          concept_tag: string | null
          game_metadata: Json | null
          game_type: string | null
          id: string
          module_id: string
          question_id: string
          student_id: string
          was_correct: boolean
        }
        Insert: {
          answer_given?: Json | null
          attempted_at?: string
          classroom_id: string
          concept_tag?: string | null
          game_metadata?: Json | null
          game_type?: string | null
          id?: string
          module_id: string
          question_id: string
          student_id: string
          was_correct: boolean
        }
        Update: {
          answer_given?: Json | null
          attempted_at?: string
          classroom_id?: string
          concept_tag?: string | null
          game_metadata?: Json | null
          game_type?: string | null
          id?: string
          module_id?: string
          question_id?: string
          student_id?: string
          was_correct?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "question_attempts_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_attempts_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "content_modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_attempts_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "lesson_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_attempts_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      remediation_plans: {
        Row: {
          classroom_id: string
          completed_at: string | null
          created_at: string
          created_by: string
          id: string
          modules_completed: number
          modules_target: number
          status: string
          student_id: string
          target_concepts: string[]
          title: string
        }
        Insert: {
          classroom_id: string
          completed_at?: string | null
          created_at?: string
          created_by: string
          id?: string
          modules_completed?: number
          modules_target?: number
          status?: string
          student_id: string
          target_concepts: string[]
          title: string
        }
        Update: {
          classroom_id?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string
          id?: string
          modules_completed?: number
          modules_target?: number
          status?: string
          student_id?: string
          target_concepts?: string[]
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "remediation_plans_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remediation_plans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remediation_plans_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_items: {
        Row: {
          cost_coins: number
          created_at: string | null
          description: string | null
          duration_minutes: number | null
          effect_data: Json | null
          id: string
          image_url: string | null
          is_active: boolean | null
          is_consumable: boolean | null
          name: string
          preview_color: string | null
          sort_order: number | null
          type: string
        }
        Insert: {
          cost_coins: number
          created_at?: string | null
          description?: string | null
          duration_minutes?: number | null
          effect_data?: Json | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          is_consumable?: boolean | null
          name: string
          preview_color?: string | null
          sort_order?: number | null
          type: string
        }
        Update: {
          cost_coins?: number
          created_at?: string | null
          description?: string | null
          duration_minutes?: number | null
          effect_data?: Json | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          is_consumable?: boolean | null
          name?: string
          preview_color?: string | null
          sort_order?: number | null
          type?: string
        }
        Relationships: []
      }
      student_progress: {
        Row: {
          attempts: number | null
          best_score: number | null
          completed_at: string | null
          completion_percentage: number | null
          earned_coins: number | null
          earned_xp: number | null
          gemini_feedback_history: Json | null
          id: string
          last_attempt_at: string | null
          module_id: string
          score: number | null
          started_at: string | null
          status: string | null
          student_id: string
          time_spent_seconds: number | null
        }
        Insert: {
          attempts?: number | null
          best_score?: number | null
          completed_at?: string | null
          completion_percentage?: number | null
          earned_coins?: number | null
          earned_xp?: number | null
          gemini_feedback_history?: Json | null
          id?: string
          last_attempt_at?: string | null
          module_id: string
          score?: number | null
          started_at?: string | null
          status?: string | null
          student_id: string
          time_spent_seconds?: number | null
        }
        Update: {
          attempts?: number | null
          best_score?: number | null
          completed_at?: string | null
          completion_percentage?: number | null
          earned_coins?: number | null
          earned_xp?: number | null
          gemini_feedback_history?: Json | null
          id?: string
          last_attempt_at?: string | null
          module_id?: string
          score?: number | null
          started_at?: string | null
          status?: string | null
          student_id?: string
          time_spent_seconds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "student_progress_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "content_modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_progress_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_remediations: {
        Row: {
          bonus_xp_earned: number
          classroom_id: string
          completed_at: string | null
          concept_tags: string[]
          created_at: string
          id: string
          module_id: string
          score_percent: number | null
          student_id: string
          was_accepted: boolean
          was_completed: boolean
          was_offered: boolean
        }
        Insert: {
          bonus_xp_earned?: number
          classroom_id: string
          completed_at?: string | null
          concept_tags: string[]
          created_at?: string
          id?: string
          module_id: string
          score_percent?: number | null
          student_id: string
          was_accepted?: boolean
          was_completed?: boolean
          was_offered?: boolean
        }
        Update: {
          bonus_xp_earned?: number
          classroom_id?: string
          completed_at?: string | null
          concept_tags?: string[]
          created_at?: string
          id?: string
          module_id?: string
          score_percent?: number | null
          student_id?: string
          was_accepted?: boolean
          was_completed?: boolean
          was_offered?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "student_remediations_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_remediations_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "content_modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_remediations_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      study_notes: {
        Row: {
          created_at: string
          id: string
          material_id: string
          notes_content: string
          student_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          material_id: string
          notes_content?: string
          student_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          material_id?: string
          notes_content?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "study_notes_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "teaching_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "study_notes_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teaching_materials: {
        Row: {
          auto_retry_count: number
          chunk_count: number | null
          classroom_id: string
          content_hash: string | null
          created_at: string | null
          display_name: string | null
          duration_seconds: number | null
          estimated_difficulty: number | null
          external_favicon: string | null
          external_title: string | null
          external_url: string | null
          extracted_text: string | null
          extracted_text_preview: string | null
          filename: string
          id: string
          mime_type: string | null
          processed_at: string | null
          processing_error: string | null
          processing_status: string
          size_bytes: number | null
          source_type: string
          storage_path: string | null
          teacher_id: string
          thumbnail_url: string | null
          topics_detected: string[] | null
          transcript_source: string | null
          updated_at: string | null
          version: number
          youtube_video_id: string | null
        }
        Insert: {
          auto_retry_count?: number
          chunk_count?: number | null
          classroom_id: string
          content_hash?: string | null
          created_at?: string | null
          display_name?: string | null
          duration_seconds?: number | null
          estimated_difficulty?: number | null
          external_favicon?: string | null
          external_title?: string | null
          external_url?: string | null
          extracted_text?: string | null
          extracted_text_preview?: string | null
          filename: string
          id?: string
          mime_type?: string | null
          processed_at?: string | null
          processing_error?: string | null
          processing_status?: string
          size_bytes?: number | null
          source_type?: string
          storage_path?: string | null
          teacher_id: string
          thumbnail_url?: string | null
          topics_detected?: string[] | null
          transcript_source?: string | null
          updated_at?: string | null
          version?: number
          youtube_video_id?: string | null
        }
        Update: {
          auto_retry_count?: number
          chunk_count?: number | null
          classroom_id?: string
          content_hash?: string | null
          created_at?: string | null
          display_name?: string | null
          duration_seconds?: number | null
          estimated_difficulty?: number | null
          external_favicon?: string | null
          external_title?: string | null
          external_url?: string | null
          extracted_text?: string | null
          extracted_text_preview?: string | null
          filename?: string
          id?: string
          mime_type?: string | null
          processed_at?: string | null
          processing_error?: string | null
          processing_status?: string
          size_bytes?: number | null
          source_type?: string
          storage_path?: string | null
          teacher_id?: string
          thumbnail_url?: string | null
          topics_detected?: string[] | null
          transcript_source?: string | null
          updated_at?: string | null
          version?: number
          youtube_video_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "teaching_materials_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teaching_materials_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tonito_conversations: {
        Row: {
          created_at: string | null
          id: string
          interaction_type: string | null
          message: string
          metadata: Json | null
          module_id: string | null
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          interaction_type?: string | null
          message: string
          metadata?: Json | null
          module_id?: string | null
          role: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          interaction_type?: string | null
          message?: string
          metadata?: Json | null
          module_id?: string | null
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tonito_conversations_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "content_modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tonito_conversations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_achievements: {
        Row: {
          achievement_id: string
          earned_at: string | null
          id: string
          seen_by_user: boolean | null
          user_id: string
        }
        Insert: {
          achievement_id: string
          earned_at?: string | null
          id?: string
          seen_by_user?: boolean | null
          user_id: string
        }
        Update: {
          achievement_id?: string
          earned_at?: string | null
          id?: string
          seen_by_user?: boolean | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_achievements_achievement_id_fkey"
            columns: ["achievement_id"]
            isOneToOne: false
            referencedRelation: "achievements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_achievements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_inventory: {
        Row: {
          activated_at: string | null
          expires_at: string | null
          id: string
          is_active: boolean | null
          is_consumed: boolean | null
          item_id: string
          purchased_at: string | null
          user_id: string
        }
        Insert: {
          activated_at?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          is_consumed?: boolean | null
          item_id: string
          purchased_at?: string | null
          user_id: string
        }
        Update: {
          activated_at?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          is_consumed?: boolean | null
          item_id?: string
          purchased_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_inventory_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "shop_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_inventory_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_missions: {
        Row: {
          assigned_date: string | null
          completed_at: string | null
          current_progress: number | null
          id: string
          is_completed: boolean | null
          mission_id: string
          rewards_claimed: boolean | null
          user_id: string
        }
        Insert: {
          assigned_date?: string | null
          completed_at?: string | null
          current_progress?: number | null
          id?: string
          is_completed?: boolean | null
          mission_id: string
          rewards_claimed?: boolean | null
          user_id: string
        }
        Update: {
          assigned_date?: string | null
          completed_at?: string | null
          current_progress?: number | null
          id?: string
          is_completed?: boolean | null
          mission_id?: string
          rewards_claimed?: boolean | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_missions_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "daily_missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_missions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_leaderboards: {
        Row: {
          classroom_id: string | null
          id: string
          modules_completed_week: number | null
          rank_position: number | null
          updated_at: string | null
          user_id: string
          week_start_date: string
          xp_earned_week: number | null
        }
        Insert: {
          classroom_id?: string | null
          id?: string
          modules_completed_week?: number | null
          rank_position?: number | null
          updated_at?: string | null
          user_id: string
          week_start_date: string
          xp_earned_week?: number | null
        }
        Update: {
          classroom_id?: string | null
          id?: string
          modules_completed_week?: number | null
          rank_position?: number | null
          updated_at?: string | null
          user_id?: string
          week_start_date?: string
          xp_earned_week?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "weekly_leaderboards_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_leaderboards_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_pending_registration: { Args: { p_email: string }; Returns: string }
      calculate_xp: {
        Args: {
          p_attempts: number
          p_base_xp: number
          p_difficulty: number
          p_estimated_minutes: number
          p_score: number
          p_streak_days: number
          p_time_seconds: number
        }
        Returns: number
      }
      check_and_update_streak: { Args: { p_user_id: string }; Returns: Json }
      check_pending_registration: { Args: { p_email: string }; Returns: string }
      dev_add_pending_registration: {
        Args: { p_email: string; p_role: string }
        Returns: {
          created_at: string
          email: string
          id: string
          role: string
          used_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "pending_registrations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      dev_analytics_summary: { Args: never; Returns: Json }
      dev_delete_pending_registration: {
        Args: { p_id: string }
        Returns: undefined
      }
      dev_list_pending_registrations: {
        Args: never
        Returns: {
          created_at: string
          email: string
          id: string
          role: string
          used_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "pending_registrations"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      dev_list_recent_profiles: {
        Args: { p_limit?: number }
        Returns: {
          avatar_url: string | null
          coins: number | null
          created_at: string
          current_hearts: number | null
          current_level: number | null
          email: string | null
          full_name: string | null
          gemini_preferences: Json | null
          id: string
          last_activity_date: string | null
          last_heart_lost_at: string | null
          last_login_at: string | null
          max_hearts: number | null
          role: string | null
          streak_days: number | null
          timezone: string | null
          tonito_state: Json | null
          total_xp: number | null
          updated_at: string
          username: string
        }[]
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      evaluate_achievements: {
        Args: { p_user_id: string }
        Returns: {
          achievement_id: string
          name: string
          rarity: string
        }[]
      }
      get_class_concept_metrics: {
        Args: { p_classroom_id: string }
        Returns: {
          affected_students: number
          concept_tag: string
          error_count: number
          error_rate: number
          total_attempts: number
        }[]
      }
      get_concept_student_matrix: {
        Args: { p_classroom_id: string }
        Returns: {
          accuracy: number
          concept_tag: string
          correct: number
          student_id: string
          student_name: string
          total: number
        }[]
      }
      get_student_metrics: {
        Args: { p_classroom_id: string }
        Returns: {
          concepts_breakdown: Json
          correct_attempts: number
          overall_accuracy: number
          student_id: string
          student_name: string
          total_attempts: number
        }[]
      }
      invalidate_lesson_cache: {
        Args: { p_classroom_id: string }
        Returns: undefined
      }
      join_classroom_by_code: {
        Args: { p_join_code: string }
        Returns: {
          classroom_id: string
          classroom_name: string
        }[]
      }
      match_material_chunks: {
        Args: {
          classroom_id_filter: string
          match_count?: number
          query_embedding: string
        }
        Returns: {
          chunk_id: string
          content: string
          filename: string
          material_id: string
          metadata: Json
          similarity: number
        }[]
      }
      recover_hearts: { Args: { p_user_id: string }; Returns: number }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type TablesGenerated<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
