-- ============================================================
-- STUD.IA - MIGRACIÓN INICIAL COMPLETA
-- Ejecutar en Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================

-- 0. EXTENSIONES NECESARIAS
create extension if not exists "uuid-ossp";

-- ============================================================
-- 1. TABLA DE PERFILES (extiende auth.users)
-- ============================================================
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  username text unique not null,
  full_name text,
  avatar_url text default 'default_tonito.svg',
  role text check (role in ('student', 'teacher', 'admin')) default 'student',
  
  -- Gamificación
  current_level integer default 1,
  total_xp integer default 0,
  coins integer default 0,
  current_hearts integer default 5,
  max_hearts integer default 5,
  last_heart_lost_at timestamp with time zone,
  streak_days integer default 0,
  last_activity_date date,
  last_login_at timestamp with time zone,
  
  -- Preferencias IA
  gemini_preferences jsonb default '{
    "tone": "encouraging",
    "difficulty": "adaptive",
    "interests": []
  }'::jsonb,
  
  -- Estado de Toñito
  tonito_state jsonb default '{
    "mood": "happy",
    "skin": "default",
    "last_interaction": null
  }'::jsonb,
  
  -- Timezone del usuario (para streaks)
  timezone text default 'America/Bogota',
  
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- Trigger para crear perfil automáticamente al registrarse
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'full_name', '')
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Trigger para updated_at automático
create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.update_updated_at();

-- ============================================================
-- 2. CLASES Y ENROLLMENTS (profesor <-> estudiante)
-- ============================================================
create table public.classrooms (
  id uuid default gen_random_uuid() primary key,
  teacher_id uuid references public.profiles(id) on delete cascade not null,
  name text not null,
  description text,
  join_code text unique default substr(md5(random()::text), 1, 8),
  is_active boolean default true,
  created_at timestamp with time zone default now()
);

create table public.class_enrollments (
  id uuid default gen_random_uuid() primary key,
  classroom_id uuid references public.classrooms(id) on delete cascade not null,
  student_id uuid references public.profiles(id) on delete cascade not null,
  teacher_id uuid references public.profiles(id) not null,
  enrolled_at timestamp with time zone default now(),
  unique(classroom_id, student_id)
);

