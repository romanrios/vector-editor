import { StateManager } from './state/StateManager.ts';
import { injectSampleShapes, SAMPLE_SHAPES } from './state/injectSampleShapes.ts';
import { RenderEngine } from './render/RenderEngine.ts';
import { InputController } from './input/InputController.ts';
import { CommandManager } from './commands/CommandManager.ts';
import { TranslateCommand } from './commands/TranslateCommand.ts';
import type { Path } from './types/scene-graph.ts';

console.log('%c[Vector Editor - Scene Graph, RenderEngine, Pluma & Hit-Testing]', 'color: #38bdf8; font-weight: bold; font-size: 15px;');

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

// 4. Vincular el RenderEngine e InputController al elemento <canvas> de pantalla completa
let renderEngine: RenderEngine | null = null;
let inputController: InputController | null = null;

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

    console.log('🚀 RenderEngine iniciado con soporte para primitivas Path (bezierCurveTo).');
    console.log('✒️  Herramienta Pluma:');
    console.log('   - Presiona "P" para activar la Pluma.');
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
  TranslateCommand,
  injectSampleShapes,
};

if (typeof window !== 'undefined') {
  Object.assign(window, globals);
} else if (typeof globalThis !== 'undefined') {
  Object.assign(globalThis, globals);
}
