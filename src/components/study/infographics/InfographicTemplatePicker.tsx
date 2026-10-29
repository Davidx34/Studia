'use client';

// Selector de la plantilla de las INFOGRAFIAS para el panel del profesor. Cada opcion muestra la plantilla REAL con las infografias de la clase, o con ejemplos (una de cada
// tipo) si todavia no generaste ninguna. Ver TemplatePicker para el comportamiento (elegir, vista previa y guardar).

import { Shapes } from 'lucide-react';
import { InfographicView } from '@/components/study/InfographicView';
import { TemplatePicker } from '@/components/study/TemplatePicker';
import {
  INFOGRAPHIC_CATEGORY_HINT, INFOGRAPHIC_CATEGORY_LABEL, INFOGRAPHIC_TEMPLATES, SAMPLE_INFOGRAPHICS, normalizeInfographicTemplate, type InfographicItem,
} from '@/lib/study/infographicTemplates';

const CATEGORIES = (['funcional', 'infantil', 'area', 'estetica'] as const).map((id) => ({ id, label: INFOGRAPHIC_CATEGORY_LABEL[id], hint: INFOGRAPHIC_CATEGORY_HINT[id] }));

// Para la miniatura se prefiere una infografia de cifras (la mas vistosa); si no hay, la primera.
const miniatureItem = (items: InfographicItem[]) => items.find((i) => i.data.tipo === 'stats') ?? items[0];

export function InfographicTemplatePicker({
  classroomId,
  initialTemplate,
  previewItems,
}: {
  classroomId: string;
  initialTemplate: string | null;
  // Infografias reales de la clase para la vista previa (hasta 4). Vacio = se usan las de ejemplo.
  previewItems: InfographicItem[];
}) {
  const real = previewItems.length > 0;
  const items = real ? previewItems : SAMPLE_INFOGRAPHICS;
  const mini = miniatureItem(items);

  return (
    <TemplatePicker
      classroomId={classroomId}
      column="infographic_template"
      radioName="infographic-template"
      initialId={initialTemplate}
      normalize={normalizeInfographicTemplate}
      templates={INFOGRAPHIC_TEMPLATES}
      categories={CATEGORIES}
      title="Plantilla de las infografías"
      icon={<Shapes aria-hidden="true" className="h-5 w-5 text-primary-text" />}
      intro={
        <>
          Elige cómo verán tus estudiantes las infografías (línea de tiempo, comparativa, proceso y cifras). Cambiar de plantilla es instantáneo:{' '}
          <strong className="text-fg">no vuelve a usar la IA</strong> ni modifica los datos.
        </>
      }
      renderMiniature={(id) => <InfographicView title={mini.title} section={mini.section} data={mini.data} template={id} />}
      renderFull={(id) => (
        <div className="space-y-5">
          {items.map((i) => (
            <InfographicView key={i.id} title={i.title} section={i.section} data={i.data} template={id} />
          ))}
        </div>
      )}
      previewTitle={(name) => `Ver la plantilla “${name}” completa ${real ? 'con tus infografías' : '(con ejemplos de cada tipo)'}`}
      previewNote={real ? 'Estas son tus infografías pintadas con la plantilla elegida.' : 'Todavía no generaste infografías: estos son ejemplos de cada tipo. Cuando las generes, aquí verás las tuyas.'}
      saveLabel="Guardar plantilla de infografías"
      savedMessage="Listo: tus estudiantes ya ven las infografías con esta plantilla."
    />
  );
}
