import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string | null;
  // Control dentro del campo, a la derecha (p. ej. "Mostrar" en una contraseña). Debe ser un <button> con nombre accesible.
  endAdornment?: ReactNode;
}

// Campo con etiqueta VISIBLE asociada al input (htmlFor), ayuda opcional y error junto al campo, enlazados con
// aria-describedby. Antes los formularios usaban <label> sin htmlFor: un lector de pantalla no sabia que
// etiqueta correspondia a cada campo. El texto es de 16 px para que iOS no haga zoom al enfocar.
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field({ label, hint, error, endAdornment, className, required, ...rest }, ref) {
  const id = useId();
  // La ayuda se oculta cuando hay error: su id no debe quedar colgando en aria-describedby.
  const hintId = hint && !error ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-fg-muted mb-2">
        {label}
        {required && <span className="text-danger" aria-hidden="true"> *</span>}
      </label>
      <div className="relative">
        <input
          ref={ref}
          id={id}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'w-full min-h-[44px] px-4 py-3 rounded-xl text-base text-fg bg-surface-2 border placeholder:text-fg-muted/70',
            'transition-colors duration-200 motion-reduce:transition-none',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-transparent',
            error ? 'border-danger' : 'border-line-strong',
            endAdornment ? 'pr-24' : null,
            className
          )}
          {...rest}
        />
        {endAdornment && <div className="absolute right-1.5 top-1/2 -translate-y-1/2">{endAdornment}</div>}
      </div>
      {hint && !error && (
        <p id={hintId} className="mt-1.5 text-sm text-fg-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
});
