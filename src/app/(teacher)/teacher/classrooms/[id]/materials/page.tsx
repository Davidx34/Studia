import { FileText } from 'lucide-react';

export default function MaterialsPlaceholder() {
  return (
    <div className="text-center py-16 rounded-2xl bg-slate-900 border border-slate-800 border-dashed">
      <FileText className="w-12 h-12 text-slate-600 mx-auto mb-3" />
      <h3 className="text-base font-semibold text-white mb-1">Materiales</h3>
      <p className="text-sm text-slate-500">
        Disponible en la sub-fase 11.C — subida y procesamiento de PDF/DOCX/XLSX.
      </p>
    </div>
  );
}
