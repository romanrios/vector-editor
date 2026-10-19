import { StateManager } from './state/StateManager.ts';
import { DEFAULT_DOCUMENT, DEFAULT_DOCUMENT_ZOOM } from './state/defaultDocument.ts';
import { injectSampleShapes } from './state/injectSampleShapes.ts';
import { RenderEngine } from './render/RenderEngine.ts';
import { InputController, type ToolMode } from './input/InputController.ts';
import { CommandManager } from './commands/CommandManager.ts';
import { TranslateCommand } from './commands/TranslateCommand.ts';
import { StyleCommand } from './commands/StyleCommand.ts';
import { UpdateTextTypographyCommand } from './commands/UpdateTextTypographyCommand.ts';
import { ReorderCommand } from './commands/ReorderCommand.ts';
import { ResizeArtboardCommand } from './commands/ResizeArtboardCommand.ts';
import { SetVisibilityCommand } from './commands/SetVisibilityCommand.ts';
import { SetLockedCommand } from './commands/SetLockedCommand.ts';
import { MoveStepCommand } from './commands/MoveStepCommand.ts';
import { AddLayerCommand } from './commands/AddLayerCommand.ts';
import { DeleteLayerCommand } from './commands/DeleteLayerCommand.ts';
import { RenameNodeCommand } from './commands/RenameNodeCommand.ts';
import { MoveNodeCommand } from './commands/MoveNodeCommand.ts';
import { Serializer } from './state/Serializer.ts';
import { ViewportManager } from './utils/viewport.ts';

// Reexportar utilidades de UI para mantener compatibilidad con suites de pruebas
export {
  dashArrayToSelectValue,
  selectValueToDashArray,
  toValidHexColor,
} from './ui/uiUtils.ts';

// Controladores modulares de la interfaz de usuario
import { setupToolbarBindings, type ToolbarController } from './ui/ToolbarController.ts';
import { setupStatusBarBindings, type StatusBarController } from './ui/StatusBarController.ts';
import { setupCanvasResizeObserver, type CanvasResizeController } from './ui/CanvasResizeController.ts';
import { setupDialogsBindings, type DialogsController } from './ui/DialogsController.ts';
import { setupPropertiesPanelBindings, type PropertiesPanelController } from './ui/PropertiesPanelController.ts';
import { setupLayersPanelBindings, type LayersPanelController } from './ui/LayersPanelController.ts';
import { setupContextMenuBindings, type ContextMenuController } from './ui/ContextMenuController.ts';
import { setupMenuBarBindings, type MenuBarController } from './ui/MenuBarController.ts';
import { setupPlacementController, type PlacementController } from './ui/PlacementController.ts';
import { toValidHexColor } from './ui/uiUtils.ts';

function debug(...args: unknown[]): void {
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
    console.log(...args);
  }
}

debug('%c[Vectedit - Scene Graph, RenderEngine, Pluma & Observabilidad DOM]', 'color: #38bdf8; font-weight: bold; font-size: 15px;');

// 1. Inicializar el StateManager inmutable, el CommandManager y el ViewportManager
const commandManager = new CommandManager();
const stateManager = new StateManager(DEFAULT_DOCUMENT, commandManager);
const viewportManager = new ViewportManager({ zoom: DEFAULT_DOCUMENT_ZOOM, panX: 0, panY: 0 });
const moduleStateManager = stateManager;

debug('✅ Documento predeterminado cargado con zoom inicial al 50%.');

