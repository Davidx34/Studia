-- ============================================================
-- STUD.IA - DATOS SEMILLA
-- Ejecutar DESPUÉS de la migración inicial
-- ============================================================

-- ============================================================
-- ACHIEVEMENTS / BADGES
-- ============================================================
insert into public.achievements (name, description, icon_name, color, criteria_type, criteria_value, criteria_category, reward_coins, reward_xp, rarity, sort_order) values
  ('Primeros Pasos', '¡Completaste tu primer módulo!', 'footprints', '#4ECDC4', 'modules_completed', 1, null, 50, 25, 'common', 1),
  ('Racha de 3', 'Mantén tu racha 3 días seguidos', 'flame', '#FF6B6B', 'streak_days', 3, null, 100, 50, 'common', 2),
  ('Racha de 7', '¡Una semana completa sin parar!', 'zap', '#FF9F43', 'streak_days', 7, null, 250, 100, 'rare', 3),
  ('Racha de 30', 'Un mes entero de dedicación. ¡Legendario!', 'crown', '#FFD700', 'streak_days', 30, null, 1000, 500, 'legendary', 4),
  ('Maestro de Matemáticas', 'Completa 5 módulos de matemáticas', 'calculator', '#6C5CE7', 'specific_category', 5, 'math', 200, 100, 'rare', 5),
  ('Científico Natural', 'Completa 5 módulos de ciencias', 'flask-conical', '#00D2D3', 'specific_category', 5, 'science', 200, 100, 'rare', 6),
  ('Historiador', 'Completa 5 módulos de historia', 'scroll', '#FDCB6E', 'specific_category', 5, 'history', 200, 100, 'rare', 7),
  ('Lingüista', 'Completa 5 módulos de lenguaje', 'book-open', '#E17055', 'specific_category', 5, 'language', 200, 100, 'rare', 8),
  ('Mente Lógica', 'Completa 5 módulos de pensamiento lógico', 'brain', '#A29BFE', 'specific_category', 5, 'logic', 200, 100, 'rare', 9),
  ('Perfeccionista', 'Obtén puntuación perfecta en 3 módulos', 'star', '#FFC312', 'perfect_scores', 3, null, 300, 150, 'epic', 10),
  ('Imparable', 'Acumula 1000 XP totales', 'rocket', '#6C5CE7', 'xp_total', 1000, null, 200, 0, 'rare', 11),
  ('Leyenda', 'Acumula 5000 XP totales', 'trophy', '#FFD700', 'xp_total', 5000, null, 500, 0, 'epic', 12),
  ('Primer Login', '¡Bienvenido a Stud.ia!', 'log-in', '#55EFC4', 'first_login', 1, null, 100, 0, 'common', 0);

-- ============================================================
-- TIENDA
-- ============================================================
insert into public.shop_items (name, description, type, cost_coins, effect_data, preview_color, is_consumable, sort_order) values
  -- Skins de Toñito
  ('Toñito Oceáno', 'Toñito con colores del mar profundo', 'tonito_customization', 200,
   '{"gradient": ["#0652DD", "#1B9CFC"], "particles": "bubbles"}'::jsonb,
   '#0652DD', false, 1),
  ('Toñito Lava', 'Toñito ardiente como un volcán', 'tonito_customization', 200,
   '{"gradient": ["#EA2027", "#F79F1F"], "particles": "fire"}'::jsonb,
   '#EA2027', false, 2),
  ('Toñito Bosque', 'Toñito con la calma de la naturaleza', 'tonito_customization', 200,
   '{"gradient": ["#009432", "#A3CB38"], "particles": "leaves"}'::jsonb,
   '#009432', false, 3),
  ('Toñito Galaxia', 'Toñito con estrellas y nebulosas', 'tonito_customization', 500,
   '{"gradient": ["#6C5CE7", "#FD79A8"], "particles": "stars"}'::jsonb,
   '#6C5CE7', false, 4),
  ('Toñito Arcoíris', 'Toñito con todos los colores', 'tonito_customization', 800,
   '{"gradient": ["#FF6B6B", "#4ECDC4", "#45B7D1", "#FFA07A"], "particles": "rainbow"}'::jsonb,
   '#FF6B6B', false, 5),
  
  -- Power-ups
  ('Doble XP (1 hora)', 'Duplica la experiencia ganada durante 60 minutos', 'power_up', 300,
   '{"type": "xp_multiplier", "value": 2, "duration_minutes": 60}'::jsonb,
   '#FFD700', true, 10),
  ('Escudo de Racha', 'Protege tu racha por 1 día de inactividad', 'streak_freeze', 400,
   '{"type": "streak_protection", "days": 1}'::jsonb,
   '#00D2D3', true, 11),
  ('Recarga de Vidas', 'Recupera todas tus vidas al instante', 'power_up', 350,
   '{"type": "heart_refill", "value": 5}'::jsonb,
   '#FF7675', true, 12);

