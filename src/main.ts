import { StateManager } from './state/StateManager.ts';
import { injectSampleShapes, SAMPLE_SHAPES } from './state/injectSampleShapes.ts';
import { RenderEngine } from './render/RenderEngine.ts';
import { InputController, type ToolMode } from './input/InputController.ts';
import { CommandManager } from './commands/CommandManager.ts';
import { TranslateCommand } from './commands/TranslateCommand.ts';
import { StyleCommand } from './commands/StyleCommand.ts';
import { ReorderCommand } from './commands/ReorderCommand.ts';
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
  const btnDirectSelect = document.querySelector<HTMLButtonElement>('#tool-direct-select');
  const btnPen = document.querySelector<HTMLButtonElement>('#tool-pen');
  const btnRectangle = document.querySelector<HTMLButtonElement>('#tool-rectangle');
  const btnEllipse = document.querySelector<HTMLButtonElement>('#tool-ellipse');
  const btnUndo = document.querySelector<HTMLButtonElement>('#btn-undo');
  const btnRedo = document.querySelector<HTMLButtonElement>('#btn-redo');
  const btnExport = document.querySelector<HTMLButtonElement>('#btn-export, #btn-export-json');
  const btnImport = document.querySelector<HTMLButtonElement>('#btn-import');
  const fileImportInput = document.querySelector<HTMLInputElement>('#file-import-input');
  const statusToolLabel = document.querySelector<HTMLElement>('#status-tool-label');
  const statusShapesCount = document.querySelector<HTMLElement>('#status-shapes-count');
  const statusSelectionInfo = document.querySelector<HTMLElement>('#status-selection-info');
  const statusSelectionSeparator = document.querySelector<HTMLElement>('#status-selection-separator');

  // Controles del Panel de Propiedades
  const noSelectionState = document.querySelector<HTMLElement>('#no-selection-state');
  const selectionState = document.querySelector<HTMLElement>('#selection-state');
  const inputFill = document.querySelector<HTMLInputElement>('#input-fill');
  const inputStroke = document.querySelector<HTMLInputElement>('#input-stroke');
  const inputStrokeWidth = document.querySelector<HTMLInputElement>('#input-stroke-width');
  const btnBringToFront = document.querySelector<HTMLButtonElement>('#btn-bring-to-front');
  const btnSendToBack = document.querySelector<HTMLButtonElement>('#btn-send-to-back');
  const btnDuplicate = document.querySelector<HTMLButtonElement>('#btn-duplicate');
  const btnDeleteSelection = document.querySelector<HTMLButtonElement>('#btn-delete-selection');

  // Botón responsive para alternar panel lateral
  const btnTogglePanel = document.querySelector<HTMLButtonElement>('#btn-toggle-panel');

  // Elementos de la Barra de Menús Desplegables
  const menuBar = document.querySelector<HTMLElement>('.menu-bar');

  const menuBtnFile = document.querySelector<HTMLButtonElement>('#menu-btn-file');
  const menuBtnEdit = document.querySelector<HTMLButtonElement>('#menu-btn-edit');
  const menuBtnObject = document.querySelector<HTMLButtonElement>('#menu-btn-object');
  const menuBtnHelp = document.querySelector<HTMLButtonElement>('#menu-btn-help');

  const menuDropdownFile = document.querySelector<HTMLElement>('#menu-dropdown-file');
  const menuDropdownEdit = document.querySelector<HTMLElement>('#menu-dropdown-edit');
  const menuDropdownObject = document.querySelector<HTMLElement>('#menu-dropdown-object');
  const menuDropdownHelp = document.querySelector<HTMLElement>('#menu-dropdown-help');

  const menuItemImport = document.querySelector<HTMLButtonElement>('#menu-item-import');
  const menuItemExport = document.querySelector<HTMLButtonElement>('#menu-item-export');
  const menuItemUndo = document.querySelector<HTMLButtonElement>('#menu-item-undo');
  const menuItemRedo = document.querySelector<HTMLButtonElement>('#menu-item-redo');
  const menuItemCopy = document.querySelector<HTMLButtonElement>('#menu-item-copy');
  const menuItemPaste = document.querySelector<HTMLButtonElement>('#menu-item-paste');
  const menuItemDuplicate = document.querySelector<HTMLButtonElement>('#menu-item-duplicate');
  const menuItemDelete = document.querySelector<HTMLButtonElement>('#menu-item-delete');
  const menuItemBringToFront = document.querySelector<HTMLButtonElement>('#menu-item-bring-to-front');
  const menuItemSendToBack = document.querySelector<HTMLButtonElement>('#menu-item-send-to-back');
  const menuItemShortcuts = document.querySelector<HTMLButtonElement>('#menu-item-shortcuts');

  const shortcutsDialog = document.querySelector<HTMLDialogElement>('#shortcuts-dialog');
  const btnCloseShortcuts = document.querySelector<HTMLButtonElement>('#btn-close-shortcuts');
  const shortcutsDialogList = document.querySelector<HTMLElement>('#shortcuts-dialog-list');

  // 1. Sincronización de herramientas (InputController Event Emitter -> DOM)
  const syncToolButtons = (tool: ToolMode) => {
    if (btnSelect) {
      const isSelect = tool === 'select';
      btnSelect.classList.toggle('active', isSelect);
      btnSelect.setAttribute('aria-pressed', String(isSelect));
    }

    if (btnDirectSelect) {
      const isDirectSelect = tool === 'direct-select';
      btnDirectSelect.classList.toggle('active', isDirectSelect);
      btnDirectSelect.setAttribute('aria-pressed', String(isDirectSelect));
    }

    if (btnPen) {
      const isPen = tool === 'pen';
      btnPen.classList.toggle('active', isPen);
      btnPen.setAttribute('aria-pressed', String(isPen));
    }

    if (btnRectangle) {
      const isRect = tool === 'rectangle';
      btnRectangle.classList.toggle('active', isRect);
      btnRectangle.setAttribute('aria-pressed', String(isRect));
    }

    if (btnEllipse) {
      const isEllipse = tool === 'ellipse';
      btnEllipse.classList.toggle('active', isEllipse);
      btnEllipse.setAttribute('aria-pressed', String(isEllipse));
    }

    if (statusToolLabel) {
      statusToolLabel.textContent = `Modo: ${
        tool === 'pen'
          ? 'Pluma (Bézier)'
          : tool === 'direct-select'
            ? 'Selección Directa'
            : tool === 'rectangle'
              ? 'Rectángulo'
              : tool === 'ellipse'
                ? 'Elipse'
                : 'Selección'
      }`;
    }
    syncStatusBar();
  };

  const syncStatusBar = () => {
    if (statusShapesCount) {
      let count = 0;
      const doc = stateManager.getState();
      if (doc && doc.children) {
        for (const layer of doc.children) {
          if (layer.children) {
            count += layer.children.length;
          }
        }
      }
      statusShapesCount.textContent = count === 1 ? '1 figura' : `${count} figuras`;
    }

    const selectedShape = stateManager.getSelectedNode();
    if (statusSelectionInfo) {
      if (selectedShape) {
        const typeLabels: Record<string, string> = {
          rectangle: 'Rectángulo',
          ellipse: 'Elipse',
          path: 'Trazado',
        };
        const typeName = typeLabels[selectedShape.type] || selectedShape.type;
        statusSelectionInfo.textContent = `${selectedShape.name} (${typeName})`;
        if (statusSelectionInfo.style) {
          statusSelectionInfo.style.display = 'inline';
        }
        if (statusSelectionSeparator && statusSelectionSeparator.style) {
          statusSelectionSeparator.style.display = 'inline';
        }
      } else {
        statusSelectionInfo.textContent = '';
        if (statusSelectionInfo.style) {
          statusSelectionInfo.style.display = 'none';
        }
        if (statusSelectionSeparator && statusSelectionSeparator.style) {
          statusSelectionSeparator.style.display = 'none';
        }
      }
    }
  };

  // Suscripción al Event Emitter del InputController
  const unsubscribeToolChange = inputController.on('toolChange', (tool) => {
    syncToolButtons(tool);
  });

  // Clic en botones de herramientas -> InputController
  const onSelectClick = () => inputController.setTool('select');
  const onDirectSelectClick = () => inputController.setTool('direct-select');
  const onPenClick = () => inputController.setTool('pen');
  const onRectangleClick = () => inputController.setTool('rectangle');
  const onEllipseClick = () => inputController.setTool('ellipse');

  btnSelect?.addEventListener('click', onSelectClick);
  btnDirectSelect?.addEventListener('click', onDirectSelectClick);
  btnPen?.addEventListener('click', onPenClick);
  btnRectangle?.addEventListener('click', onRectangleClick);
  btnEllipse?.addEventListener('click', onEllipseClick);

  // Inicializar estado visual de herramientas
  syncToolButtons(inputController.currentTool);

  // Sincronización del estado de los ítems de menú desplegable
  function syncMenuItems(): void {
    const canUndo = commandManager.canUndo();
    const canRedo = commandManager.canRedo();

    if (menuItemUndo) {
      menuItemUndo.disabled = !canUndo;
      menuItemUndo.setAttribute('aria-disabled', String(!canUndo));
    }
    if (menuItemRedo) {
      menuItemRedo.disabled = !canRedo;
      menuItemRedo.setAttribute('aria-disabled', String(!canRedo));
    }

    const selectedShape = stateManager.getSelectedNode();
    const hasSelection = selectedShape !== null;

    if (menuItemCopy) {
      menuItemCopy.disabled = !hasSelection;
      menuItemCopy.setAttribute('aria-disabled', String(!hasSelection));
    }
    if (menuItemDuplicate) {
      menuItemDuplicate.disabled = !hasSelection;
      menuItemDuplicate.setAttribute('aria-disabled', String(!hasSelection));
    }
    if (menuItemDelete) {
      menuItemDelete.disabled = !hasSelection;
      menuItemDelete.setAttribute('aria-disabled', String(!hasSelection));
    }
    if (menuItemBringToFront) {
      menuItemBringToFront.disabled = !hasSelection;
      menuItemBringToFront.setAttribute('aria-disabled', String(!hasSelection));
    }
    if (menuItemSendToBack) {
      menuItemSendToBack.disabled = !hasSelection;
      menuItemSendToBack.setAttribute('aria-disabled', String(!hasSelection));
    }

    if (menuBtnObject) {
      menuBtnObject.disabled = !hasSelection;
      menuBtnObject.setAttribute('aria-disabled', String(!hasSelection));
    }

    const hasClipboard = (inputController as any).clipboard !== null;
    if (menuItemPaste) {
      menuItemPaste.disabled = !hasClipboard;
      menuItemPaste.setAttribute('aria-disabled', String(!hasClipboard));
    }
  }

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

    syncMenuItems();
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

    syncMenuItems();
    syncStatusBar();
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

  // Botones de orden de apilado (Traer al frente / Enviar al fondo)
  const onBringToFrontClick = () => {
    inputController.bringToFront();
  };

  const onSendToBackClick = () => {
    inputController.sendToBack();
  };

  btnBringToFront?.addEventListener('click', onBringToFrontClick);
  btnSendToBack?.addEventListener('click', onSendToBackClick);

  // Botón de duplicar figura seleccionada
  const onDuplicateClick = () => {
    inputController.duplicate();
  };

  btnDuplicate?.addEventListener('click', onDuplicateClick);

  // Botón de eliminar figura seleccionada en panel de acciones
  const onDeleteSelectionClick = () => {
    if (stateManager.getSelectedNode()) {
      inputController.deleteSelected();
    }
  };

  btnDeleteSelection?.addEventListener('click', onDeleteSelectionClick);

  // Botón responsive para alternar panel de propiedades en pantallas estrechas (< 900px)
  const onTogglePanelClick = () => {
    if (typeof document !== 'undefined' && document.body) {
      const isPanelOpen = document.body.classList.toggle('panel-open');
      btnTogglePanel?.setAttribute('aria-expanded', String(isPanelOpen));
    }
  };

  btnTogglePanel?.addEventListener('click', onTogglePanelClick);

  // Secciones plegables del panel de propiedades con persistencia en sesión
  const collapsibleSections: HTMLElement[] =
    typeof document.querySelectorAll === 'function'
      ? Array.from(document.querySelectorAll<HTMLElement>('.collapsible-section'))
      : [];
  const sectionToggleHandlers: Array<{ element: HTMLElement; handler: () => void }> = [];

  collapsibleSections.forEach((section) => {
    if (!section.id) return;
    try {
      if (typeof sessionStorage !== 'undefined') {
        const saved = sessionStorage.getItem(`panel-section-${section.id}`);
        if (saved !== null && 'open' in section) {
          (section as any).open = saved === 'true';
        }
      }
    } catch (_) {}

    const onToggle = () => {
      try {
        if (typeof sessionStorage !== 'undefined' && 'open' in section) {
          sessionStorage.setItem(`panel-section-${section.id}`, String((section as any).open));
        }
      } catch (_) {}
    };

    section.addEventListener('toggle', onToggle);
    sectionToggleHandlers.push({ element: section, handler: onToggle });
  });

  // 6. Menús Desplegables de la Barra Superior
  interface MenuEntry {
    trigger: HTMLButtonElement | null;
    dropdown: HTMLElement | null;
    items: (HTMLButtonElement | null)[];
  }

  const menuEntries: MenuEntry[] = [
    {
      trigger: menuBtnFile,
      dropdown: menuDropdownFile,
      items: [menuItemImport, menuItemExport],
    },
    {
      trigger: menuBtnEdit,
      dropdown: menuDropdownEdit,
      items: [
        menuItemUndo,
        menuItemRedo,
        menuItemCopy,
        menuItemPaste,
        menuItemDuplicate,
        menuItemDelete,
      ],
    },
    {
      trigger: menuBtnObject,
      dropdown: menuDropdownObject,
      items: [menuItemBringToFront, menuItemSendToBack],
    },
    {
      trigger: menuBtnHelp,
      dropdown: menuDropdownHelp,
      items: [menuItemShortcuts],
    },
  ];

  let activeMenuIndex = -1;

  const closeAllMenus = () => {
    activeMenuIndex = -1;
    for (const entry of menuEntries) {
      if (entry.trigger) {
        entry.trigger.setAttribute('aria-expanded', 'false');
        entry.trigger.classList?.remove('is-open');
      }
      if (entry.dropdown) {
        entry.dropdown.hidden = true;
        entry.dropdown.classList?.remove('is-open');
      }
    }
  };

  const openMenu = (index: number, focusFirstItem: boolean = false) => {
    if (index < 0 || index >= menuEntries.length) return;
    const entry = menuEntries[index];
    if (!entry.trigger || entry.trigger.disabled || entry.trigger.getAttribute('aria-disabled') === 'true') {
      return;
    }

    closeAllMenus();
    activeMenuIndex = index;
    syncMenuItems();

    entry.trigger.setAttribute('aria-expanded', 'true');
    entry.trigger.classList?.add('is-open');

    if (entry.dropdown) {
      entry.dropdown.hidden = false;
      entry.dropdown.classList?.add('is-open');

      if (focusFirstItem) {
        const enabledItems = entry.items.filter((it): it is HTMLButtonElement =>
          it !== null && !it.disabled && it.getAttribute('aria-disabled') !== 'true'
        );
        if (enabledItems.length > 0) {
          enabledItems[0].focus?.();
        }
      }
    }
  };

  const triggerClickHandlers = menuEntries.map((_, i) => () => {
    if (activeMenuIndex === i) {
      closeAllMenus();
    } else {
      openMenu(i, false);
    }
  });

  const triggerMouseEnterHandlers = menuEntries.map((_, i) => () => {
    if (activeMenuIndex !== -1 && activeMenuIndex !== i) {
      openMenu(i, false);
    }
  });

  const triggerKeyDownHandlers = menuEntries.map((_, index) => (e: KeyboardEvent) => {
    const key = e.key;
    if (key === 'ArrowRight') {
      e.preventDefault?.();
      const nextIndex = (index + 1) % menuEntries.length;
      menuEntries[nextIndex].trigger?.focus?.();
      if (activeMenuIndex !== -1) {
        openMenu(nextIndex, true);
      }
    } else if (key === 'ArrowLeft') {
      e.preventDefault?.();
      const prevIndex = (index - 1 + menuEntries.length) % menuEntries.length;
      menuEntries[prevIndex].trigger?.focus?.();
      if (activeMenuIndex !== -1) {
        openMenu(prevIndex, true);
      }
    } else if (key === 'ArrowDown' || key === 'Enter' || key === ' ') {
      e.preventDefault?.();
      openMenu(index, true);
    } else if (key === 'ArrowUp') {
      e.preventDefault?.();
      openMenu(index, false);
      const enabledItems = menuEntries[index].items.filter((it): it is HTMLButtonElement =>
        it !== null && !it.disabled && it.getAttribute('aria-disabled') !== 'true'
      );
      if (enabledItems.length > 0) {
        enabledItems[enabledItems.length - 1].focus?.();
      }
    } else if (key === 'Escape') {
      if (activeMenuIndex !== -1) {
        e.preventDefault?.();
        closeAllMenus();
      }
    }
  });

  const dropdownKeyDownHandlers = menuEntries.map((entry, menuIndex) => (e: KeyboardEvent) => {
    const key = e.key;
    const allItems = entry.items.filter(Boolean) as HTMLButtonElement[];
    const enabledItems = allItems.filter(it => !it.disabled && it.getAttribute('aria-disabled') !== 'true');
    const focusedItem = (typeof document !== 'undefined' ? document.activeElement : null) as HTMLButtonElement;
    const currentEnabledIndex = enabledItems.indexOf(focusedItem);

    if (key === 'ArrowDown') {
      e.preventDefault?.();
      if (enabledItems.length === 0) return;
      const nextIndex = currentEnabledIndex >= 0 ? (currentEnabledIndex + 1) % enabledItems.length : 0;
      enabledItems[nextIndex].focus?.();
    } else if (key === 'ArrowUp') {
      e.preventDefault?.();
      if (enabledItems.length === 0) return;
      const prevIndex = currentEnabledIndex >= 0
        ? (currentEnabledIndex - 1 + enabledItems.length) % enabledItems.length
        : enabledItems.length - 1;
      enabledItems[prevIndex].focus?.();
    } else if (key === 'ArrowRight') {
      e.preventDefault?.();
      const nextMenuIndex = (menuIndex + 1) % menuEntries.length;
      menuEntries[nextMenuIndex].trigger?.focus?.();
      openMenu(nextMenuIndex, true);
    } else if (key === 'ArrowLeft') {
      e.preventDefault?.();
      const prevMenuIndex = (menuIndex - 1 + menuEntries.length) % menuEntries.length;
      menuEntries[prevMenuIndex].trigger?.focus?.();
      openMenu(prevMenuIndex, true);
    } else if (key === 'Escape') {
      e.preventDefault?.();
      closeAllMenus();
      entry.trigger?.focus?.();
    } else if (key === 'Tab') {
      closeAllMenus();
    } else if (key === 'Enter' || key === ' ') {
      if (focusedItem && allItems.includes(focusedItem)) {
        if (!focusedItem.disabled && focusedItem.getAttribute('aria-disabled') !== 'true') {
          e.preventDefault?.();
          focusedItem.click();
        }
      }
    }
  });

  menuEntries.forEach((entry, i) => {
    entry.trigger?.addEventListener('click', triggerClickHandlers[i]);
    entry.trigger?.addEventListener('mouseenter', triggerMouseEnterHandlers[i]);
    entry.trigger?.addEventListener('keydown', triggerKeyDownHandlers[i]);
    entry.dropdown?.addEventListener('keydown', dropdownKeyDownHandlers[i]);
  });

  const onDocumentClick = (e: MouseEvent) => {
    if (activeMenuIndex === -1) return;
    const target = e.target as any;
    if (menuBar && typeof menuBar.contains === 'function') {
      if (!menuBar.contains(target)) {
        closeAllMenus();
      }
    } else {
      let isInside = false;
      for (const entry of menuEntries) {
        if (entry.trigger === target || entry.dropdown === target) {
          isInside = true;
          break;
        }
        if (entry.dropdown && typeof (entry.dropdown as any).contains === 'function' && (entry.dropdown as any).contains(target)) {
          isInside = true;
          break;
        }
      }
      if (!isInside) {
        closeAllMenus();
      }
    }
  };

  const onDocumentKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && activeMenuIndex !== -1) {
      e.preventDefault?.();
      const trigger = menuEntries[activeMenuIndex]?.trigger;
      closeAllMenus();
      trigger?.focus?.();
    }
  };

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onDocumentKeyDown);
  }

  // Acciones de los ítems de menú
  const onMenuImportClick = () => {
    closeAllMenus();
    fileImportInput?.click();
  };

  const onMenuExportClick = () => {
    closeAllMenus();
    onExportClick();
  };

  const onMenuUndoClick = () => {
    if (commandManager.canUndo()) {
      closeAllMenus();
      commandManager.undo();
      canvas?.focus?.();
    }
  };

  const onMenuRedoClick = () => {
    if (commandManager.canRedo()) {
      closeAllMenus();
      commandManager.redo();
      canvas?.focus?.();
    }
  };

  const onMenuCopyClick = () => {
    if (stateManager.getSelectedNode()) {
      closeAllMenus();
      inputController.copy();
      syncMenuItems();
      canvas?.focus?.();
    }
  };

  const onMenuPasteClick = () => {
    if ((inputController as any).clipboard) {
      closeAllMenus();
      inputController.paste();
      syncMenuItems();
      canvas?.focus?.();
    }
  };

  const onMenuDuplicateClick = () => {
    if (stateManager.getSelectedNode()) {
      closeAllMenus();
      inputController.duplicate();
      syncMenuItems();
      canvas?.focus?.();
    }
  };

  const onMenuDeleteClick = () => {
    if (stateManager.getSelectedNode()) {
      closeAllMenus();
      inputController.deleteSelected();
      syncMenuItems();
      canvas?.focus?.();
    }
  };

  const onMenuBringToFrontClick = () => {
    if (stateManager.getSelectedNode()) {
      closeAllMenus();
      inputController.bringToFront();
      canvas?.focus?.();
    }
  };

  const onMenuSendToBackClick = () => {
    if (stateManager.getSelectedNode()) {
      closeAllMenus();
      inputController.sendToBack();
      canvas?.focus?.();
    }
  };

  const populateShortcutsDialog = () => {
    if (!shortcutsDialogList) return;
    const shortcuts = typeof inputController.getShortcuts === 'function'
      ? inputController.getShortcuts()
      : (InputController as any).SHORTCUTS ?? [];

    shortcutsDialogList.innerHTML = '';
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      const table = document.createElement('table');
      table.className = 'shortcuts-table';
      const tbody = document.createElement('tbody');

      for (const item of shortcuts) {
        const tr = document.createElement('tr');

        const tdCat = document.createElement('td');
        tdCat.className = 'shortcut-category';
        tdCat.textContent = item.category;

        const tdDesc = document.createElement('td');
        tdDesc.className = 'shortcut-desc';
        tdDesc.textContent = item.description;

        const tdKey = document.createElement('td');
        tdKey.className = 'shortcut-key';
        tdKey.textContent = item.key;

        tr.appendChild(tdCat);
        tr.appendChild(tdDesc);
        tr.appendChild(tdKey);
        tbody.appendChild(tr);
      }

      table.appendChild(tbody);
      shortcutsDialogList.appendChild(table);
    }
  };

  const openShortcutsDialog = () => {
    if (!shortcutsDialog) return;
    populateShortcutsDialog();
    if (typeof shortcutsDialog.showModal === 'function') {
      shortcutsDialog.showModal();
    } else {
      shortcutsDialog.setAttribute('open', '');
      (shortcutsDialog as any).style = (shortcutsDialog as any).style || {};
      (shortcutsDialog as any).style.display = 'block';
    }
  };

  const closeShortcutsDialog = () => {
    if (!shortcutsDialog) return;
    if (typeof shortcutsDialog.close === 'function') {
      shortcutsDialog.close();
    } else {
      shortcutsDialog.removeAttribute('open');
      (shortcutsDialog as any).style = (shortcutsDialog as any).style || {};
      (shortcutsDialog as any).style.display = 'none';
    }
    menuBtnHelp?.focus?.();
  };

  const onMenuShortcutsClick = () => {
    closeAllMenus();
    openShortcutsDialog();
  };

  menuItemImport?.addEventListener('click', onMenuImportClick);
  menuItemExport?.addEventListener('click', onMenuExportClick);
  menuItemUndo?.addEventListener('click', onMenuUndoClick);
  menuItemRedo?.addEventListener('click', onMenuRedoClick);
  menuItemCopy?.addEventListener('click', onMenuCopyClick);
  menuItemPaste?.addEventListener('click', onMenuPasteClick);
  menuItemDuplicate?.addEventListener('click', onMenuDuplicateClick);
  menuItemDelete?.addEventListener('click', onMenuDeleteClick);
  menuItemBringToFront?.addEventListener('click', onMenuBringToFrontClick);
  menuItemSendToBack?.addEventListener('click', onMenuSendToBackClick);
  menuItemShortcuts?.addEventListener('click', onMenuShortcutsClick);
  btnCloseShortcuts?.addEventListener('click', closeShortcutsDialog);

  // Inicializar atajos en el diálogo
  populateShortcutsDialog();

  // 7. Observabilidad de dimensiones del contenedor del lienzo (ResizeObserver)
  const canvas = document.querySelector<HTMLCanvasElement>('#viewport-canvas');
  const canvasContainer = document.querySelector<HTMLElement>('#canvas-container, .canvas-viewport') ?? canvas;
  let resizeObserver: ResizeObserver | null = null;

  if (typeof ResizeObserver !== 'undefined' && canvasContainer) {
    resizeObserver = new ResizeObserver(() => {
      if (canvas) {
        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        const rect = canvas.getBoundingClientRect();
        const width = Math.max(1, Math.floor((rect.width || (typeof window !== 'undefined' ? window.innerWidth : 800)) * dpr));
        const height = Math.max(1, Math.floor((rect.height || (typeof window !== 'undefined' ? window.innerHeight : 600)) * dpr));

        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
      }
      stateManager.markDirty();
    });
    resizeObserver.observe(canvasContainer);
  }

  // Sincronizar estado inicial del panel y menús
  syncPropertiesPanel();
  syncHistoryButtons();
  syncMenuItems();
  syncStatusBar();

  return {
    cleanup: () => {
      resizeObserver?.disconnect();
      resizeObserver = null;
      unsubscribeToolChange();
      unsubscribeHistory();
      unsubscribeState();
      btnSelect?.removeEventListener('click', onSelectClick);
      btnDirectSelect?.removeEventListener('click', onDirectSelectClick);
      btnPen?.removeEventListener('click', onPenClick);
      btnRectangle?.removeEventListener('click', onRectangleClick);
      btnEllipse?.removeEventListener('click', onEllipseClick);
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

      btnBringToFront?.removeEventListener('click', onBringToFrontClick);
      btnSendToBack?.removeEventListener('click', onSendToBackClick);
      btnDuplicate?.removeEventListener('click', onDuplicateClick);
      btnDeleteSelection?.removeEventListener('click', onDeleteSelectionClick);
      btnTogglePanel?.removeEventListener('click', onTogglePanelClick);

      for (const { element, handler } of sectionToggleHandlers) {
        element.removeEventListener('toggle', handler);
      }

      menuEntries.forEach((entry, i) => {
        entry.trigger?.removeEventListener('click', triggerClickHandlers[i]);
        entry.trigger?.removeEventListener('mouseenter', triggerMouseEnterHandlers[i]);
        entry.trigger?.removeEventListener('keydown', triggerKeyDownHandlers[i]);
        entry.dropdown?.removeEventListener('keydown', dropdownKeyDownHandlers[i]);
      });

      menuItemImport?.removeEventListener('click', onMenuImportClick);
      menuItemExport?.removeEventListener('click', onMenuExportClick);
      menuItemUndo?.removeEventListener('click', onMenuUndoClick);
      menuItemRedo?.removeEventListener('click', onMenuRedoClick);
      menuItemCopy?.removeEventListener('click', onMenuCopyClick);
      menuItemPaste?.removeEventListener('click', onMenuPasteClick);
      menuItemDuplicate?.removeEventListener('click', onMenuDuplicateClick);
      menuItemDelete?.removeEventListener('click', onMenuDeleteClick);
      menuItemBringToFront?.removeEventListener('click', onMenuBringToFrontClick);
      menuItemSendToBack?.removeEventListener('click', onMenuSendToBackClick);
      menuItemShortcuts?.removeEventListener('click', onMenuShortcutsClick);
      btnCloseShortcuts?.removeEventListener('click', closeShortcutsDialog);

      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('click', onDocumentClick);
        document.removeEventListener('keydown', onDocumentKeyDown);
      }
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
      backgroundColor: '#141416',
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
  ReorderCommand,
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
