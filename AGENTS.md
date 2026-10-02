# Vector Editor

Editor gráfico vectorial 2D interactivo en TypeScript sobre Canvas 2D nativo.
Implementa un Scene Graph inmutable (Document > Layer > Shape) con renderizado por dirty-loop.
Incluye manipulación de trazados Bézier, transformaciones geométricas y Undo/Redo (Command Pattern).

## Comandos
- Dev: `npm run dev` (inicia Vite en http://localhost:5173)
- Build: `npm run build` (`tsc && vite build`)
- Test suite: `npm test` (`node --experimental-strip-types --test test/*.test.ts`)
- Test individual: `node --experimental-strip-types --test test/<nombre>.test.ts`

## Estructura del Proyecto
- `src/types/`: Definiciones TypeScript del Scene Graph (`Document`, `Layer`, `Shape`, `PathPoint`).
- `src/state/`: `StateManager` inmutable (árbol congelado, structural sharing) y `Serializer`.
- `src/commands/`: `CommandManager` e implementaciones de `Command` para historial Undo/Redo.
- `src/render/`: `RenderEngine` (renderizado Canvas 2D, optimización `isDirty`, overlay OBB).
- `src/input/`: `InputController` (eventos DOM, despacho de `ToolMode`, hit-testing y selección).
- `src/utils/`: Funciones geométricas puras (`geometry.ts`: AABB, OBB, Bézier) e inmutables.
- `test/`: Suites de pruebas unitarias ejecutadas con runner nativo `node:test`.

## Reglas Críticas
1. **Inmutabilidad estricta**: Nunca mutar objetos del Scene Graph directamente (`Object.freeze`). Toda modificación debe realizarse mediante métodos de `StateManager` (`src/state/StateManager.ts`).
2. **Historial obligatorio**: Toda mutación interactiva de usuario debe encapsularse en una clase que implemente `Command` (`src/commands/`) y registrarse con `CommandManager.recordCommand()`.
3. **Renderizado dirty-loop**: `RenderEngine` (`src/render/RenderEngine.ts`) solo redibuja cuando `StateManager.isDirty` es `true`. No invocar `render()` síncronamente fuera del ciclo rAF.
4. **Proyección en figuras rotadas**: Al manipular o redimensionar figuras en `InputController.ts`, proyectar deltas de pantalla `(dx, dy)` al marco local rotado de la figura usando su ángulo.
5. **Eventos de herramienta**: Cambios en `_currentTool` en `InputController.ts` deben emitir `emit('toolChange', tool)` para que `setupUIBindings` (`src/main.ts`) sincronice clases `.active`.
6. **Importaciones con extensión**: Node ejecuta tests con `--experimental-strip-types`; toda importación relativa local debe incluir explícitamente la extensión `.ts`.

## No hacer
- No mutar propiedades del Scene Graph ni arrays de capas sin pasar por `StateManager`.
- No manipular el DOM ni clases CSS desde `InputController` o `RenderEngine` (usar `setupUIBindings` en `src/main.ts`).
- No importar módulos locales omitiendo la extensión `.ts`.
