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
3. **Selección múltiple y StateManager**: La selección admite varias figuras y se gestiona como lista de IDs fuera del Document. Debe modificarse únicamente mediante la API de `StateManager` (`setSelection`, `addToSelection`, `removeFromSelection`, `toggleInSelection`, `selectAll`).
4. **Operaciones múltiples en BatchCommand**: Toda operación que afecte a varias figuras (eliminar, duplicar, pegar, reordenar, mover con flechas o cambiar estilos) debe registrarse en el historial como UNA sola entrada mediante `BatchCommand` (`src/commands/BatchCommand.ts`).
5. **Sin redimensionado ni rotación en multi-selección**: Con varias figuras seleccionadas NO se muestran tiradores ni se permite redimensionar o rotar (solo traslación y selección por marquesina).
6. **Renderizado dirty-loop**: `RenderEngine` (`src/render/RenderEngine.ts`) solo redibuja cuando `StateManager.isDirty` es `true`. No invocar `render()` síncronamente fuera del ciclo rAF.
7. **Proyección en figuras rotadas**: Al manipular o redimensionar figuras individuales en `InputController.ts`, proyectar deltas de pantalla `(dx, dy)` al marco local rotado de la figura usando su ángulo.
8. **Eventos de herramienta**: Cambios en `_currentTool` en `InputController.ts` deben emitir `emit('toolChange', tool)` para que `setupUIBindings` (`src/main.ts`) sincronice clases `.active`.
9. **Importaciones con extensión**: Node ejecuta tests con `--experimental-strip-types`; toda importación relativa local debe incluir explícitamente la extensión `.ts`.

## No hacer
- No mutar propiedades del Scene Graph ni arrays de capas sin pasar por `StateManager`.
- No alterar la selección manualmente sin utilizar los métodos dedicados de `StateManager`.
- No registrar comandos individuales por separado cuando una acción afecte a múltiples figuras (usar siempre `BatchCommand`).
- No mostrar ni procesar tiradores de redimensionado o rotación cuando hay más de una figura seleccionada.
- No manipular el DOM ni clases CSS desde `InputController` o `RenderEngine` (usar `setupUIBindings` en `src/main.ts`).
- No importar módulos locales omitiendo la extensión `.ts`.
