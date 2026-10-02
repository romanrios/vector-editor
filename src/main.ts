import { StateManager } from './state/StateManager.ts';
import { injectSampleShapes, SAMPLE_SHAPES } from './state/injectSampleShapes.ts';
import { RenderEngine } from './render/RenderEngine.ts';
import { InputController, type ToolMode } from './input/InputController.ts';
import { CommandManager } from './commands/CommandManager.ts';
import { TranslateCommand } from './commands/TranslateCommand.ts';
import type { Path } from './types/scene-graph.ts';

console.log('%c[Vector Editor - Scene Graph, RenderEngine, Pluma & Observabilidad DOM]', 'color: #38bdf8; font-weight: bold; font-size: 15px;');

// 1. Inicializar el StateManager inmutable y el CommandManager
const stateManager = new StateManager();
const commandManager = new CommandManager();

// 2. Inyectar las 3 figuras de prueba hardcodeadas iniciales
injectSampleShapes(stateManager);
console.log('✅ Figuras de prueba cargadas:', SAMPLE_SHAPES);

// 3. Inyectar un trazado vectorial Path con múltiples curvas Bézier cúbicas de demostración
const samplePath: Path = {
  id: 'shape-path-sample',
  type: 'path',
  name: 'Curva Bézier S (Trazado)',
  x: 120,
  y: 450,
  points: [
    { x: 120, y: 480, handleOut: { x: 220, y: 390 } },
    { x: 340, y: 480, handleIn: { x: 260, y: 570 }, handleOut: { x: 420, y: 390 } },
    { x: 540, y: 480, handleIn: { x: 460, y: 570 } },
  ],
  stroke: '#38bdf8',
  strokeWidth: 4,
  fill: 'transparent',
  visible: true,
  locked: false,
};
stateManager.addShape(stateManager.getState().children[0].id, samplePath);

console.log('✅ Estado inicial cargado con figuras y trazado vectorial Bézier.');

/**
 * Sistema de observabilidad y binding reactivo entre los controles HTML del DOM y el estado de la aplicación.
 * Desvincula por completo la lógica del canvas de la manipulación del DOM:
 * - Escucha eventos del CommandManager para alternar las clases CSS (.disabled / .is-disabled) de Deshacer/Rehacer.
 * - Escucha el Event Emitter de InputController ('toolChange') para actualizar las clases .active en los botones de herramienta.
 */
export function setupUIBindings(
  inputController: InputController,
  commandManager: CommandManager
): { cleanup: () => void } {
  if (typeof document === 'undefined') {
    return { cleanup: () => {} };
  }

  const btnSelect = document.querySelector<HTMLButtonElement>('#tool-select');
  const btnPen = document.querySelector<HTMLButtonElement>('#tool-pen');
  const btnUndo = document.querySelector<HTMLButtonElement>('#btn-undo');
  const btnRedo = document.querySelector<HTMLButtonElement>('#btn-redo');
  const statusToolLabel = document.querySelector<HTMLElement>('#status-tool-label');

  // 1. Sincronización de herramientas (InputController Event Emitter -> DOM)
  const syncToolButtons = (tool: ToolMode) => {
    if (btnSelect) {
      const isSelect = tool === 'select';
      btnSelect.classList.toggle('active', isSelect);
      btnSelect.setAttribute('aria-pressed', String(isSelect));
    }

    if (btnPen) {
      const isPen = tool === 'pen';
      btnPen.classList.toggle('active', isPen);
      btnPen.setAttribute('aria-pressed', String(isPen));
    }

    if (statusToolLabel) {
      statusToolLabel.textContent = `Modo: ${tool === 'pen' ? 'Pluma (Bézier)' : 'Selección'}`;
    }
  };

  // Suscripción al Event Emitter del InputController
  const unsubscribeToolChange = inputController.on('toolChange', (tool) => {
    syncToolButtons(tool);
  });

  // Clic en botones de herramientas -> InputController
  const onSelectClick = () => inputController.setTool('select');
  const onPenClick = () => inputController.setTool('pen');

  btnSelect?.addEventListener('click', onSelectClick);
  btnPen?.addEventListener('click', onPenClick);

  // Inicializar estado visual de herramientas
  syncToolButtons(inputController.currentTool);

  // 2. Sincronización de historial (CommandManager Event Emitter -> DOM)
  const syncHistoryButtons = () => {
    const canUndo = commandManager.canUndo();
    const canRedo = commandManager.canRedo();

    if (btnUndo) {
      btnUndo.disabled = !canUndo;
      btnUndo.classList.toggle('disabled', !canUndo);
      btnUndo.classList.toggle('is-disabled', !canUndo);
    }

    if (btnRedo) {
      btnRedo.disabled = !canRedo;
      btnRedo.classList.toggle('disabled', !canRedo);
      btnRedo.classList.toggle('is-disabled', !canRedo);
    }
  };

  // Suscripción a eventos del CommandManager
  const unsubscribeHistory = commandManager.on('change', () => {
    syncHistoryButtons();
  });

  // Clic en botones de historial -> CommandManager
  const onUndoClick = () => commandManager.undo();
  const onRedoClick = () => commandManager.redo();

  btnUndo?.addEventListener('click', onUndoClick);
  btnRedo?.addEventListener('click', onRedoClick);

  // Inicializar estado visual de botones de historial
  syncHistoryButtons();

  return {
    cleanup: () => {
      unsubscribeToolChange();
      unsubscribeHistory();
      btnSelect?.removeEventListener('click', onSelectClick);
      btnPen?.removeEventListener('click', onPenClick);
      btnUndo?.removeEventListener('click', onUndoClick);
      btnRedo?.removeEventListener('click', onRedoClick);
    },
  };
}

