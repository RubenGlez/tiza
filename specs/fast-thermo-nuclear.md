# Spec — `fast-thermo-nuclear` (skill demo para el plugin de Tiza)

> Estado: **propuesta / backlog**
> Tipo: nueva skill en `apps/tiza-plugin/skills/`
> Relacionada: `/tiza-review` (mismo patrón CA-MCP, distinto enfoque)

---

## 1. Motivación comercial

La idea es arrancar una **familia de skills `fast-*`**: cogemos skills famosas de la
comunidad cuyo cuello de botella es que corren *en serie y en un único contexto*, y
publicamos la versión "fast" que hace exactamente el mismo trabajo pero **en paralelo y
coordinando por el Shared Context Store de Tiza**. El prefijo comunica la propuesta de
valor de un vistazo: *mismo análisis, menos tiempo de pared y menos tokens*.

La primera de la familia es **`fast-thermo-nuclear`**, riff sobre la skill viral
`thermo-nuclear-code-quality-review` de Cursor. Es el mejor "antes/después" del catálogo
porque el original es lento por diseño.

---

## 2. La skill original (qué mejoramos)

`thermo-nuclear-code-quality-review` (cursor/plugins · `cursor-team-kit`) es una auditoría
de calidad de código extremadamente exigente, centrada en mantenibilidad, calidad de las
abstracciones y elegancia estructural. Busca "code judo moves": reestructuraciones que
preservan el comportamiento pero simplifican drásticamente la implementación.

**Características clave del original:**

- Es un **único pase de review secuencial** sobre un solo prompt-baseline, todo en el
  mismo contexto. No reparte el trabajo en subagentes.
- Evalúa 7 estándares no negociables (ver §4).
- Reputación pública: **corre ~30 min sobre un PR** y mete todo el análisis intermedio en
  una sola ventana de contexto.
- Listón de aprobación muy duro: presunción de *rechazo* salvo justificación clara.

**El cuello de botella:** las 7 dimensiones se evalúan una detrás de otra y todo el
razonamiento intermedio (diffs leídos, ficheros explorados, hipótesis) se acumula en un
único contexto que luego hay que pagar entero en la síntesis final.

Fuente: https://github.com/cursor/plugins/blob/main/cursor-team-kit/skills/thermo-nuclear-code-quality-review/SKILL.md

---

## 3. Qué aporta Tiza (la versión "fast")

Reimplementamos la auditoría como un workflow CA-MCP idéntico en *patrón* a `/tiza-review`:

- Las dimensiones de calidad se reparten en **N especialistas que corren como subagentes
  en paralelo**, cada uno en su propia ventana de contexto.
- Cada especialista escribe **findings tipados** (severidad, fichero, línea, sugerencia) al
  store de Tiza vía `tiza_write`, marca `tiza_done` y devuelve **una sola línea** de
  confirmación. Su contexto se descarta.
- El orquestador **no ve el análisis crudo** de nadie: sintetiza desde
  `tiza_prompt` (digest Markdown compacto del store).

**Ganancias frente al original:**

1. **Tiempo de pared** ≈ el de la dimensión más lenta, no la suma de las 7.
2. **Tokens de síntesis**: se lee el digest estructurado, no una conversación inflada.
3. **Aislamiento real**: cada dimensión razona sin contaminarse con las demás → menos
   sesgo de anclaje, dedupe explícito en la síntesis.

Importante (alineado con el README): esto **no** se vende como "más rápido para toda tarea
multi-agente". El claim concreto es: *para una auditoría multi-dimensión que el original
corre en serie, repartir en subagentes coordinados por store reduce tiempo de pared y
tokens de síntesis*. Hay que medirlo (ver §8).

---

## 4. Las 7 dimensiones del original → carriles (lanes) propuestos

Para no fragmentar en exceso, agrupamos los 7 estándares en **5 carriles paralelos**.
Cada carril es un especialista/subagente.

| Lane | Estándares del original que cubre | Foco |
|------|-----------------------------------|------|
| **structure** | (1) Structural Ambition + (7) Atomic Flows | "Code judo": eliminar ramas/modos/condicionales enteros; orquestación atómica y paralelizable |
| **abstraction** | (3) Spaghetti Prevention + (4) Design Over Working Code | Condicionales ad-hoc dispersos → empujar lógica a abstracciones/módulos dedicados; estructura > "funciona" |
| **boundaries** | (6) Canonical Layer Discipline | Lógica en la capa correcta; sin fugas de lógica de feature a rutas compartidas; sin duplicar utilidades |
| **types** | (5) Type Cleanliness | Opcionalidad innecesaria, casts, objetos mal tipados → modelos explícitos y contratos claros |
| **size** | (2) File-Size Boundaries | Cruzar 1.000 líneas como *smell*; extraer helpers/subcomponentes/módulos |

> **Open question:** ¿5 carriles o mantenemos los 7 estándares como 7 subagentes? 5 reduce
> coste y solape; 7 es más fiel al original. Decidir antes de implementar.

---

## 5. Diseño de la skill

### Frontmatter propuesto (`apps/tiza-plugin/skills/fast-thermo-nuclear/SKILL.md`)

```yaml
---
name: fast-thermo-nuclear
description: A parallel, store-coordinated take on the thermo-nuclear code-quality
  audit. Spawns structure, abstraction, boundaries, types and file-size specialists as
  parallel subagents — each writes typed findings to the Tiza store from its own context —
  then synthesizes a harsh merge/no-merge verdict from the store digest instead of a grown
  conversation. Same ruthless quality bar, a fraction of the wall-clock and synthesis tokens.
---
```

