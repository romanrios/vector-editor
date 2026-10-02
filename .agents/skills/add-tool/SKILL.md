---
name: add-tool
description: Guía paso a paso para añadir una nueva herramienta interactiva al editor vectorial (ej. nuevas figuras, manipulación o dibujo). Usar siempre que se solicite incorporar una herramienta al editor.
---

# Procedimiento para Añadir una Herramienta

### 1. Tipos de Herramienta (`src/input/InputController.ts` y tipos)
- Extender la unión `ToolMode` en `src/input/InputController.ts`: `export type ToolMode = 'select' | 'pen' | 'direct-select' | '<nueva-herramienta>';`
- Si la herramienta crea figuras nuevas, extender `src/types/scene-graph.ts` (unión `Shape`).

### 2. Lógica del Controlador (`src/input/InputController.ts`)
- Implementar los manejadores privados `handle<Tool>MouseDown`, `handle<Tool>MouseMove` y `handle<Tool>MouseUp`.
- Conectar cada uno en las ramas `if (this._currentTool === '<nueva-herramienta>')` de `handleMouseDown`, `handleMouseMove` y `handleMouseUp`.
- En `setTool()`, agregar la limpieza o finalización del estado activo al cambiar de herramienta.
- Opcional: registrar el atajo de teclado en `handleKeyDown()`.

### 3. Marcado en la Barra de Herramientas (`index.html`)
- Añadir el botón en `.toolbar-group.tools`:
  `<button id="tool-<tool>" class="ui-btn tool-btn" title="Herramienta (T)" aria-label="Herramienta" aria-pressed="false"><svg>...</svg><span>Nombre</span><kbd>T</kbd></button>`

### 4. Sincronización y Enlace DOM (`src/main.ts`)
- En `setupUIBindings`: seleccionar el botón `#tool-<tool>`.
- En `syncToolButtons(tool)`: alternar clase `.active`, `aria-pressed` y texto en `#status-tool-label`.
- Registrar listener: `btn?.addEventListener('click', () => inputController.setTool('<tool>'))`.

### 5. Exportaciones (`src/index.ts`)
- Reexportar cualquier nuevo comando, tipo o helper creado en `src/index.ts`.

### 6. Pruebas Unitarias (`test/InputController.test.ts` o `test/<Tool>.test.ts`)
- Testear `setTool('<tool>')`, emisión de `toolChange` y respuesta a `dispatchSimulatedEvent`.

## Fragmento de Referencia (estilo del repositorio)
```ts
// src/input/InputController.ts
private handlePenMouseDown(x: number, y: number): void {
  const targetLayer = this.stateManager.getState().children[0];
  if (!targetLayer) return;
  if (this.activePathId === null) {
    const newPath: Path = {
      id: `path-${Date.now()}`,
      type: 'path',
      name: 'Trazado',
      x, y,
      points: [{ x, y, handleIn: { x, y }, handleOut: { x, y } }],
      stroke: '#38bdf8', strokeWidth: 2, fill: 'transparent', selected: true,
    };
    this.stateManager.addShape(targetLayer.id, newPath);
    this.activePathId = newPath.id;
  }
}
```

## Checklist
- [ ] Identificador añadido a `ToolMode` y exportado.
- [ ] Handlers implementados en `InputController` con limpieza en `setTool()`.
- [ ] Botón creado en `index.html` y enlazado en `setupUIBindings` (`src/main.ts`).
- [ ] Mutaciones registradas en `StateManager` con `Command` reversible.
- [ ] Tests añadidos y verificación exitosa con `npm test` y `npm run build`.