// 2. Orquestador de Enlaces del DOM (setupUIBindings)
export function setupUIBindings(
  inputController: InputController,
  commandManager: CommandManager,
  stateManagerInstance?: StateManager
): { cleanup: () => void } {
  if (typeof document === 'undefined') {
    return { cleanup: () => {} };
  }

  const stateManager = stateManagerInstance ?? inputController.stateManager ?? moduleStateManager;
  const viewportManager = inputController.viewportManager ?? new ViewportManager();
  const canvas = document.querySelector<HTMLCanvasElement>('#viewport-canvas');

  let toolbarController: ToolbarController;
  let statusBarController: StatusBarController;
  let canvasResizeController: CanvasResizeController;
  let dialogsController: DialogsController;
  let propertiesPanelController: PropertiesPanelController;
  let layersPanelController: LayersPanelController;
  let contextMenuController: ContextMenuController;
  let menuBarController: MenuBarController;
  let placementController: PlacementController;

  toolbarController = setupToolbarBindings({
    inputController,
    commandManager,
  });

  statusBarController = setupStatusBarBindings({
    stateManager,
    viewportManager,
    inputController,
    canvas,
    onBeforeOpenZoomMenu: () => {
      menuBarController?.closeAllMenus();
      contextMenuController?.closeContextMenu();
    },
  });

  dialogsController = setupDialogsBindings({
    stateManager,
    commandManager,
    inputController,
  });

  propertiesPanelController = setupPropertiesPanelBindings({
    stateManager,
    commandManager,
    inputController,
    canvas,
    onSelectionChanged: () => {
      const sel = stateManager.getSelectedNodes();
      menuBarController?.syncMenuItems(sel);
      contextMenuController?.syncContextMenu(sel);
      statusBarController?.syncStatusBar(sel);
      layersPanelController?.renderLayersTree();
    },
    onAlign: () => {
      const sel = stateManager.getSelectedNodes();
      menuBarController?.syncMenuItems(sel);
      contextMenuController?.syncContextMenu(sel);
    },
    onDistribute: () => {
      const sel = stateManager.getSelectedNodes();
      menuBarController?.syncMenuItems(sel);
      contextMenuController?.syncContextMenu(sel);
    },
    onPathfinder: () => {
      const sel = stateManager.getSelectedNodes();
      menuBarController?.syncMenuItems(sel);
      contextMenuController?.syncContextMenu(sel);
    },
  });

  layersPanelController = setupLayersPanelBindings({
    stateManager,
    commandManager,
    inputController,
  });

  contextMenuController = setupContextMenuBindings(inputController, commandManager, stateManager, {
    canvas,
    onOpen: () => {
      menuBarController?.closeAllMenus();
    },
    onAction: () => {
      const sel = stateManager.getSelectedNodes();
      propertiesPanelController?.syncPropertiesPanel(sel);
      statusBarController?.syncStatusBar(sel);
      layersPanelController?.renderLayersTree();
      menuBarController?.syncMenuItems(sel);
    },
    onSyncPropertiesPanel: () => {
      propertiesPanelController?.syncPropertiesPanel();
    },
  });

  menuBarController = setupMenuBarBindings(inputController, commandManager, stateManager, {
    viewportManager,
    canvas,
    onCloseContextMenu: () => {
      contextMenuController?.closeContextMenu();
    },
    onImportClick: () => {
      const fileImportInput = document.querySelector<HTMLInputElement>('#file-import-input');
      fileImportInput?.click();
    },
    onPlaceClick: () => {
      placementController?.openFilePicker();
    },
    onExportClick: () => {
      dialogsController?.openExportDialog();
    },
    onExportSvg: () => {
      dialogsController?.exportSvg();
    },
    onExportPng: () => {
      void dialogsController?.exportPng();
    },
    onExportWebp: () => {
      void dialogsController?.exportWebp();
    },
    openExportDialog: (restoreFocus) => {
      dialogsController?.openExportDialog(restoreFocus);
    },
    openShortcutsDialog: () => {
      dialogsController?.openShortcutsDialog();
    },
    openAboutDialog: (restoreFocus) => {
      dialogsController?.openAboutDialog(restoreFocus as HTMLButtonElement | null);
    },
    onSyncPropertiesPanel: () => {
      propertiesPanelController?.syncPropertiesPanel();
    },
    onAction: () => {
      const sel = stateManager.getSelectedNodes();
      contextMenuController?.syncContextMenu(sel);
      propertiesPanelController?.syncPropertiesPanel(sel);
      statusBarController?.syncStatusBar(sel);
      layersPanelController?.renderLayersTree();
    },
  });

  canvasResizeController = setupCanvasResizeObserver({
    stateManager,
    viewportManager,
    canvas,
  });

  placementController = setupPlacementController({
    stateManager,
    commandManager,
    viewportManager,
    canvas,
    onPlacementComplete: () => {
      const sel = stateManager.getSelectedNodes();
      propertiesPanelController?.syncPropertiesPanel(sel);
      statusBarController?.syncStatusBar(sel);
      layersPanelController?.renderLayersTree();
      menuBarController?.syncMenuItems(sel);
    },
  });

  // Suscripciones reactivas del estado y de la entrada
  const unsubscribeState = stateManager.subscribe(() => {
    const sel = stateManager.getSelectedNodes();
    propertiesPanelController.syncPropertiesPanel(sel);
    layersPanelController.renderLayersTree();
    layersPanelController.syncLayersToolbar();
    statusBarController.syncStatusBar(sel);
    menuBarController.syncMenuItems(sel);
    contextMenuController.syncContextMenu(sel);
  });

  const unsubscribeHistory = commandManager.on('change', () => {
    toolbarController.syncHistoryButtons();
    menuBarController.syncMenuItems();
    contextMenuController.syncContextMenu();
  });

  const unsubscribeToolChange = inputController.on('toolChange', (tool: ToolMode) => {
    toolbarController.syncToolButtons(tool);
    statusBarController.syncToolLabel(tool);
  });

  const unsubscribeViewport = viewportManager.subscribe((vp) => {
    statusBarController.updateZoomIndicator(vp.zoom);
    menuBarController.syncMenuItems();
  });

  // Sincronización inicial
  const initialSel = stateManager.getSelectedNodes();
  propertiesPanelController.syncPropertiesPanel(initialSel);
  layersPanelController.renderLayersTree();
  layersPanelController.syncLayersToolbar();
  toolbarController.syncHistoryButtons();
  toolbarController.syncToolButtons(inputController.currentTool);
  menuBarController.syncMenuItems(initialSel);
  contextMenuController.syncContextMenu(initialSel);
  statusBarController.syncStatusBar(initialSel);

  return {
    cleanup: () => {
      unsubscribeState();
      unsubscribeHistory();
      unsubscribeToolChange();
      unsubscribeViewport();
      toolbarController.cleanup();
      statusBarController.cleanup();
      canvasResizeController.cleanup();
      dialogsController.cleanup();
      propertiesPanelController.cleanup();
      layersPanelController.cleanup();
      contextMenuController.cleanup();
      menuBarController.cleanup();
      placementController.cleanup();
    },
  };
}