### Workflow (espejo de `/tiza-review`)

1. **Get the code** — diff/PR/ficheros indicados; si no, `git diff main...HEAD`. Decidir el
   `{DIFF_COMMAND}` exacto que cada especialista correrá por su cuenta.
2. **Open the run** — `tiza_open_run` con:
   - `run_id`: `fast-thermo-<slug>-<YYYYMMDD-HHmmss>`
   - `task`: una línea
   - `agents`: `["structure", "abstraction", "boundaries", "types", "size"]`
   - `repo_path`: ruta absoluta
   - **Nunca** `tiza_init` (resetea el run `default` del benchmark).
3. **Spawn de los 5 especialistas en paralelo** — un solo mensaje, una llamada Agent por
   carril, modelo por defecto (no uno pequeño). Plantilla idéntica a `/tiza-review` con
   `{AGENT}`, `{LANE}`, `{RUN_ID}`, `{REPO}`, `{DIFF_COMMAND}`. Cada uno:
   - Lee el diff y los ficheros de alrededor para **verificar** cada issue contra el código
     real (nada sin verificar).
   - Revisa **solo** desde su ángulo (texto de su lane en §4).
   - Escribe findings con `tiza_write` (schema en §6); si su carril está limpio, un único
     `insight`.
   - `tiza_done` + responde una sola línea `done: {AGENT} — N findings, M insights`.
4. **Synthesize** — `tiza_status` (re-spawn si algún agente quedó pending), `tiza_prompt`,
   y veredicto duro (§7).

### Diferencias respecto a `/tiza-review`

- `/tiza-review` cubre seguridad/calidad/tests/perf de forma amplia. `fast-thermo-nuclear`
  es **solo calidad estructural/mantenibilidad**, pero mucho más agresivo (busca code-judo,
  no "issues").
- El veredicto hereda el listón duro del original: **presunción de rechazo** salvo
  justificación.

---

## 6. Schema de findings (reusar el de Tiza, Zod-validado)

- `finding` — `{ severity: "critical"|"high"|"medium"|"low"|"info", issue: string, file?: string, line?: number, suggestion?: string }`
- `insight` — `{ note: string }`
- `decision` — `{ note: string, rationale?: string }`

Mapeo de severidad al ranking del original (de mayor a menor impacto): regresión
estructural → simplificación perdida → spaghetti/branching → problema de
boundary/abstracción → tamaño de fichero → legibilidad.

---

## 7. Criterios de síntesis / veredicto

Hereda el listón del original. El synthesizer produce:

- **Bloqueantes** (regresión estructural, simplificación obvia no hecha, bloat de fichero
  injustificado, spaghetti, abstracción hacky, fuga de capa).
- **Mejoras recomendadas** (no bloqueantes).
- **Veredicto**: *approve* solo si no hay bloqueantes; en otro caso *needs rework*, citando
  fichero:línea y **fusionando duplicados** cuando dos carriles marcan las mismas líneas.
- Añadir juicio de síntesis que los findings sueltos no llevan (p.ej. "structure y
  abstraction convergen en `x.ts` → ahí está la deuda principal").

---

## 8. Cómo lo medimos (criterio de éxito)

Alineado con la nota del README ("New Tiza MCP capabilities ... measured as a separate
benchmark generation"):

- Benchmark separado: mismo fixture/PR, comparar **original secuencial** vs
  **fast-thermo-nuclear** en: nº de llamadas LLM, input tokens, total tokens y tiempo de
  pared.
- Reportar también **calidad** (¿encuentra los mismos code-judo moves?), no solo tokens —
  es justo la deuda que el README admite tener pendiente.
- Criterio de éxito mínimo: paridad de findings de alto impacto con menos tiempo de pared y
  menos tokens de síntesis.

---

## 9. Fuera de alcance (de momento)

- La segunda skill `fast-*` (se elegirá más adelante: candidatas = `fast-security-review`
  sobre OWASP/cybersecurity, `fast-superpowers`, `fast-code-review`).
- Auto-fix de los findings (el original tampoco aplica cambios; solo audita).
- Cualquier cambio en el core `@tiza/core` o `@tiza/mcp` — la skill se monta solo con las
  tools MCP existentes (`tiza_open_run`, `tiza_write`, `tiza_done`, `tiza_status`,
  `tiza_prompt`).

---

## 10. Tareas (checklist de implementación)

- [ ] Decidir 5 vs 7 carriles (§4 open question).
- [ ] Escribir `apps/tiza-plugin/skills/fast-thermo-nuclear/SKILL.md` (plantilla §5).
- [ ] Registrar la skill en `apps/tiza-plugin/README.md` (tabla de skills + sección "why").
- [ ] Añadir el benchmark comparativo separado (§8).
- [ ] Nota de atribución: homenaje a `thermo-nuclear-code-quality-review` de Cursor;
      revisar que el nombre `fast-thermo-nuclear` no infrinja marca/atribución.

---

## 11. Nota de atribución

`fast-thermo-nuclear` es un **homenaje reconocido** a la skill `thermo-nuclear-code-quality-review`
de Cursor. La spec reusa su rúbrica de calidad como base del análisis; la aportación de
Tiza es el patrón de coordinación (paralelo + store), no la rúbrica. Acreditar la fuente en
el SKILL.md y el README del plugin.