// 4. Vincular el RenderEngine e InputController al elemento <canvas> de pantalla completa
let renderEngine: RenderEngine | null = null;
let inputController: InputController | null = null;
let uiBindings: { cleanup: () => void } | null = null;

if (typeof document !== 'undefined') {
  const canvas = document.querySelector<HTMLCanvasElement>('#viewport-canvas');

  if (canvas) {
    // Motor de Renderizado
    renderEngine = new RenderEngine(canvas, stateManager, {
      highDpi: true,
      backgroundColor: '#0f172a',
    });
    renderEngine.start();

    // Controlador de Entrada con herramientas de Selección y Pluma
    inputController = new InputController(canvas, stateManager, commandManager);

    // Sistema de observabilidad DOM <-> Estado
    uiBindings = setupUIBindings(inputController, commandManager);

    console.log('🚀 RenderEngine iniciado con soporte para primitivas Path (bezierCurveTo).');
    console.log('✒️  Herramienta Pluma:');
    console.log('   - Presiona "P" o haz clic en la toolbar para activar la Pluma.');
    console.log('   - Clic para crear un punto de ancla.');
    console.log('   - Arrastra para definir los puntos de control tangentes.');
    console.log('   - Presiona "Escape", "Enter" o clic en el inicio para finalizar el trazado.');
    console.log('   - Presiona "V" para volver a la herramienta Selección.');
    console.log('🎯 Hit-Testing no rectangular activo: haz clic sobre la curva Bézier para seleccionarla.');
  }
}

// 5. Suscripción para depuración de selección
stateManager.subscribe(() => {
  const selectedShape = stateManager.getSelectedNode();
  if (selectedShape) {
    console.log(`🔷 [Nodo Seleccionado]: "${selectedShape.name}" (${selectedShape.type})`, selectedShape);
  }
});

// 6. Suscripción para depuración del historial de comandos
commandManager.subscribe((undoCount, redoCount) => {
  console.log(`📜 [Historial de Comandos]: Deshacer (${undoCount}) | Rehacer (${redoCount})`);
});

// 7. Exponer las instancias en el objeto global para inspección interactiva
const globals = {
  stateManager,
  renderEngine,
  inputController,
  commandManager,
  uiBindings,
  TranslateCommand,
  injectSampleShapes,
  setupUIBindings,
};

if (typeof window !== 'undefined') {
  Object.assign(window, globals);
} else if (typeof globalThis !== 'undefined') {
  Object.assign(globalThis, globals);
}
