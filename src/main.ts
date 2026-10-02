import { StateManager } from './state/StateManager.ts';
import { injectSampleShapes, SAMPLE_SHAPES } from './state/injectSampleShapes.ts';
import { RenderEngine } from './render/RenderEngine.ts';
import { InputController, type ToolMode } from './input/InputController.ts';
import { CommandManager } from './commands/CommandManager.ts';
import { TranslateCommand } from './commands/TranslateCommand.ts';
import { StyleCommand } from './commands/StyleCommand.ts';
import { Serializer } from './state/Serializer.ts';
import type { Path, Shape } from './types/scene-graph.ts';

console.log('%c[Vector Editor - Scene Graph, RenderEngine, Pluma & Observabilidad DOM]', 'color: #38bdf8; font-weight: bold; font-size: 15px;');

// 1. Inicializar el StateManager inmutable y el CommandManager
const commandManager = new CommandManager();
const stateManager = new StateManager(undefined, commandManager);
const moduleStateManager = stateManager;

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
 * Convierte cualquier formato de color (hexadecimal corto/largo, rgb/rgba o nombres/nulos/transparentes)
 * en un código hexadecimal válido de 7 caracteres (#rrggbb) aceptado por <input type="color">.
 */
export function toValidHexColor(color: string | undefined | null, fallback: string = '#000000'): string {
  if (!color || color === 'transparent' || color === 'none') {
    return fallback;
  }
  const trimmed = color.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
    return trimmed;
  }
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
  }
  const rgbMatch = trimmed.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch) {
    const r = Math.min(255, Math.max(0, parseInt(rgbMatch[1], 10))).toString(16).padStart(2, '0');
    const g = Math.min(255, Math.max(0, parseInt(rgbMatch[2], 10))).toString(16).padStart(2, '0');
    const b = Math.min(255, Math.max(0, parseInt(rgbMatch[3], 10))).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }
  return fallback;
}

/**
 * Sistema de observabilidad y binding reactivo entre los controles HTML del DOM y el estado de la aplicación.
 * Desvincula por completo la lógica del canvas de la manipulación del DOM:
 * - Escucha eventos del CommandManager para alternar las clases CSS (.disabled / .is-disabled) de Deshacer/Rehacer.
 * - Escucha el Event Emitter de InputController ('toolChange') para actualizar las clases .active en los botones de herramienta.
 * - Conecta el botón de exportación para serializar el Scene Graph y forzar la descarga de un archivo JSON.
 * - Sincroniza el Panel de Propiedades de la figura seleccionada con previsualización en vivo y registro de comandos.
 */
