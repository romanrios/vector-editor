import { StateManager } from './state/StateManager.ts';
import { injectSampleShapes, SAMPLE_SHAPES } from './state/injectSampleShapes.ts';
import { RenderEngine } from './render/RenderEngine.ts';
import { InputController, type ToolMode } from './input/InputController.ts';
import { CommandManager } from './commands/CommandManager.ts';
import { TranslateCommand } from './commands/TranslateCommand.ts';
import { StyleCommand } from './commands/StyleCommand.ts';
import { ReorderCommand } from './commands/ReorderCommand.ts';
import { BatchCommand } from './commands/BatchCommand.ts';
import { Serializer } from './state/Serializer.ts';
import { ViewportManager } from './utils/viewport.ts';
import type { Path, Shape } from './types/scene-graph.ts';
import type { AlignmentMode, DistributionAxis } from './utils/geometry.ts';

function debug(...args: unknown[]): void {
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
    console.log(...args);
  }
}

debug('%c[Vector Editor - Scene Graph, RenderEngine, Pluma & Observabilidad DOM]', 'color: #38bdf8; font-weight: bold; font-size: 15px;');

// 1. Inicializar el StateManager inmutable, el CommandManager y el ViewportManager
const commandManager = new CommandManager();
const stateManager = new StateManager(undefined, commandManager);
const viewportManager = new ViewportManager();
const moduleStateManager = stateManager;

// 2. Inyectar las 3 figuras de prueba hardcodeadas iniciales
injectSampleShapes(stateManager);
debug('✅ Figuras de prueba cargadas:', SAMPLE_SHAPES);

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

