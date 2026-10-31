# Capa clave-valor con TTL (`src/lib/kv/`)

Una capa de **velocidad**, no de verdad. Guarda copias recalculables y contadores efímeros; la fuente de verdad sigue siendo Postgres (con RLS). Si la capa se vacía o no está configurada, el sistema funciona igual, solo más lento. Es el primer paso del camino descrito en `docs/ESCALABILIDAD_DE_DATOS.md` (escalar dentro de Postgres y sacar solo lo efímero).

## Piezas

| Archivo | Qué hace |
|---|---|
| `types.ts` | Contrato `KeyValueStore` (`get` con validador, `set` con TTL, `del`, `incrWithWindow`) y límites. |
| `keys.ts` | `buildKvKey(namespace, ...partes)`: espacios de nombres cerrados (`emb`, `mem`, `quota`, `health`); cada parte `[A-Za-z0-9_.-]{1,80}` (**sin `:` ni `*`**). La clave lleva una marca de tipo: no se pasa un string cualquiera. |
| `memoryStore.ts` | En memoria por instancia: vencimiento real, poda, desalojo LRU por **claves (2000)** y por **bytes (32 MiB)**; tope por valor de 1 MiB (un grafo puede pesar ~800 KB). |
| `upstashStore.ts` | Upstash Redis por REST (`fetch`): 800 ms de límite, cortacircuito (3 fallas → 30 s) y respaldo silencioso en memoria. Los contadores usan `MULTI` (`INCR` + `EXPIRE NX` + `TTL`). |
| `index.ts` | Sin variables → solo memoria. Con `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN` → L1 (30 s máx.) + L2 (Upstash). Una URL `http://` que no sea local se ignora. |

## Reglas

1. **El caché nunca salta la autorización.** Primero se comprueba, con la sesión del usuario (RLS), que puede ver la clase; solo después se toca el caché.
2. **Nada se lee a ciegas.** Cada lectura pasa por un validador; si falla, la clave se borra y se recalcula desde la fuente.
3. **Todo lleva TTL** (1 s a 7 días). Valores que no caben o TTL inválidos se omiten sin lanzar.
4. **Ninguna operación lanza.** Una falla de red, de formato o de tamaño da `null` (lectura) o no hace nada (escritura).
5. **No se guardan** tokens de sesión, correos, contraseñas ni llaves de API.

## Usos actuales

- **Vectores de consulta** (`embedQuery`): clave `emb:q:{perfil}:{sha256}`, TTL 1 día. Validado: 768 números finitos. No se guardan fallas. El texto de la consulta nunca aparece en la clave. El vector depende solo del texto, no del usuario, así que se comparte entre clases.
- **Grafo de la memoria de clase** (`getCachedClassGraph`): clave `mem:graph:{clase}:v{version}`, TTL 1 hora. `class_memory.version` sube en cada reconstrucción, así que la copia vieja nunca se vuelve a pedir. Se guarda bajo la versión de la fila realmente leída (no la de la consulta previa) para evitar una carrera con una reconstrucción. Hoy lo usa `POST /api/lab/design`.

## Para activar Redis (opcional)

Crear una base en Upstash y poner en Vercel `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN`. Sin ellas todo sigue funcionando con la memoria de cada instancia (en Vercel rinde menos porque cada invocación puede caer en otra instancia).

## Límites conocidos

- Una escritura o un borrado hecho **mientras Redis está caído** queda solo en el respaldo en memoria; al volver, Redis puede conservar una copia vieja de esa clave. Las claves por versión son inmutables, así que no importa aquí; para otro uso habría que tenerlo en cuenta.
- `rateLimit.ts` y `ai/gateway/persist.ts` **no** usan esta capa todavía (las tablas de las migraciones 080 y 083 no están aplicadas en producción). `incrWithWindow` ya está listo para cuando se decida.
- Otras lecturas de `class_memory` (panel del profesor, constructor) no pasan por el caché: solo piden `status`/`version` o escriben.