-- ============================================================
-- 3. MÓDULOS DE CONTENIDO (gestión del profesor)
-- ============================================================
create table public.content_modules (
  id uuid default gen_random_uuid() primary key,
  teacher_id uuid references public.profiles(id) on delete set null,
  classroom_id uuid references public.classrooms(id) on delete cascade,
  
  title text not null,
  description text,
  category text not null, -- 'math', 'science', 'language', 'history', 'logic'
  difficulty_level integer check (difficulty_level between 1 and 10) default 1,
  content_type text check (content_type in ('reading', 'video', 'interactive', 'quiz', 'dialogue')) default 'quiz',
  
  -- Recursos
  resource_url text,
  resource_metadata jsonb default '{}'::jsonb,
  
  -- Configuración IA
  gemini_prompt_template text,
  
  -- Gamificación
  base_xp_reward integer default 10,
  estimated_time_minutes integer default 10,
  
  -- Estructura del mapa
  prerequisites uuid[] default '{}',
  order_index integer default 0,
  map_position_x float default 0,
  map_position_y float default 0,
  
  is_active boolean default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create trigger content_modules_updated_at
  before update on public.content_modules
  for each row execute procedure public.update_updated_at();

-- ============================================================
-- 4. PROGRESO DEL ESTUDIANTE
-- ============================================================
create table public.student_progress (
  id uuid default gen_random_uuid() primary key,
  student_id uuid references public.profiles(id) on delete cascade not null,
  module_id uuid references public.content_modules(id) on delete cascade not null,
  
  status text check (status in ('locked', 'available', 'in_progress', 'completed')) default 'locked',
  completion_percentage integer default 0 check (completion_percentage between 0 and 100),
  score integer check (score is null or (score >= 0 and score <= 100)),
  best_score integer default 0,
  attempts integer default 0,
  time_spent_seconds integer default 0,
  
  -- Historial IA
  gemini_feedback_history jsonb default '[]'::jsonb,
  
  -- Recompensas ganadas
  earned_xp integer default 0,
  earned_coins integer default 0,
  
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  last_attempt_at timestamp with time zone,
  
  unique(student_id, module_id)
);

-- ============================================================
-- 5. PREGUNTAS GENERADAS (cache de Gemini)
-- ============================================================
create table public.generated_questions (
  id uuid default gen_random_uuid() primary key,
  module_id uuid references public.content_modules(id) on delete cascade not null,
  content_hash text not null, -- hash del contenido para detectar cambios
  
  question_text text not null,
  question_type text check (question_type in ('multiple_choice', 'true_false', 'fill_blank')) default 'multiple_choice',
  options jsonb not null, -- ["opción A", "opción B", "opción C", "opción D"]
  correct_index integer not null, -- índice de la respuesta correcta
  explanation text, -- explicación de por qué es correcta
  difficulty integer check (difficulty between 1 and 10),
  
  times_served integer default 0,
  avg_correct_rate float default 0,
  
  created_at timestamp with time zone default now(),
  expires_at timestamp with time zone default (now() + interval '24 hours')
);

create index idx_questions_module_hash on public.generated_questions(module_id, content_hash);

-- ============================================================
-- 6. SISTEMA DE LOGROS / BADGES
-- ============================================================
create table public.achievements (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  description text,
  icon_name text default 'trophy', -- nombre del icono Lucide
  color text default '#FFD700',
  
  criteria_type text check (criteria_type in (
    'xp_total', 'streak_days', 'modules_completed',
    'perfect_scores', 'specific_category', 'first_login',
    'coins_earned', 'time_spent'
  )) not null,
  criteria_value integer not null,
  criteria_category text, -- solo para 'specific_category'
  
  reward_coins integer default 0,
  reward_xp integer default 0,
  rarity text check (rarity in ('common', 'rare', 'epic', 'legendary')) default 'common',
  
  sort_order integer default 0,
  is_active boolean default true,
  created_at timestamp with time zone default now()
);

create table public.user_achievements (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  achievement_id uuid references public.achievements(id) on delete cascade not null,
  earned_at timestamp with time zone default now(),
  seen_by_user boolean default false,
  unique(user_id, achievement_id)
);

-- ============================================================
-- 7. TIENDA Y ECONOMÍA
-- ============================================================
create table public.shop_items (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  description text,
  type text check (type in ('avatar_skin', 'tonito_customization', 'power_up', 'streak_freeze')) not null,
  cost_coins integer not null,
  
  effect_data jsonb default '{}'::jsonb,
  image_url text,
  preview_color text, -- color hex para preview rápido
  
  duration_minutes integer, -- null = permanente
  is_consumable boolean default false,
  is_active boolean default true,
  sort_order integer default 0,
  
  created_at timestamp with time zone default now()
);

create table public.user_inventory (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  item_id uuid references public.shop_items(id) on delete cascade not null,
  
  purchased_at timestamp with time zone default now(),
  activated_at timestamp with time zone,
  expires_at timestamp with time zone,
  is_active boolean default false,
  is_consumed boolean default false
);

-- ============================================================
-- 8. MISIONES DIARIAS
-- ============================================================
create table public.daily_missions (
  id uuid default gen_random_uuid() primary key,
  title text not null,
  description text,
  icon_name text default 'target',
  
  mission_type text check (mission_type in (
    'complete_modules', 'earn_xp', 'maintain_streak',
    'perfect_score', 'time_spent', 'answer_questions'
  )) not null,
  target_value integer not null,
  
  reward_coins integer default 0,
  reward_xp integer default 0,
  
  -- Rotación: null = siempre disponible
  valid_from date,
  valid_until date,
  
  is_active boolean default true,
  created_at timestamp with time zone default now()
);

create table public.user_missions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  mission_id uuid references public.daily_missions(id) on delete cascade not null,
  assigned_date date default current_date,
  
  current_progress integer default 0,
  is_completed boolean default false,
  completed_at timestamp with time zone,
  rewards_claimed boolean default false,
  
  unique(user_id, mission_id, assigned_date)
);

-- ============================================================
-- 9. LEADERBOARDS SEMANALES
-- ============================================================
create table public.weekly_leaderboards (
  id uuid default gen_random_uuid() primary key,
  week_start_date date not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  classroom_id uuid references public.classrooms(id) on delete cascade,
  
  xp_earned_week integer default 0,
  modules_completed_week integer default 0,
  rank_position integer,
  
  updated_at timestamp with time zone default now(),
  unique(week_start_date, user_id, classroom_id)
);

-- ============================================================
-- 10. HISTORIAL DE CHAT CON TOÑITO
-- ============================================================
create table public.tonito_conversations (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  module_id uuid references public.content_modules(id) on delete set null,
  
  role text check (role in ('user', 'tonito')) not null,
  message text not null,
  interaction_type text check (interaction_type in (
    'chat', 'question', 'feedback', 'encouragement', 'hint'
  )) default 'chat',
  
  metadata jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now()
);

create index idx_tonito_conv_user on public.tonito_conversations(user_id, created_at desc);