-- ============================================================
-- MISIONES DIARIAS (pool rotativo)
-- ============================================================
insert into public.daily_missions (title, description, icon_name, mission_type, target_value, reward_coins, reward_xp) values
  ('Estudiante Dedicado', 'Completa 2 módulos hoy', 'book-open', 'complete_modules', 2, 50, 30),
  ('Cazador de XP', 'Gana 100 XP en un solo día', 'trending-up', 'earn_xp', 100, 40, 20),
  ('Fuego Interior', 'Mantén tu racha activa', 'flame', 'maintain_streak', 1, 30, 15),
  ('Excelencia', 'Obtén puntuación perfecta en un módulo', 'award', 'perfect_score', 1, 75, 50),
  ('Maratonista', 'Estudia al menos 30 minutos', 'clock', 'time_spent', 1800, 60, 35),
  ('Respondedor Veloz', 'Responde 10 preguntas correctamente', 'zap', 'answer_questions', 10, 45, 25);

-- ============================================================
-- MÓDULOS DE CONTENIDO DE EJEMPLO (15 módulos, 5 categorías)
-- ============================================================

-- === MATEMÁTICAS BÁSICAS ===
insert into public.content_modules (title, description, category, difficulty_level, content_type, base_xp_reward, estimated_time_minutes, order_index, map_position_x, map_position_y, gemini_prompt_template) values
  ('Suma y Resta', 'Domina las operaciones básicas con números naturales', 'math', 1, 'quiz', 15, 8, 1, 100, 400,
   'Genera una pregunta de suma o resta con números del 1 al 50. Nivel básico. Incluye una opción que sea el error común de olvidar el acarreo.'),
  ('Multiplicación', 'Aprende las tablas y la multiplicación paso a paso', 'math', 2, 'quiz', 20, 10, 2, 200, 350,
   'Genera una pregunta de multiplicación. Usa las tablas del 2 al 9. Incluye un problema de contexto real (compras, repartir cosas).'),
  ('Fracciones Básicas', 'Entiende qué son las fracciones y cómo compararlas', 'math', 3, 'quiz', 25, 12, 3, 300, 300,
   'Genera una pregunta sobre fracciones: identificar, comparar o simplificar. Usa representaciones visuales en la explicación (pizza, pastel).'),

-- === CIENCIAS NATURALES ===
  ('El Sistema Solar', 'Explora los planetas y el sol', 'science', 1, 'quiz', 15, 10, 4, 400, 400,
   'Genera una pregunta sobre el sistema solar: nombres de planetas, orden, tamaños relativos, o características básicas. Nivel elemental.'),
  ('Los Seres Vivos', 'Clasificación básica de animales y plantas', 'science', 2, 'quiz', 20, 10, 5, 500, 350,
   'Genera una pregunta sobre clasificación de seres vivos: vertebrados/invertebrados, herbívoros/carnívoros. Usa ejemplos de animales que los niños conozcan.'),
  ('El Agua y sus Estados', 'Sólido, líquido y gaseoso: las transformaciones del agua', 'science', 3, 'quiz', 25, 12, 6, 600, 300,
   'Genera una pregunta sobre estados de la materia y cambios de estado del agua. Incluye ejemplos cotidianos (hielo, vapor al hervir).'),