// 3. Vincular el RenderEngine e InputController al elemento <canvas> de pantalla completa
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
      pathEditProvider: () => inputController?.pathEditState ?? null,
      textEditProvider: () => inputController?.textEditState ?? null,
      activeGuidesProvider: () => inputController?.activeGuides ?? [],
    });
    renderEngine.start();

    // Sincronizar el renderizado del Canvas con la carga asíncrona de fuentes web
    if (typeof document !== 'undefined' && 'fonts' in document && document.fonts) {
      if (typeof document.fonts.load === 'function') {
        document.fonts.load('800 287px Montserrat').catch(() => {});
        document.fonts.load('400 43px Inter').catch(() => {});
        document.fonts.load('400 58px Inter').catch(() => {});
      }

      if (document.fonts.ready && typeof document.fonts.ready.then === 'function') {
        document.fonts.ready.then(() => {
          stateManager.markDirty();
        }).catch(() => {});
      }

      if (typeof document.fonts.addEventListener === 'function') {
        document.fonts.addEventListener('loadingdone', () => {
          stateManager.markDirty();
        });
      }
    }

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

// 4. Exponer las instancias en el objeto global para inspección interactiva
const globals = {
  stateManager,
  viewportManager,
  renderEngine,
  inputController,
  commandManager,
  uiBindings,
  TranslateCommand,
  StyleCommand,
  UpdateTextTypographyCommand,
  ReorderCommand,
  ResizeArtboardCommand,
  SetVisibilityCommand,
  SetLockedCommand,
  MoveStepCommand,
  MoveNodeCommand,
  AddLayerCommand,
  DeleteLayerCommand,
  RenameNodeCommand,
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