-- ============================================================
-- 11. ÍNDICES DE RENDIMIENTO
-- ============================================================
create index idx_profiles_role on public.profiles(role);
create index idx_progress_student on public.student_progress(student_id);
create index idx_progress_module on public.student_progress(module_id);
create index idx_progress_status on public.student_progress(student_id, status);
create index idx_modules_classroom on public.content_modules(classroom_id, order_index);
create index idx_enrollments_student on public.class_enrollments(student_id);
create index idx_enrollments_teacher on public.class_enrollments(teacher_id);
create index idx_leaderboard_week on public.weekly_leaderboards(week_start_date, classroom_id, xp_earned_week desc);
create index idx_user_missions_date on public.user_missions(user_id, assigned_date);
create index idx_user_achievements_user on public.user_achievements(user_id);

-- ============================================================
-- 12. ROW LEVEL SECURITY (RLS)
-- ============================================================

-- Activar RLS en todas las tablas
alter table public.profiles enable row level security;
alter table public.classrooms enable row level security;
alter table public.class_enrollments enable row level security;
alter table public.content_modules enable row level security;
alter table public.student_progress enable row level security;
alter table public.generated_questions enable row level security;
alter table public.achievements enable row level security;
alter table public.user_achievements enable row level security;
alter table public.shop_items enable row level security;
alter table public.user_inventory enable row level security;
alter table public.daily_missions enable row level security;
alter table public.user_missions enable row level security;
alter table public.weekly_leaderboards enable row level security;
alter table public.tonito_conversations enable row level security;

-- PROFILES
create policy "Usuarios ven su propio perfil"
  on public.profiles for select using (auth.uid() = id);

create policy "Usuarios actualizan su propio perfil"
  on public.profiles for update using (auth.uid() = id);

create policy "Teachers ven perfiles de sus estudiantes"
  on public.profiles for select using (
    id in (
      select student_id from public.class_enrollments
      where teacher_id = auth.uid()
    )
  );

-- CLASSROOMS
create policy "Teachers manejan sus clases"
  on public.classrooms for all using (teacher_id = auth.uid());

create policy "Students ven sus clases inscritas"
  on public.classrooms for select using (
    id in (
      select classroom_id from public.class_enrollments
      where student_id = auth.uid()
    )
  );

-- ENROLLMENTS
create policy "Teachers ven enrollments de sus clases"
  on public.class_enrollments for select using (teacher_id = auth.uid());

create policy "Students ven su propio enrollment"
  on public.class_enrollments for select using (student_id = auth.uid());

create policy "Students pueden inscribirse"
  on public.class_enrollments for insert with check (student_id = auth.uid());

-- CONTENT MODULES
create policy "Teachers manejan su contenido"
  on public.content_modules for all using (teacher_id = auth.uid());

create policy "Students ven módulos de sus clases"
  on public.content_modules for select using (
    classroom_id in (
      select classroom_id from public.class_enrollments
      where student_id = auth.uid()
    )
    or classroom_id is null -- módulos globales
  );

-- STUDENT PROGRESS
create policy "Students manejan su progreso"
  on public.student_progress for all using (student_id = auth.uid());

create policy "Teachers ven progreso de sus estudiantes"
  on public.student_progress for select using (
    student_id in (
      select student_id from public.class_enrollments
      where teacher_id = auth.uid()
    )
  );

-- GENERATED QUESTIONS (lectura para todos los autenticados)
create policy "Autenticados leen preguntas"
  on public.generated_questions for select using (auth.role() = 'authenticated');

-- ACHIEVEMENTS (lectura pública)
create policy "Todos ven achievements"
  on public.achievements for select using (true);

-- USER ACHIEVEMENTS
create policy "Users ven sus logros"
  on public.user_achievements for select using (user_id = auth.uid());

-- SHOP ITEMS (lectura pública)
create policy "Todos ven la tienda"
  on public.shop_items for select using (is_active = true);

-- USER INVENTORY
create policy "Users manejan su inventario"
  on public.user_inventory for all using (user_id = auth.uid());

-- DAILY MISSIONS (lectura pública)
create policy "Todos ven misiones"
  on public.daily_missions for select using (is_active = true);

-- USER MISSIONS
create policy "Users manejan sus misiones"
  on public.user_missions for all using (user_id = auth.uid());

-- LEADERBOARDS (lectura para compañeros de clase)
create policy "Users ven leaderboards de sus clases"
  on public.weekly_leaderboards for select using (
    classroom_id in (
      select classroom_id from public.class_enrollments
      where student_id = auth.uid()
    )
    or user_id = auth.uid()
  );

-- TONITO CONVERSATIONS
create policy "Users manejan sus conversaciones"
  on public.tonito_conversations for all using (user_id = auth.uid());

-- ============================================================
-- 13. FUNCIONES ÚTILES
-- ============================================================