export function setupUIBindings(
  inputController: InputController,
  commandManager: CommandManager,
  stateManagerInstance?: StateManager
): { cleanup: () => void } {
  if (typeof document === 'undefined') {
    return { cleanup: () => {} };
  }

  const stateManager = stateManagerInstance ?? (inputController as any).stateManager ?? moduleStateManager;

  const btnSelect = document.querySelector<HTMLButtonElement>('#tool-select');
  const btnPen = document.querySelector<HTMLButtonElement>('#tool-pen');
  const btnUndo = document.querySelector<HTMLButtonElement>('#btn-undo');
  const btnRedo = document.querySelector<HTMLButtonElement>('#btn-redo');
  const btnExport = document.querySelector<HTMLButtonElement>('#btn-export, #btn-export-json');
  const btnImport = document.querySelector<HTMLButtonElement>('#btn-import');
  const fileImportInput = document.querySelector<HTMLInputElement>('#file-import-input');
  const statusToolLabel = document.querySelector<HTMLElement>('#status-tool-label');

  // Controles del Panel de Propiedades
  const noSelectionState = document.querySelector<HTMLElement>('#no-selection-state');
  const selectionState = document.querySelector<HTMLElement>('#selection-state');
  const inputFill = document.querySelector<HTMLInputElement>('#input-fill');
  const inputStroke = document.querySelector<HTMLInputElement>('#input-stroke');
  const inputStrokeWidth = document.querySelector<HTMLInputElement>('#input-stroke-width');

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

  // 3. Exportación y Descarga de JSON (Serializer -> DOM)
  const onExportClick = () => {
    if (stateManager) {
      const jsonContent = Serializer.serializeDocument(stateManager.getState());
      Serializer.downloadJson('vector-scene.json', jsonContent);
      console.log('💾 [Serializer] Documento serializado y descargado como vector-scene.json');
    }
  };

  btnExport?.addEventListener('click', onExportClick);

  // 4. Importación de JSON (Input File -> FileReader -> Serializer -> StateManager & CommandManager)
  const onImportClick = (e: MouseEvent) => {
    if (e.target !== fileImportInput) {
      fileImportInput?.click();
    }
  };

  const onFileInputClick = (e: MouseEvent) => {
    e.stopPropagation?.();
  };

  const onFileChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file || !stateManager) return;

    const readWithFileReader = (f: Blob | File) => {
      const reader = new FileReader();

      reader.onload = async () => {
        try {
          const text = typeof reader.result === 'string' ? reader.result : '';
          const doc = await Serializer.parseDocument(text);
          stateManager.loadState(doc);
          commandManager.clear();
          console.log('📂 [Serializer] Documento importado y cargado con éxito:', doc);
        } catch (error) {
          console.error('❌ Error al importar documento JSON:', error);
          if (typeof alert !== 'undefined') {
            alert(`Error al importar el archivo JSON: ${error instanceof Error ? error.message : String(error)}`);
          }
        } finally {
          target.value = '';
        }
      };

      reader.onerror = () => {
        console.error('❌ Error al leer el archivo con FileReader:', reader.error);
        target.value = '';
      };

      reader.readAsText(f);
    };

    if (typeof FileReader !== 'undefined') {
      readWithFileReader(file);
    } else if (typeof (file as any).text === 'function') {
      (async () => {
        try {
          const text = await (file as any).text();
          const doc = await Serializer.parseDocument(text);
          stateManager.loadState(doc);
          commandManager.clear();
        } catch (error) {
          console.error('❌ Error al importar documento JSON:', error);
        } finally {
          target.value = '';
        }
      })();
    }
  };

  btnImport?.addEventListener('click', onImportClick);
  fileImportInput?.addEventListener('click', onFileInputClick);
  fileImportInput?.addEventListener('change', onFileChange);

  // 5. Panel de Propiedades de Figuras (Observabilidad de Selección & Edición Reactiva)
  let initialStyleSnapshot: Partial<Shape> | null = null;
  let editingShapeId: string | null = null;

  const captureInitialStyle = () => {
    const selected = stateManager.getSelectedNode();
    if (selected) {
      editingShapeId = selected.id;
      initialStyleSnapshot = {
        fill: selected.fill,
        stroke: selected.stroke,
        strokeWidth: selected.strokeWidth,
      };
    }
  };

  const syncPropertiesPanel = () => {
    const selectedShape = stateManager.getSelectedNode();

    if (selectedShape) {
      if (selectionState) {
        if (!selectionState.style) (selectionState as any).style = {};
        selectionState.style.display = 'block';
      }
      if (noSelectionState) {
        if (!noSelectionState.style) (noSelectionState as any).style = {};
        noSelectionState.style.display = 'none';
      }

      const isEditing = editingShapeId !== null;
      if (inputFill && (!isEditing || (typeof document !== 'undefined' && document.activeElement !== inputFill))) {
        inputFill.value = toValidHexColor(selectedShape.fill, '#000000');
      }
      if (inputStroke && (!isEditing || (typeof document !== 'undefined' && document.activeElement !== inputStroke))) {
        inputStroke.value = toValidHexColor(selectedShape.stroke, '#000000');
      }
      if (inputStrokeWidth && (!isEditing || (typeof document !== 'undefined' && document.activeElement !== inputStrokeWidth))) {
        inputStrokeWidth.value = String(selectedShape.strokeWidth ?? 1);
      }
    } else {
      if (selectionState) {
        if (!selectionState.style) (selectionState as any).style = {};
        selectionState.style.display = 'none';
      }
      if (noSelectionState) {
        if (!noSelectionState.style) (noSelectionState as any).style = {};
        noSelectionState.style.display = 'block';
      }
      initialStyleSnapshot = null;
      editingShapeId = null;
    }
  };

  // Suscripción al StateManager para sincronizar selección y estilos
  const unsubscribeState = stateManager.subscribe(() => {
    syncPropertiesPanel();
  });

  // Capturar estilos iniciales al iniciar interacción (mousedown, click, focus)
  const onInputStart = () => {
    captureInitialStyle();
  };

  inputFill?.addEventListener('mousedown', onInputStart);
  inputFill?.addEventListener('click', onInputStart);
  inputFill?.addEventListener('focus', onInputStart);

  inputStroke?.addEventListener('mousedown', onInputStart);
  inputStroke?.addEventListener('click', onInputStart);
  inputStroke?.addEventListener('focus', onInputStart);

  inputStrokeWidth?.addEventListener('mousedown', onInputStart);
  inputStrokeWidth?.addEventListener('click', onInputStart);
  inputStrokeWidth?.addEventListener('focus', onInputStart);

  // Previsualización en vivo (evento 'input'): actualiza directamente en StateManager sin registrar comando
  const onFillInput = () => {
    const selected = stateManager.getSelectedNode();
    if (!selected || !inputFill) return;
    if (!initialStyleSnapshot) {
      captureInitialStyle();
    }
    stateManager.updateShape(selected.id, { fill: inputFill.value });
  };

  const onStrokeInput = () => {
    const selected = stateManager.getSelectedNode();
    if (!selected || !inputStroke) return;
    if (!initialStyleSnapshot) {
      captureInitialStyle();
    }
    stateManager.updateShape(selected.id, { stroke: inputStroke.value });
  };

  const onStrokeWidthInput = () => {
    const selected = stateManager.getSelectedNode();
    if (!selected || !inputStrokeWidth) return;
    if (!initialStyleSnapshot) {
      captureInitialStyle();
    }
    const parsed = parseFloat(inputStrokeWidth.value);
    const strokeWidth = isNaN(parsed) ? 1 : Math.max(0, parsed);
    stateManager.updateShape(selected.id, { strokeWidth });
  };

  inputFill?.addEventListener('input', onFillInput);
  inputStroke?.addEventListener('input', onStrokeInput);
  inputStrokeWidth?.addEventListener('input', onStrokeWidthInput);

  // Consolidación final (evento 'change'): genera StyleCommand y registra en CommandManager
  const onFillChange = () => {
    const shapeId = editingShapeId || stateManager.getSelectedNode()?.id;
    if (!shapeId || !inputFill) return;

    if (!initialStyleSnapshot) {
      captureInitialStyle();
    }

    const initialVal = initialStyleSnapshot?.fill;
    const finalVal = inputFill.value;

    stateManager.updateShape(shapeId, { fill: finalVal });

    if (initialVal !== finalVal) {
      const command = new StyleCommand(
        stateManager,
        shapeId,
        { fill: initialVal },
        { fill: finalVal }
      );
      commandManager.recordCommand(command);
    }

    initialStyleSnapshot = null;
    editingShapeId = null;
  };

  const onStrokeChange = () => {
    const shapeId = editingShapeId || stateManager.getSelectedNode()?.id;
    if (!shapeId || !inputStroke) return;

    if (!initialStyleSnapshot) {
      captureInitialStyle();
    }

    const initialVal = initialStyleSnapshot?.stroke;
    const finalVal = inputStroke.value;

    stateManager.updateShape(shapeId, { stroke: finalVal });

    if (initialVal !== finalVal) {
      const command = new StyleCommand(
        stateManager,
        shapeId,
        { stroke: initialVal },
        { stroke: finalVal }
      );
      commandManager.recordCommand(command);
    }

    initialStyleSnapshot = null;
    editingShapeId = null;
  };

  const onStrokeWidthChange = () => {
    const shapeId = editingShapeId || stateManager.getSelectedNode()?.id;
    if (!shapeId || !inputStrokeWidth) return;

    if (!initialStyleSnapshot) {
      captureInitialStyle();
    }

    const parsed = parseFloat(inputStrokeWidth.value);
    const strokeWidth = isNaN(parsed) ? 1 : Math.max(0, parsed);
    const initialVal = initialStyleSnapshot?.strokeWidth;
    const finalVal = strokeWidth;

    stateManager.updateShape(shapeId, { strokeWidth: finalVal });

    if (initialVal !== finalVal) {
      const command = new StyleCommand(
        stateManager,
        shapeId,
        { strokeWidth: initialVal },
        { strokeWidth: finalVal }
      );
      commandManager.recordCommand(command);
    }

    initialStyleSnapshot = null;
    editingShapeId = null;
  };

  inputFill?.addEventListener('change', onFillChange);
  inputStroke?.addEventListener('change', onStrokeChange);
  inputStrokeWidth?.addEventListener('change', onStrokeWidthChange);

  // Sincronizar estado inicial del panel
  syncPropertiesPanel();

  return {
    cleanup: () => {
      unsubscribeToolChange();
      unsubscribeHistory();
      unsubscribeState();
      btnSelect?.removeEventListener('click', onSelectClick);
      btnPen?.removeEventListener('click', onPenClick);
      btnUndo?.removeEventListener('click', onUndoClick);
      btnRedo?.removeEventListener('click', onRedoClick);
      btnExport?.removeEventListener('click', onExportClick);
      btnImport?.removeEventListener('click', onImportClick);
      fileImportInput?.removeEventListener('click', onFileInputClick);
      fileImportInput?.removeEventListener('change', onFileChange);

      inputFill?.removeEventListener('mousedown', onInputStart);
      inputFill?.removeEventListener('click', onInputStart);
      inputFill?.removeEventListener('focus', onInputStart);
      inputFill?.removeEventListener('input', onFillInput);
      inputFill?.removeEventListener('change', onFillChange);

      inputStroke?.removeEventListener('mousedown', onInputStart);
      inputStroke?.removeEventListener('click', onInputStart);
      inputStroke?.removeEventListener('focus', onInputStart);
      inputStroke?.removeEventListener('input', onStrokeInput);
      inputStroke?.removeEventListener('change', onStrokeChange);

      inputStrokeWidth?.removeEventListener('mousedown', onInputStart);
      inputStrokeWidth?.removeEventListener('click', onInputStart);
      inputStrokeWidth?.removeEventListener('focus', onInputStart);
      inputStrokeWidth?.removeEventListener('input', onStrokeWidthInput);
      inputStrokeWidth?.removeEventListener('change', onStrokeWidthChange);
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
    uiBindings = setupUIBindings(inputController, commandManager, stateManager);

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
  StyleCommand,
  toValidHexColor,
  injectSampleShapes,
  setupUIBindings,
  Serializer,
  serializeDocument: Serializer.serializeDocument,
  downloadJson: Serializer.downloadJson,
  parseDocument: Serializer.parseDocument,
};

if (typeof window !== 'undefined') {
  Object.assign(window, globals);
} else if (typeof globalThis !== 'undefined') {
  Object.assign(globalThis, globals);
}
