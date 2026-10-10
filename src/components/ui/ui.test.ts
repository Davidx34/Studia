import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Field } from './Field';
import { Button } from './Button';
import { Badge } from './Card';
import { cn } from './cn';

describe('Field', () => {
  it('la etiqueta esta asociada al campo (htmlFor = id)', () => {
    const html = renderToStaticMarkup(h(Field, { label: 'Email', name: 'email' }));
    const forId = html.match(/<label for="([^"]+)"/)![1];
    expect(html).toContain(`id="${forId}"`);
  });

  it('el error se anuncia, queda junto al campo y lo describe', () => {
    const html = renderToStaticMarkup(h(Field, { label: 'Email', error: 'Correo no valido' }));
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-invalid="true"');
    const errId = html.match(/<p id="([^"]+)" role="alert"/)![1];
    expect(html).toContain(`aria-describedby="${errId}"`);
  });

  it('sin error no marca el campo como invalido; la ayuda lo describe', () => {
    const html = renderToStaticMarkup(h(Field, { label: 'Email', hint: 'Usa tu correo institucional' }));
    expect(html).not.toContain('aria-invalid');
    expect(html).toContain('Usa tu correo institucional');
    expect(html).toContain('aria-describedby=');
  });

  it('los campos obligatorios se marcan sin depender solo del color', () => {
    expect(renderToStaticMarkup(h(Field, { label: 'Email', required: true }))).toContain('*');
  });

  it('el texto del campo es de 16 px (text-base) y el area tactil de 44 px', () => {
    const html = renderToStaticMarkup(h(Field, { label: 'x' }));
    expect(html).toContain('text-base');
    expect(html).toContain('min-h-[44px]');
  });
});

describe('Field: adorno y ayuda', () => {
  it('con error, aria-describedby no apunta a una ayuda que no se muestra', () => {
    const html = renderToStaticMarkup(h(Field, { label: 'x', hint: 'ayuda', error: 'mal' }));
    expect(html).not.toContain('-hint');
    expect(html).not.toContain('ayuda');
  });

  it('con un adorno (boton Mostrar) deja espacio a la derecha para que el texto no quede debajo', () => {
    const html = renderToStaticMarkup(h(Field, { label: 'x', endAdornment: h('button', { type: 'button' }, 'Mostrar') }));
    expect(html).toContain('pr-24');
    expect(html).toContain('Mostrar');
  });
});

describe('Button', () => {
  it('por defecto es type=button (no envia formularios sin querer)', () => {
    expect(renderToStaticMarkup(h(Button, null, 'Ok'))).toContain('type="button"');
  });

  it('cargando: queda deshabilitado, anuncia aria-busy y muestra el indicador', () => {
    const html = renderToStaticMarkup(h(Button, { loading: true }, 'Guardando'));
    expect(html).toContain('disabled');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('<svg');
  });

  it('el tamaño normal cumple el minimo tactil de 44 px y hay foco visible', () => {
    const html = renderToStaticMarkup(h(Button, null, 'Ok'));
    expect(html).toContain('min-h-[44px]');
    expect(html).toContain('focus-visible:ring-2');
  });

  it('respeta reduced-motion en transiciones y animaciones', () => {
    const html = renderToStaticMarkup(h(Button, { loading: true }, 'Ok'));
    expect(html).toContain('motion-reduce:transition-none');
    expect(html).toContain('motion-reduce:animate-none');
  });
});

describe('Badge y cn', () => {
  it('Badge lleva texto: el color no es el unico mensaje', () => {
    expect(renderToStaticMarkup(h(Badge, { tone: 'danger' }, 'Reprobada'))).toContain('Reprobada');
  });

  it('cn ignora valores vacios', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b');
  });
});