-- Función para calcular XP con multiplicadores
create or replace function public.calculate_xp(
  p_base_xp integer,
  p_streak_days integer,
  p_difficulty integer,
  p_score integer,
  p_attempts integer,
  p_time_seconds integer,
  p_estimated_minutes integer
) returns integer as $$
declare
  total float;
  streak_mult float;
  diff_mult float;
begin
  total := p_base_xp;
  
  -- Speed bonus: completó en menos del 50% del tiempo estimado
  if p_estimated_minutes > 0 and p_time_seconds < (p_estimated_minutes * 30) then
    total := total * 1.25;
  end if;
  
  -- Streak bonus: 1.0 + (days * 0.1), máximo 2.0x
  streak_mult := least(1.0 + (p_streak_days * 0.1), 2.0);
  total := total * streak_mult;
  
  -- Difficulty bonus: 1.0 a 1.5x
  diff_mult := 1.0 + ((p_difficulty - 1) * 0.055); -- nivel 10 = 1.5x
  total := total * diff_mult;
  
  -- Perfect score bonus
  if p_score = 100 then
    total := total * 1.5;
  end if;
  
  -- First try bonus
  if p_attempts = 1 then
    total := total * 1.2;
  end if;
  
  return floor(total);
end;
$$ language plpgsql immutable;

-- Función para verificar y actualizar streak
create or replace function public.check_and_update_streak(p_user_id uuid)
returns jsonb as $$
declare
  v_profile public.profiles;
  v_today date;
  v_result jsonb;
begin
  select * into v_profile from public.profiles where id = p_user_id;
  v_today := (now() at time zone coalesce(v_profile.timezone, 'America/Bogota'))::date;
  
  if v_profile.last_activity_date = v_today then
    -- Ya registró actividad hoy
    v_result := jsonb_build_object('streak', v_profile.streak_days, 'action', 'none');
  elsif v_profile.last_activity_date = v_today - 1 then
    -- Actividad ayer → incrementar streak
    update public.profiles
    set streak_days = streak_days + 1,
        last_activity_date = v_today
    where id = p_user_id;
    v_result := jsonb_build_object('streak', v_profile.streak_days + 1, 'action', 'incremented');
  elsif v_profile.last_activity_date >= v_today - 2 then
    -- Ventana de gracia (48h) → mantener pero no incrementar
    update public.profiles
    set last_activity_date = v_today
    where id = p_user_id;
    v_result := jsonb_build_object('streak', v_profile.streak_days, 'action', 'grace_period');
  else
    -- Más de 48h → verificar streak freeze
    if exists (
      select 1 from public.user_inventory ui
      join public.shop_items si on ui.item_id = si.id
      where ui.user_id = p_user_id
        and si.type = 'streak_freeze'
        and ui.is_consumed = false
      limit 1
    ) then
      -- Consumir streak freeze
      update public.user_inventory
      set is_consumed = true, activated_at = now()
      where id = (
        select ui.id from public.user_inventory ui
        join public.shop_items si on ui.item_id = si.id
        where ui.user_id = p_user_id
          and si.type = 'streak_freeze'
          and ui.is_consumed = false
        limit 1
      );
      update public.profiles set last_activity_date = v_today where id = p_user_id;
      v_result := jsonb_build_object('streak', v_profile.streak_days, 'action', 'freeze_used');
    else
      -- Reset streak
      update public.profiles
      set streak_days = 1, last_activity_date = v_today
      where id = p_user_id;
      v_result := jsonb_build_object('streak', 1, 'action', 'reset');
    end if;
  end if;
  
  return v_result;
end;
$$ language plpgsql security definer;

-- Función para recuperar corazones
create or replace function public.recover_hearts(p_user_id uuid)
returns integer as $$
declare
  v_profile public.profiles;
  v_hours_elapsed float;
  v_hearts_to_recover integer;
  v_new_hearts integer;
begin
  select * into v_profile from public.profiles where id = p_user_id;
  
  if v_profile.current_hearts >= v_profile.max_hearts then
    return v_profile.current_hearts;
  end if;
  
  if v_profile.last_heart_lost_at is null then
    return v_profile.current_hearts;
  end if;
  
  v_hours_elapsed := extract(epoch from (now() - v_profile.last_heart_lost_at)) / 3600.0;
  v_hearts_to_recover := floor(v_hours_elapsed / 4.0)::integer;
  
  if v_hearts_to_recover > 0 then
    v_new_hearts := least(v_profile.current_hearts + v_hearts_to_recover, v_profile.max_hearts);
    update public.profiles
    set current_hearts = v_new_hearts,
        last_heart_lost_at = case
          when v_new_hearts >= max_hearts then null
          else last_heart_lost_at + (v_hearts_to_recover * interval '4 hours')
        end
    where id = p_user_id;
    return v_new_hearts;
  end if;
  
  return v_profile.current_hearts;
end;
$$ language plpgsql security definer;
