# Memoria de rendimiento del sistema

Registro **aparte y trazable** de cómo rinde Stud.ia: corridas de carga, instantáneas de la base, optimizaciones hechas (con su antes y después), hallazgos abiertos y los datos de prueba que las originaron. Existe para que **una persona o una IA** pueda decidir qué optimizar, comprobar que un cambio ayudó y no repetir mediciones.

## Cómo usarla (pensado para una IA)
1. Lee `index.json`: `runs` (corridas), `optimizations` (cambios con antes/después y PR), `findings` (hallazgos con estado) y `baselines` (los números a vencer).
2. Antes de optimizar algo, busca en `hallazgos.md` si ya está medido o descartado; después de optimizar, **agrega una fila a `optimizaciones.md` y a `index.json`** con el antes y el después medidos en las MISMAS condiciones.
3. Para medir: `k6 run --summary-export=loadtest/results/<id>.json ...` y luego
   `npx tsx scripts/perf-record.ts loadtest/results/<id>.json --id <fecha-destino-escenario> --date <fecha> --target <produccion|local> --scenario <...> --profile <...> --note "<qué cambió>"`.
4. Compara solo cosas comparables: **destino** (local o producción), **perfil**, **usuarios virtuales** y **pausa**. Local = portátil con ≈250 ms de viaje a Supabase (infla todo); producción = Vercel junto a Supabase.
5. Las corridas marcadas `INVALIDA` en su nota no sirven de base (explican el motivo).

## Contenido
| Archivo | Qué es |
|---|---|
| `index.json` | Índice legible por máquina (corridas, optimizaciones, hallazgos, líneas base) |
| `runs/*.json` | Una corrida compacta por archivo (tiempos por etiqueta, errores, umbrales cruzados, contadores) |
| `optimizaciones.md` | Libro de cambios de rendimiento: hipótesis → medición → PR |
| `hallazgos.md` | Lo encontrado y su estado (abierto/cerrado) y las hipótesis por probar |
| `datos-de-prueba.md` | Qué datos de prueba hay en la base, sus ids, cómo reactivarlos o limpiarlos |
| `instantaneas/*.json` | Estado agregado de la base en una fecha (tamaños, conteos, integridad) |

## Reglas
- **Nunca** se guardan credenciales, correos reales ni el resumen crudo de k6: solo métricas y metadatos. El repositorio es público.
- Solo se agrega (no se reescribe el pasado); si algo estaba mal, se anota la corrección.
- Las cifras son de quien las midió, en ese momento y con esas condiciones: citar siempre la corrida (`id`).