debug('✅ Estado inicial cargado con figuras y trazado vectorial Bézier.');

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

  const stateManager = stateManagerInstance ?? inputController.stateManager ?? moduleStateManager;

  const btnSelect = document.querySelector<HTMLButtonElement>('#tool-select');
  const btnDirectSelect = document.querySelector<HTMLButtonElement>('#tool-direct-select');
  const btnHand = document.querySelector<HTMLButtonElement>('#tool-hand');
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

  // Controles de Navegación y Zoom en la Barra de Estado
  const statusZoomBtn = document.querySelector<HTMLButtonElement>('#status-zoom-btn');
  const statusZoomLabel = document.querySelector<HTMLElement>('#status-zoom-label');
  const zoomDropdown = document.querySelector<HTMLElement>('#zoom-dropdown');
  const zoomPresetItems = (typeof document.querySelectorAll === 'function'
    ? Array.from(document.querySelectorAll<HTMLButtonElement>('.zoom-dropdown-item'))
    : []) as HTMLButtonElement[];

  // Gestor de Vista
  const viewportManager = inputController.viewportManager ?? new ViewportManager();

  // Controles del Panel de Propiedades
  const panelTitle = document.querySelector<HTMLElement>('#panel-title, .panel-title');
  const noSelectionState = document.querySelector<HTMLElement>('#no-selection-state');
  const selectionState = document.querySelector<HTMLElement>('#selection-state');
  const inputFill = document.querySelector<HTMLInputElement>('#input-fill');
  const inputStroke = document.querySelector<HTMLInputElement>('#input-stroke');
  const inputStrokeWidth = document.querySelector<HTMLInputElement>('#input-stroke-width');
  const btnBringToFront = document.querySelector<HTMLButtonElement>('#btn-bring-to-front');
  const btnSendToBack = document.querySelector<HTMLButtonElement>('#btn-send-to-back');
  const btnDuplicate = document.querySelector<HTMLButtonElement>('#btn-duplicate');
  const btnDeleteSelection = document.querySelector<HTMLButtonElement>('#btn-delete-selection');

  // Sección Alinear y Distribuir en Panel de Propiedades
  const sectionAlign = document.querySelector<HTMLDetailsElement>('#section-align');
  const btnAlignLeft = document.querySelector<HTMLButtonElement>('#btn-align-left');
  const btnAlignCenterH = document.querySelector<HTMLButtonElement>('#btn-align-center-h');
  const btnAlignRight = document.querySelector<HTMLButtonElement>('#btn-align-right');
  const btnDistributeH = document.querySelector<HTMLButtonElement>('#btn-distribute-h');
  const btnAlignTop = document.querySelector<HTMLButtonElement>('#btn-align-top');
  const btnAlignCenterV = document.querySelector<HTMLButtonElement>('#btn-align-center-v');
  const btnAlignBottom = document.querySelector<HTMLButtonElement>('#btn-align-bottom');
  const btnDistributeV = document.querySelector<HTMLButtonElement>('#btn-distribute-v');

  // Botón responsive para alternar panel lateral
  const btnTogglePanel = document.querySelector<HTMLButtonElement>('#btn-toggle-panel');

  // Elementos de la Barra de Menús Desplegables
  const menuBar = document.querySelector<HTMLElement>('.menu-bar');

  const menuBtnFile = document.querySelector<HTMLButtonElement>('#menu-btn-file');
  const menuBtnEdit = document.querySelector<HTMLButtonElement>('#menu-btn-edit');
  const menuBtnObject = document.querySelector<HTMLButtonElement>('#menu-btn-object');
  const menuBtnView = document.querySelector<HTMLButtonElement>('#menu-btn-view');
  const menuBtnHelp = document.querySelector<HTMLButtonElement>('#menu-btn-help');

  const menuDropdownFile = document.querySelector<HTMLElement>('#menu-dropdown-file');
  const menuDropdownEdit = document.querySelector<HTMLElement>('#menu-dropdown-edit');
  const menuDropdownObject = document.querySelector<HTMLElement>('#menu-dropdown-object');
  const menuDropdownView = document.querySelector<HTMLElement>('#menu-dropdown-view');
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

  // Submenús Alinear y Distribuir en Menú Objeto
  const menuItemAlign = document.querySelector<HTMLButtonElement>('#menu-item-align');
  const menuDropdownAlign = document.querySelector<HTMLElement>('#menu-dropdown-align');
  const menuItemAlignLeft = document.querySelector<HTMLButtonElement>('#menu-item-align-left');
  const menuItemAlignCenterH = document.querySelector<HTMLButtonElement>('#menu-item-align-center-h');
  const menuItemAlignRight = document.querySelector<HTMLButtonElement>('#menu-item-align-right');
  const menuItemAlignTop = document.querySelector<HTMLButtonElement>('#menu-item-align-top');
  const menuItemAlignCenterV = document.querySelector<HTMLButtonElement>('#menu-item-align-center-v');
  const menuItemAlignBottom = document.querySelector<HTMLButtonElement>('#menu-item-align-bottom');

  const menuItemDistribute = document.querySelector<HTMLButtonElement>('#menu-item-distribute');
  const menuDropdownDistribute = document.querySelector<HTMLElement>('#menu-dropdown-distribute');
  const menuItemDistributeH = document.querySelector<HTMLButtonElement>('#menu-item-distribute-h');
  const menuItemDistributeV = document.querySelector<HTMLButtonElement>('#menu-item-distribute-v');
  const menuItemZoomIn = document.querySelector<HTMLButtonElement>('#menu-item-zoom-in');
  const menuItemZoomOut = document.querySelector<HTMLButtonElement>('#menu-item-zoom-out');
  const menuItemZoomFit = document.querySelector<HTMLButtonElement>('#menu-item-zoom-fit');
  const menuItemZoom100 = document.querySelector<HTMLButtonElement>('#menu-item-zoom-100');
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

    if (btnHand) {
      const isHand = tool === 'hand';
      btnHand.classList.toggle('active', isHand);
      btnHand.setAttribute('aria-pressed', String(isHand));
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
                : tool === 'hand'
                  ? 'Mano'
                  : 'Selección'
      }`;
    }
    syncStatusBar();
  };

  const syncStatusBar = (selectedNodes: readonly Shape[] = stateManager.getSelectedNodes()) => {
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

    if (statusSelectionInfo) {
      if (selectedNodes.length === 1) {
        const selectedShape = selectedNodes[0];
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
      } else if (selectedNodes.length > 1) {
        statusSelectionInfo.textContent = `${selectedNodes.length} figuras seleccionadas`;
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
  const onHandClick = () => inputController.setTool('hand');
  const onPenClick = () => inputController.setTool('pen');
  const onRectangleClick = () => inputController.setTool('rectangle');
  const onEllipseClick = () => inputController.setTool('ellipse');

  btnSelect?.addEventListener('click', onSelectClick);
  btnDirectSelect?.addEventListener('click', onDirectSelectClick);
  btnHand?.addEventListener('click', onHandClick);
  btnPen?.addEventListener('click', onPenClick);
  btnRectangle?.addEventListener('click', onRectangleClick);
  btnEllipse?.addEventListener('click', onEllipseClick);

  // Inicializar estado visual de herramientas
  syncToolButtons(inputController.currentTool);

  // Sincronización del estado de los ítems de menú desplegable
  function syncMenuItems(selectedNodes: readonly Shape[] = stateManager.getSelectedNodes()): void {
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

    const hasSelection = selectedNodes.length > 0;

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

    const canAlign = selectedNodes.length >= 2;
    const canDistribute = selectedNodes.length >= 3;

    if (menuItemAlign) {
      menuItemAlign.disabled = !canAlign;
      menuItemAlign.setAttribute('aria-disabled', String(!canAlign));
    }

    const alignSubmenuItems = [
      menuItemAlignLeft,
      menuItemAlignCenterH,
      menuItemAlignRight,
      menuItemAlignTop,
      menuItemAlignCenterV,
      menuItemAlignBottom,
    ];
    for (let i = 0; i < alignSubmenuItems.length; i++) {
      const it = alignSubmenuItems[i];
      if (it) {
        it.disabled = !canAlign;
        it.setAttribute('aria-disabled', String(!canAlign));
      }
    }

    if (menuItemDistribute) {
      menuItemDistribute.disabled = !canDistribute;
      menuItemDistribute.setAttribute('aria-disabled', String(!canDistribute));
    }

    const distributeSubmenuItems = [menuItemDistributeH, menuItemDistributeV];
    for (let i = 0; i < distributeSubmenuItems.length; i++) {
      const it = distributeSubmenuItems[i];
      if (it) {
        it.disabled = !canDistribute;
        it.setAttribute('aria-disabled', String(!canDistribute));
      }
    }

    const hasClipboard = inputController.clipboard !== null;
    if (menuItemPaste) {
      menuItemPaste.disabled = !hasClipboard;
      menuItemPaste.setAttribute('aria-disabled', String(!hasClipboard));
    }

    // Deshabilitación de zoom en límites [0.1, 32]
    const currentZoom = viewportManager.zoom;
    const isAtMaxZoom = currentZoom >= 32 - 1e-4;
    const isAtMinZoom = currentZoom <= 0.1 + 1e-4;

    if (menuItemZoomIn) {
      menuItemZoomIn.disabled = isAtMaxZoom;
      menuItemZoomIn.setAttribute('aria-disabled', String(isAtMaxZoom));
    }
    if (menuItemZoomOut) {
      menuItemZoomOut.disabled = isAtMinZoom;
      menuItemZoomOut.setAttribute('aria-disabled', String(isAtMinZoom));
    }
  }

  // 2. Sincronización de historial (CommandManager Event Emitter -> DOM)
  const syncHistoryButtons = (selectedNodes: readonly Shape[] = stateManager.getSelectedNodes()) => {
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

    syncMenuItems(selectedNodes);
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
      debug('💾 [Serializer] Documento serializado y descargado como vector-scene.json');
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
          inputController.zoomFit();
          debug('📂 [Serializer] Documento importado y cargado con éxito:', doc);
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
    } else if (typeof file.text === 'function') {
      (async () => {
        try {
          const text = await file.text();
          const doc = await Serializer.parseDocument(text);
          stateManager.loadState(doc);
          commandManager.clear();
          inputController.zoomFit();
          debug('📂 [Serializer] Documento importado y cargado con éxito:', doc);
        } catch (error) {
          console.error('❌ Error al importar documento JSON:', error);
          if (typeof alert !== 'undefined') {
            alert(`Error al importar el archivo JSON: ${error instanceof Error ? error.message : String(error)}`);
          }
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
  interface StyleSnapshot {
    readonly fill?: string;
    readonly stroke?: string;
    readonly strokeWidth?: number;
  }
  let initialStyleSnapshots: Map<string, StyleSnapshot> | null = null;

  const captureInitialStyle = () => {
    const selectedNodes = stateManager.getSelectedNodes();
    if (selectedNodes.length > 0) {
      initialStyleSnapshots = new Map();
      for (const shape of selectedNodes) {
        initialStyleSnapshots.set(shape.id, {
          fill: shape.fill,
          stroke: shape.stroke,
          strokeWidth: shape.strokeWidth,
        });
      }
    }
  };

  const syncPropertiesPanel = (selectedNodes: readonly Shape[] = stateManager.getSelectedNodes()) => {
    if (selectedNodes.length > 0) {
      if (selectionState) {
        selectionState.style.display = 'block';
      }
      if (noSelectionState) {
        noSelectionState.style.display = 'none';
      }

      if (panelTitle) {
        panelTitle.textContent =
          selectedNodes.length === 1 ? 'PROPIEDADES' : `${selectedNodes.length} figuras seleccionadas`;
      }

      const firstShape = selectedNodes[0];
      const isEditing = initialStyleSnapshots !== null;
      if (inputFill && (!isEditing || (typeof document !== 'undefined' && document.activeElement !== inputFill))) {
        inputFill.value = toValidHexColor(firstShape.fill, '#000000');
      }
      if (inputStroke && (!isEditing || (typeof document !== 'undefined' && document.activeElement !== inputStroke))) {
        inputStroke.value = toValidHexColor(firstShape.stroke, '#000000');
      }
      if (inputStrokeWidth && (!isEditing || (typeof document !== 'undefined' && document.activeElement !== inputStrokeWidth))) {
        inputStrokeWidth.value = String(firstShape.strokeWidth ?? 1);
      }

      const canAlign = selectedNodes.length >= 2;
      const canDistribute = selectedNodes.length >= 3;

      if (sectionAlign) {
        sectionAlign.style.display = canAlign ? 'block' : 'none';
      }

      const alignPanelButtons = [
        btnAlignLeft,
        btnAlignCenterH,
        btnAlignRight,
        btnAlignTop,
        btnAlignCenterV,
        btnAlignBottom,
      ];
      for (let i = 0; i < alignPanelButtons.length; i++) {
        const btn = alignPanelButtons[i];
        if (btn) {
          btn.disabled = !canAlign;
          btn.setAttribute('aria-disabled', String(!canAlign));
        }
      }

      const distributePanelButtons = [btnDistributeH, btnDistributeV];
      for (let i = 0; i < distributePanelButtons.length; i++) {
        const btn = distributePanelButtons[i];
        if (btn) {
          btn.disabled = !canDistribute;
          btn.setAttribute('aria-disabled', String(!canDistribute));
        }
      }
    } else {
      if (selectionState) {
        selectionState.style.display = 'none';
      }
      if (noSelectionState) {
        noSelectionState.style.display = 'block';
      }
      if (sectionAlign) {
        sectionAlign.style.display = 'none';
      }
      if (panelTitle) {
        panelTitle.textContent = 'PROPIEDADES';
      }
      initialStyleSnapshots = null;
    }

    syncMenuItems(selectedNodes);
    syncStatusBar(selectedNodes);
  };

  // Suscripción al StateManager para sincronizar selección y estilos
  const unsubscribeState = stateManager.subscribe(() => {
    const selectedNodes = stateManager.getSelectedNodes();
    syncPropertiesPanel(selectedNodes);
  });

  // Inicializar estado del panel de propiedades, menú y barra de estado
  syncPropertiesPanel();

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
    const selectedNodes = stateManager.getSelectedNodes();
    if (selectedNodes.length === 0 || !inputFill) return;
    if (!initialStyleSnapshots) {
      captureInitialStyle();
    }
    const val = inputFill.value;
    for (const shape of selectedNodes) {
      stateManager.updateShape(shape.id, { fill: val });
    }
  };

  const onStrokeInput = () => {
    const selectedNodes = stateManager.getSelectedNodes();
    if (selectedNodes.length === 0 || !inputStroke) return;
    if (!initialStyleSnapshots) {
      captureInitialStyle();
    }
    const val = inputStroke.value;
    for (const shape of selectedNodes) {
      stateManager.updateShape(shape.id, { stroke: val });
    }
  };

  const onStrokeWidthInput = () => {
    const selectedNodes = stateManager.getSelectedNodes();
    if (selectedNodes.length === 0 || !inputStrokeWidth) return;
    if (!initialStyleSnapshots) {
      captureInitialStyle();
    }
    const parsed = parseFloat(inputStrokeWidth.value);
    const strokeWidth = isNaN(parsed) ? 1 : Math.max(0, parsed);
    for (const shape of selectedNodes) {
      stateManager.updateShape(shape.id, { strokeWidth });
    }
  };

  inputFill?.addEventListener('input', onFillInput);
  inputStroke?.addEventListener('input', onStrokeInput);
  inputStrokeWidth?.addEventListener('input', onStrokeWidthInput);

  // Consolidación final (evento 'change'): genera StyleCommand y registra en CommandManager
  const onFillChange = () => {
    const selectedNodes = stateManager.getSelectedNodes();
    if (selectedNodes.length === 0 || !inputFill) return;

    if (!initialStyleSnapshots) {
      captureInitialStyle();
    }

    const finalVal = inputFill.value;
    const commands: StyleCommand[] = [];

    for (const shape of selectedNodes) {
      const initialVal = initialStyleSnapshots?.get(shape.id)?.fill ?? shape.fill;
      stateManager.updateShape(shape.id, { fill: finalVal });

      if (initialVal !== finalVal) {
        commands.push(
          new StyleCommand(
            stateManager,
            shape.id,
            { fill: initialVal },
            { fill: finalVal }
          )
        );
      }
    }

    if (commands.length === 1) {
      commandManager.recordCommand(commands[0]);
    } else if (commands.length > 1) {
      commandManager.recordCommand(new BatchCommand(commands, 'Style Fill'));
    }

    initialStyleSnapshots = null;
  };

  const onStrokeChange = () => {
    const selectedNodes = stateManager.getSelectedNodes();
    if (selectedNodes.length === 0 || !inputStroke) return;

    if (!initialStyleSnapshots) {
      captureInitialStyle();
    }

    const finalVal = inputStroke.value;
    const commands: StyleCommand[] = [];

    for (const shape of selectedNodes) {
      const initialVal = initialStyleSnapshots?.get(shape.id)?.stroke ?? shape.stroke;
      stateManager.updateShape(shape.id, { stroke: finalVal });

      if (initialVal !== finalVal) {
        commands.push(
          new StyleCommand(
            stateManager,
            shape.id,
            { stroke: initialVal },
            { stroke: finalVal }
          )
        );
      }
    }

    if (commands.length === 1) {
      commandManager.recordCommand(commands[0]);
    } else if (commands.length > 1) {
      commandManager.recordCommand(new BatchCommand(commands, 'Style Stroke'));
    }

    initialStyleSnapshots = null;
  };

  const onStrokeWidthChange = () => {
    const selectedNodes = stateManager.getSelectedNodes();
    if (selectedNodes.length === 0 || !inputStrokeWidth) return;

    if (!initialStyleSnapshots) {
      captureInitialStyle();
    }

    const parsed = parseFloat(inputStrokeWidth.value);
    const finalVal = isNaN(parsed) ? 1 : Math.max(0, parsed);
    const commands: StyleCommand[] = [];

    for (const shape of selectedNodes) {
      const initialVal = initialStyleSnapshots?.get(shape.id)?.strokeWidth ?? shape.strokeWidth;
      stateManager.updateShape(shape.id, { strokeWidth: finalVal });

      if (initialVal !== finalVal) {
        commands.push(
          new StyleCommand(
            stateManager,
            shape.id,
            { strokeWidth: initialVal },
            { strokeWidth: finalVal }
          )
        );
      }
    }

    if (commands.length === 1) {
      commandManager.recordCommand(commands[0]);
    } else if (commands.length > 1) {
      commandManager.recordCommand(new BatchCommand(commands, 'Style Stroke Width'));
    }

    initialStyleSnapshots = null;
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
    if (stateManager.getSelection().length > 0) {
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
          (section as HTMLDetailsElement).open = saved === 'true';
        }
      }
    } catch (_) {}

    const onToggle = () => {
      try {
        if (typeof sessionStorage !== 'undefined' && 'open' in section) {
          sessionStorage.setItem(`panel-section-${section.id}`, String((section as HTMLDetailsElement).open));
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
      items: [
        menuItemBringToFront,
        menuItemSendToBack,
        menuItemAlign,
        menuItemDistribute,
      ],
    },
    {
      trigger: menuBtnView,
      dropdown: menuDropdownView,
      items: [
        menuItemZoomIn,
        menuItemZoomOut,
        menuItemZoomFit,
        menuItemZoom100,
      ],
    },
    {
      trigger: menuBtnHelp,
      dropdown: menuDropdownHelp,
      items: [menuItemShortcuts],
    },
  ];

  interface SubmenuEntry {
    trigger: HTMLButtonElement | null;
    dropdown: HTMLElement | null;
    items: (HTMLButtonElement | null)[];
  }

  const submenuEntries: SubmenuEntry[] = [
    {
      trigger: menuItemAlign,
      dropdown: menuDropdownAlign,
      items: [
        menuItemAlignLeft,
        menuItemAlignCenterH,
        menuItemAlignRight,
        menuItemAlignTop,
        menuItemAlignCenterV,
        menuItemAlignBottom,
      ],
    },
    {
      trigger: menuItemDistribute,
      dropdown: menuDropdownDistribute,
      items: [menuItemDistributeH, menuItemDistributeV],
    },
  ];

  const closeAllSubmenus = () => {
    for (let i = 0; i < submenuEntries.length; i++) {
      const sub = submenuEntries[i];
      if (sub.trigger) {
        sub.trigger.setAttribute('aria-expanded', 'false');
        sub.trigger.classList?.remove('is-open');
      }
      if (sub.dropdown) {
        sub.dropdown.hidden = true;
        sub.dropdown.classList?.remove('is-open');
      }
    }
  };

  const openSubmenu = (submenu: SubmenuEntry, focusFirstItem: boolean = false) => {
    if (!submenu.trigger || submenu.trigger.disabled || submenu.trigger.getAttribute('aria-disabled') === 'true') {
      return;
    }
    closeAllSubmenus();
    submenu.trigger.setAttribute('aria-expanded', 'true');
    submenu.trigger.classList?.add('is-open');
    if (submenu.dropdown) {
      submenu.dropdown.hidden = false;
      submenu.dropdown.classList?.add('is-open');
      if (focusFirstItem) {
        const enabled = submenu.items.filter((it): it is HTMLButtonElement =>
          it !== null && !it.disabled && it.getAttribute('aria-disabled') !== 'true'
        );
        if (enabled.length > 0) {
          enabled[0].focus?.();
        }
      }
    }
  };

  let activeMenuIndex = -1;

  const closeAllMenus = () => {
    activeMenuIndex = -1;
    closeAllSubmenus();
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
      const sub = submenuEntries.find((s) => s.trigger === focusedItem);
      if (sub && !sub.trigger?.disabled && sub.trigger?.getAttribute('aria-disabled') !== 'true') {
        e.preventDefault?.();
        openSubmenu(sub, true);
        return;
      }
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
          const sub = submenuEntries.find((s) => s.trigger === focusedItem);
          if (sub) {
            e.preventDefault?.();
            openSubmenu(sub, true);
            return;
          }
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

  const submenuContainerEnterHandlers: Array<{ container: HTMLElement | null; handler: () => void }> = [];
  const submenuContainerLeaveHandlers: Array<{ container: HTMLElement | null; handler: () => void }> = [];
  const submenuTriggerClickHandlers: Array<{ trigger: HTMLButtonElement | null; handler: (e: any) => void }> = [];

  submenuEntries.forEach((sub) => {
    if (sub.trigger) {
      const container = (sub.trigger.closest?.('.menu-submenu-container') || sub.trigger.parentElement) as HTMLElement | null;
      const onEnter = () => {
        if (sub.trigger && !sub.trigger.disabled && sub.trigger.getAttribute('aria-disabled') !== 'true') {
          openSubmenu(sub, false);
        }
      };
      const onLeave = () => {
        if (sub.dropdown && !sub.dropdown.hidden) {
          closeAllSubmenus();
        }
      };
      container?.addEventListener?.('mouseenter', onEnter);
      container?.addEventListener?.('mouseleave', onLeave);
      submenuContainerEnterHandlers.push({ container, handler: onEnter });
      submenuContainerLeaveHandlers.push({ container, handler: onLeave });

      const onTriggerClick = (e: any) => {
        e.stopPropagation?.();
        if (!sub.trigger?.disabled && sub.trigger?.getAttribute('aria-disabled') !== 'true') {
          if (sub.dropdown && !sub.dropdown.hidden) {
            closeAllSubmenus();
          } else {
            openSubmenu(sub, true);
          }
        }
      };
      sub.trigger.addEventListener('click', onTriggerClick);
      submenuTriggerClickHandlers.push({ trigger: sub.trigger, handler: onTriggerClick });
    }
  });

  const submenuKeyDownHandlers = submenuEntries.map((sub) => (e: KeyboardEvent) => {
    const key = e.key;
    const allSubItems = sub.items.filter(Boolean) as HTMLButtonElement[];
    const enabledSubItems = allSubItems.filter((it) => !it.disabled && it.getAttribute('aria-disabled') !== 'true');
    const focusedSubItem = (typeof document !== 'undefined' ? document.activeElement : null) as HTMLButtonElement;
    const currentSubIndex = enabledSubItems.indexOf(focusedSubItem);

    if (key === 'ArrowDown') {
      e.preventDefault?.();
      if (enabledSubItems.length === 0) return;
      const nextIndex = currentSubIndex >= 0 ? (currentSubIndex + 1) % enabledSubItems.length : 0;
      enabledSubItems[nextIndex].focus?.();
    } else if (key === 'ArrowUp') {
      e.preventDefault?.();
      if (enabledSubItems.length === 0) return;
      const prevIndex = currentSubIndex >= 0
        ? (currentSubIndex - 1 + enabledSubItems.length) % enabledSubItems.length
        : enabledSubItems.length - 1;
      enabledSubItems[prevIndex].focus?.();
    } else if (key === 'ArrowLeft' || key === 'Escape') {
      e.preventDefault?.();
      closeAllSubmenus();
      sub.trigger?.focus?.();
    } else if (key === 'Tab') {
      closeAllMenus();
    } else if (key === 'Enter' || key === ' ') {
      if (focusedSubItem && allSubItems.includes(focusedSubItem)) {
        if (!focusedSubItem.disabled && focusedSubItem.getAttribute('aria-disabled') !== 'true') {
          e.preventDefault?.();
          focusedSubItem.click();
        }
      }
    }
  });

  submenuEntries.forEach((sub, i) => {
    sub.dropdown?.addEventListener('keydown', submenuKeyDownHandlers[i]);
  });

  const onDocumentClick = (e: MouseEvent) => {
    const target = e.target as Node | null;
    if (isZoomMenuOpen) {
      const isInsideZoom = (statusZoomBtn && (statusZoomBtn === target || statusZoomBtn.contains?.(target))) ||
                           (zoomDropdown && (zoomDropdown === target || zoomDropdown.contains?.(target)));
      if (!isInsideZoom) {
        closeZoomMenu();
      }
    }

    if (activeMenuIndex === -1) return;
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
        if (entry.dropdown && typeof entry.dropdown.contains === 'function' && entry.dropdown.contains(target)) {
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
    if (e.key === 'Escape' && isZoomMenuOpen) {
      e.preventDefault?.();
      closeZoomMenu();
      statusZoomBtn?.focus?.();
      return;
    }

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
    if (stateManager.getSelection().length > 0) {
      closeAllMenus();
      inputController.copy();
      syncMenuItems();
      canvas?.focus?.();
    }
  };

  const onMenuPasteClick = () => {
    if (inputController.clipboard) {
      closeAllMenus();
      inputController.paste();
      syncMenuItems();
      canvas?.focus?.();
    }
  };

  const onMenuDuplicateClick = () => {
    if (stateManager.getSelection().length > 0) {
      closeAllMenus();
      inputController.duplicate();
      syncMenuItems();
      canvas?.focus?.();
    }
  };

  const onMenuDeleteClick = () => {
    if (stateManager.getSelection().length > 0) {
      closeAllMenus();
      inputController.deleteSelected();
      syncMenuItems();
      canvas?.focus?.();
    }
  };

  const onMenuBringToFrontClick = () => {
    if (stateManager.getSelection().length > 0) {
      closeAllMenus();
      inputController.bringToFront();
      canvas?.focus?.();
    }
  };

  const onMenuSendToBackClick = () => {
    if (stateManager.getSelection().length > 0) {
      closeAllMenus();
      inputController.sendToBack();
      canvas?.focus?.();
    }
  };

  // Acciones de Alineación (Menú y Panel)
  const createAlignHandler = (mode: AlignmentMode) => () => {
    if (stateManager.getSelection().length >= 2) {
      closeAllMenus();
      inputController.alignSelection(mode);
      syncMenuItems();
      canvas?.focus?.();
    }
  };

  const onAlignLeft = createAlignHandler('left');
  const onAlignCenterH = createAlignHandler('center-h');
  const onAlignRight = createAlignHandler('right');
  const onAlignTop = createAlignHandler('top');
  const onAlignCenterV = createAlignHandler('center-v');
  const onAlignBottom = createAlignHandler('bottom');

  // Acciones de Distribución (Menú y Panel)
  const createDistributeHandler = (axis: DistributionAxis) => () => {
    if (stateManager.getSelection().length >= 3) {
      closeAllMenus();
      inputController.distributeSelection(axis);
      syncMenuItems();
      canvas?.focus?.();
    }
  };

  const onDistributeH = createDistributeHandler('horizontal');
  const onDistributeV = createDistributeHandler('vertical');

  menuItemAlignLeft?.addEventListener('click', onAlignLeft);
  menuItemAlignCenterH?.addEventListener('click', onAlignCenterH);
  menuItemAlignRight?.addEventListener('click', onAlignRight);
  menuItemAlignTop?.addEventListener('click', onAlignTop);
  menuItemAlignCenterV?.addEventListener('click', onAlignCenterV);
  menuItemAlignBottom?.addEventListener('click', onAlignBottom);

  menuItemDistributeH?.addEventListener('click', onDistributeH);
  menuItemDistributeV?.addEventListener('click', onDistributeV);

  btnAlignLeft?.addEventListener('click', onAlignLeft);
  btnAlignCenterH?.addEventListener('click', onAlignCenterH);
  btnAlignRight?.addEventListener('click', onAlignRight);
  btnAlignTop?.addEventListener('click', onAlignTop);
  btnAlignCenterV?.addEventListener('click', onAlignCenterV);
  btnAlignBottom?.addEventListener('click', onAlignBottom);

  btnDistributeH?.addEventListener('click', onDistributeH);
  btnDistributeV?.addEventListener('click', onDistributeV);

  const onMenuZoomInClick = () => {
    closeAllMenus();
    inputController.zoomIn();
    canvas?.focus?.();
  };

  const onMenuZoomOutClick = () => {
    closeAllMenus();
    inputController.zoomOut();
    canvas?.focus?.();
  };

  const onMenuZoomFitClick = () => {
    closeAllMenus();
    inputController.zoomFit();
    canvas?.focus?.();
  };

  const onMenuZoom100Click = () => {
    closeAllMenus();
    inputController.zoomReset();
    canvas?.focus?.();
  };

  const populateShortcutsDialog = () => {
    if (!shortcutsDialogList) return;
    const shortcuts = typeof inputController.getShortcuts === 'function'
      ? inputController.getShortcuts()
      : InputController.SHORTCUTS;

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
      if (shortcutsDialog.style) {
        shortcutsDialog.style.display = 'block';
      }
    }
  };

  const closeShortcutsDialog = () => {
    if (!shortcutsDialog) return;
    if (typeof shortcutsDialog.close === 'function') {
      shortcutsDialog.close();
    } else {
      shortcutsDialog.removeAttribute('open');
      if (shortcutsDialog.style) {
        shortcutsDialog.style.display = 'none';
      }
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
  menuItemZoomIn?.addEventListener('click', onMenuZoomInClick);
  menuItemZoomOut?.addEventListener('click', onMenuZoomOutClick);
  menuItemZoomFit?.addEventListener('click', onMenuZoomFitClick);
  menuItemZoom100?.addEventListener('click', onMenuZoom100Click);
  menuItemShortcuts?.addEventListener('click', onMenuShortcutsClick);
  btnCloseShortcuts?.addEventListener('click', closeShortcutsDialog);

  // Inicializar atajos en el diálogo
  populateShortcutsDialog();

  // Control interactivo de Zoom en la Barra de Estado
  const updateZoomIndicator = (zoom: number) => {
    if (statusZoomLabel) {
      statusZoomLabel.textContent = `${Math.round(zoom * 100)} %`;
    }
  };
  updateZoomIndicator(viewportManager.zoom);

  const unsubscribeViewport = viewportManager.subscribe((vp) => {
    updateZoomIndicator(vp.zoom);
    syncMenuItems();
  });

  let isZoomMenuOpen = false;

  const openZoomMenu = () => {
    if (!zoomDropdown || !statusZoomBtn) return;
    isZoomMenuOpen = true;
    zoomDropdown.hidden = false;
    statusZoomBtn.setAttribute('aria-expanded', 'true');
    statusZoomBtn.classList.add('is-open');
  };

  const closeZoomMenu = () => {
    if (!zoomDropdown || !statusZoomBtn) return;
    isZoomMenuOpen = false;
    zoomDropdown.hidden = true;
    statusZoomBtn.setAttribute('aria-expanded', 'false');
    statusZoomBtn.classList.remove('is-open');
  };

  const onZoomBtnClick = (e: MouseEvent) => {
    e.stopPropagation?.();
    if (isZoomMenuOpen) {
      closeZoomMenu();
    } else {
      closeAllMenus();
      openZoomMenu();
    }
  };

  const onZoomBtnKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault?.();
      openZoomMenu();
      const firstItem = typeof zoomDropdown?.querySelector === 'function'
        ? zoomDropdown.querySelector<HTMLButtonElement>('.zoom-dropdown-item')
        : null;
      firstItem?.focus?.();
    } else if (e.key === 'Escape') {
      if (isZoomMenuOpen) {
        e.preventDefault?.();
        closeZoomMenu();
      }
    }
  };

  statusZoomBtn?.addEventListener('click', onZoomBtnClick);
  statusZoomBtn?.addEventListener('keydown', onZoomBtnKeyDown);

  const onPresetClick = (e: MouseEvent) => {
    const target = e.currentTarget as HTMLButtonElement;
    const preset = target.getAttribute('data-preset');
    closeZoomMenu();

    if (preset === 'fit') {
      inputController.zoomFit();
    } else if (preset) {
      const targetZoom = parseFloat(preset);
      if (!isNaN(targetZoom)) {
        const center = inputController.getCanvasCenter();
        const currentZoom = viewportManager.zoom;
        const factor = targetZoom / currentZoom;
        viewportManager.zoomAt(center, factor);
      }
    }
    canvas?.focus?.();
  };

  const presetElements = Array.from(zoomPresetItems);
  presetElements.forEach((item) => {
    item.addEventListener('click', onPresetClick);
  });

  const onZoomDropdownKeyDown = (e: KeyboardEvent) => {
    const key = e.key;
    const items = Array.from(zoomPresetItems).filter((it) => !it.disabled);
    const focused = typeof document !== 'undefined' ? (document.activeElement as HTMLButtonElement) : null;
    const idx = focused ? items.indexOf(focused) : -1;

    if (key === 'ArrowDown') {
      e.preventDefault?.();
      if (items.length === 0) return;
      const next = idx >= 0 ? (idx + 1) % items.length : 0;
      items[next].focus?.();
    } else if (key === 'ArrowUp') {
      e.preventDefault?.();
      if (items.length === 0) return;
      const prev = idx >= 0 ? (idx - 1 + items.length) % items.length : items.length - 1;
      items[prev].focus?.();
    } else if (key === 'Escape') {
      e.preventDefault?.();
      closeZoomMenu();
      statusZoomBtn?.focus?.();
    } else if (key === 'Tab') {
      closeZoomMenu();
    }
  };

  zoomDropdown?.addEventListener('keydown', onZoomDropdownKeyDown);

  // 7. Observabilidad de dimensiones del contenedor del lienzo (ResizeObserver)
  const canvas = document.querySelector<HTMLCanvasElement>('#viewport-canvas');
  const canvasContainer = document.querySelector<HTMLElement>('#canvas-container, .canvas-viewport') ?? canvas;
  let resizeObserver: ResizeObserver | null = null;

  if (typeof ResizeObserver !== 'undefined' && canvasContainer) {
    resizeObserver = new ResizeObserver(() => {
      if (canvas) {
        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        const rect = canvas.getBoundingClientRect();
        const prevCssWidth = canvas.width / dpr;
        const prevCssHeight = canvas.height / dpr;

        const newCssWidth = Math.max(1, Math.floor(rect.width || (typeof window !== 'undefined' ? window.innerWidth : 800)));
        const newCssHeight = Math.max(1, Math.floor(rect.height || (typeof window !== 'undefined' ? window.innerHeight : 600)));
        const width = Math.max(1, Math.floor(newCssWidth * dpr));
        const height = Math.max(1, Math.floor(newCssHeight * dpr));

        if (canvas.width !== width || canvas.height !== height) {
          if (prevCssWidth > 0 && prevCssHeight > 0 && (newCssWidth !== prevCssWidth || newCssHeight !== prevCssHeight)) {
            const oldCenterWorld = viewportManager.screenToWorld({
              x: prevCssWidth / 2,
              y: prevCssHeight / 2,
            });
            const newCenterScreen = {
              x: newCssWidth / 2,
              y: newCssHeight / 2,
            };
            const newPanX = newCenterScreen.x - oldCenterWorld.x * viewportManager.zoom;
            const newPanY = newCenterScreen.y - oldCenterWorld.y * viewportManager.zoom;
            viewportManager.setViewport({
              zoom: viewportManager.zoom,
              panX: newPanX,
              panY: newPanY,
            });
          }

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
      unsubscribeViewport();
      btnSelect?.removeEventListener('click', onSelectClick);
      btnDirectSelect?.removeEventListener('click', onDirectSelectClick);
      btnHand?.removeEventListener('click', onHandClick);
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

      menuItemAlignLeft?.removeEventListener('click', onAlignLeft);
      menuItemAlignCenterH?.removeEventListener('click', onAlignCenterH);
      menuItemAlignRight?.removeEventListener('click', onAlignRight);
      menuItemAlignTop?.removeEventListener('click', onAlignTop);
      menuItemAlignCenterV?.removeEventListener('click', onAlignCenterV);
      menuItemAlignBottom?.removeEventListener('click', onAlignBottom);

      menuItemDistributeH?.removeEventListener('click', onDistributeH);
      menuItemDistributeV?.removeEventListener('click', onDistributeV);

      btnAlignLeft?.removeEventListener('click', onAlignLeft);
      btnAlignCenterH?.removeEventListener('click', onAlignCenterH);
      btnAlignRight?.removeEventListener('click', onAlignRight);
      btnAlignTop?.removeEventListener('click', onAlignTop);
      btnAlignCenterV?.removeEventListener('click', onAlignCenterV);
      btnAlignBottom?.removeEventListener('click', onAlignBottom);

      btnDistributeH?.removeEventListener('click', onDistributeH);
      btnDistributeV?.removeEventListener('click', onDistributeV);

      submenuEntries.forEach((sub, i) => {
        sub.dropdown?.removeEventListener('keydown', submenuKeyDownHandlers[i]);
      });

      submenuContainerEnterHandlers.forEach(({ container, handler }) => {
        container?.removeEventListener?.('mouseenter', handler);
      });
      submenuContainerLeaveHandlers.forEach(({ container, handler }) => {
        container?.removeEventListener?.('mouseleave', handler);
      });
      submenuTriggerClickHandlers.forEach(({ trigger, handler }) => {
        trigger?.removeEventListener?.('click', handler);
      });
      menuItemZoomIn?.removeEventListener('click', onMenuZoomInClick);
      menuItemZoomOut?.removeEventListener('click', onMenuZoomOutClick);
      menuItemZoomFit?.removeEventListener('click', onMenuZoomFitClick);
      menuItemZoom100?.removeEventListener('click', onMenuZoom100Click);
      menuItemShortcuts?.removeEventListener('click', onMenuShortcutsClick);
      btnCloseShortcuts?.removeEventListener('click', closeShortcutsDialog);

      statusZoomBtn?.removeEventListener('click', onZoomBtnClick);
      statusZoomBtn?.removeEventListener('keydown', onZoomBtnKeyDown);
      presetElements.forEach((item) => {
        item.removeEventListener('click', onPresetClick);
      });
      zoomDropdown?.removeEventListener('keydown', onZoomDropdownKeyDown);

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
    // Controlador de Entrada con herramientas de Selección y Pluma
    inputController = new InputController(canvas, stateManager, commandManager, {
      viewportManager,
    });

    // Motor de Renderizado
    renderEngine = new RenderEngine(canvas, stateManager, {
      highDpi: true,
      backgroundColor: '#141416',
      viewportManager,
      previewProvider: () => inputController?.shapePreview ?? null,
    });
    renderEngine.start();

    // Sistema de observabilidad DOM <-> Estado
    uiBindings = setupUIBindings(inputController, commandManager, stateManager);

    debug('🚀 RenderEngine iniciado con soporte para primitivas Path (bezierCurveTo) y Viewport (Zoom/Pan).');
    debug('✒️  Herramienta Pluma:');
    debug('   - Presiona "P" o haz clic en la toolbar para activar la Pluma.');
    debug('   - Clic para crear un punto de ancla.');
    debug('   - Arrastra para definir los puntos de control tangentes.');
    debug('   - Presiona "Escape", "Enter" o clic en el inicio para finalizar el trazado.');
    debug('   - Presiona "V" para volver a la herramienta Selección.');
    debug('🎯 Hit-Testing no rectangular activo: haz clic sobre la curva Bézier para seleccionarla.');
  }
}

// 5. Exponer las instancias en el objeto global para inspección interactiva
const globals = {
  stateManager,
  viewportManager,
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