-- === HISTORIA ===
  ('Las Civilizaciones Antiguas', 'Egipto, Grecia y Roma: los cimientos de nuestra historia', 'history', 1, 'quiz', 15, 10, 7, 100, 200,
   'Genera una pregunta sobre civilizaciones antiguas (Egipto, Grecia o Roma). Nivel básico: ubicación, personajes famosos, inventos.'),
  ('La Edad Media', 'Castillos, caballeros y la vida medieval', 'history', 2, 'quiz', 20, 10, 8, 200, 150,
   'Genera una pregunta sobre la Edad Media: feudalismo, vida cotidiana, o eventos importantes. Hazlo interesante con datos curiosos.'),
  ('Descubrimiento de América', 'El viaje que cambió el mundo', 'history', 3, 'quiz', 25, 12, 9, 300, 100,
   'Genera una pregunta sobre el descubrimiento de América: personajes, fechas clave, consecuencias. Incluye perspectiva de los pueblos originarios.'),

-- === LENGUAJE ===
  ('Las Vocales y Consonantes', 'El abecedario y los sonidos del español', 'language', 1, 'quiz', 15, 8, 10, 400, 200,
   'Genera una pregunta sobre fonética básica del español: identificar vocales/consonantes, sílabas, o completar palabras.'),
  ('Sustantivos y Adjetivos', 'Las palabras que nombran y describen', 'language', 2, 'quiz', 20, 10, 11, 500, 150,
   'Genera una pregunta sobre identificar sustantivos y adjetivos en oraciones simples. Usa contextos divertidos.'),
  ('Comprensión Lectora', 'Lee, comprende y responde', 'language', 3, 'quiz', 25, 15, 12, 600, 100,
   'Genera un párrafo corto (3-4 oraciones) sobre un tema interesante para niños y una pregunta de comprensión. Nivel básico-intermedio.'),

-- === PENSAMIENTO LÓGICO ===
  ('Patrones y Secuencias', 'Descubre el siguiente número o figura', 'logic', 1, 'quiz', 15, 8, 13, 700, 400,
   'Genera un problema de secuencia numérica o patrón visual simple. Ejemplo: 2, 4, 6, ¿? Nivel fácil.'),
  ('Acertijos Matemáticos', 'Resuelve problemas con ingenio', 'logic', 2, 'quiz', 20, 10, 14, 800, 350,
   'Genera un acertijo lógico-matemático apropiado para niños. Debe requerir razonamiento, no solo cálculo. Incluye pistas.'),
  ('Problemas de Lógica', 'Razona paso a paso para encontrar la solución', 'logic', 3, 'quiz', 25, 12, 15, 900, 300,
   'Genera un problema de lógica deductiva simple: tipo "Si A entonces B, si B entonces C, ¿qué pasa con A?". Usa personajes y situaciones divertidas.');

-- ============================================================
-- CONFIGURAR PREREQUISITOS (encadenar módulos por categoría)
-- ============================================================
-- Nota: Se ejecuta después porque necesitamos los IDs generados
do $$
declare
  v_modules record;
  v_prev_id uuid;
  v_current_category text := '';
begin
  for v_modules in
    select id, category, order_index
    from public.content_modules
    order by category, order_index
  loop
    if v_modules.category != v_current_category then
      v_current_category := v_modules.category;
      v_prev_id := null;
    end if;
    
    if v_prev_id is not null then
      update public.content_modules
      set prerequisites = array[v_prev_id]
      where id = v_modules.id;
    end if;
    
    v_prev_id := v_modules.id;
  end loop;
end $$;
