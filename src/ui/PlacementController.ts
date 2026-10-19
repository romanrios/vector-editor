import type { StateManager } from '../state/StateManager.ts';
import type { CommandManager } from '../commands/CommandManager.ts';
import type { ViewportManager } from '../utils/viewport.ts';
import { screenToWorld } from '../utils/viewport.ts';
import type { ImageNode, LayerChildNode } from '../types/scene-graph.ts';
import { assetManager } from '../assets/AssetManager.ts';
import { parseSvgString } from '../utils/svgImport.ts';
import { AddShapeCommand } from '../commands/AddShapeCommand.ts';
import { BatchCommand } from '../commands/BatchCommand.ts';

export interface PlacementControllerOptions {
  readonly stateManager: StateManager;
  readonly commandManager: CommandManager;
  readonly viewportManager: ViewportManager;
  readonly canvas?: HTMLCanvasElement | null;
  readonly onPlacementComplete?: () => void;
}

export interface PlacementController {
  readonly placeFiles: (files: FileList | File[], screenPos?: { x: number; y: number }) => Promise<void>;
  readonly openFilePicker: () => void;
  readonly cleanup: () => void;
}

/**
 * Controlador para la colocación e importación de archivos externos (imágenes ráster y vectores SVG)
 * mediante selector de archivos ("Colocar...", Ctrl+Shift+P), Arrastrar y Soltar (Drag & Drop) y Pegar (Ctrl+V).
 */
export function setupPlacementController(options: PlacementControllerOptions): PlacementController {
  const { stateManager, commandManager, viewportManager } = options;
  const canvas = options.canvas ?? (typeof document !== 'undefined' ? document.querySelector<HTMLCanvasElement>('#viewport-canvas') : null);
  const container = (canvas?.parentElement as HTMLElement) ?? (typeof document !== 'undefined' ? document.querySelector<HTMLElement>('#canvas-container') : null);

  // Input file oculto para el flujo de selección
  let fileInput = typeof document !== 'undefined' ? document.querySelector<HTMLInputElement>('#file-input-place') : null;
  let createdFileInput = false;

  if (!fileInput && typeof document !== 'undefined' && typeof document.createElement === 'function') {
    fileInput = document.createElement('input');
    fileInput.id = 'file-input-place';
    fileInput.type = 'file';
    fileInput.accept = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg';
    fileInput.multiple = true;
    fileInput.style.display = 'none';
    fileInput.setAttribute('aria-hidden', 'true');
    if (document.body && typeof document.body.appendChild === 'function') {
      document.body.appendChild(fileInput);
    }
    createdFileInput = true;
  }

  /**
   * Obtiene la posición en el mundo para colocar el elemento:
   * si se proporcionan coordenadas de pantalla (ej. drop del ratón), se proyectan con screenToWorld;
   * de lo contrario, se calcula el centro del viewport visible.
   */
  const resolveWorldTarget = (screenPos?: { x: number; y: number }): { x: number; y: number } => {
    const vp = viewportManager.getViewport();
    if (screenPos && canvas) {
      const rect = canvas.getBoundingClientRect();
      const localX = screenPos.x - rect.left;
      const localY = screenPos.y - rect.top;
      return screenToWorld(vp, { x: localX, y: localY });
    }

    if (canvas) {
      const centerX = canvas.clientWidth / 2;
      const centerY = canvas.clientHeight / 2;
      return screenToWorld(vp, { x: centerX, y: centerY });
    }

    const doc = stateManager.getState();
    return { x: doc.width / 2, y: doc.height / 2 };
  };

  /**
   * Procesa la colocación de un archivo individual
   */
  const processFile = async (
    file: File,
    targetWorld: { x: number; y: number }
  ): Promise<LayerChildNode[]> => {
    const isSvg = file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');

    if (isSvg) {
      try {
        const svgText = await file.text();
        const importResult = parseSvgString(svgText);

        if (importResult.success && importResult.shapes.length > 0) {
          // Centrar las figuras importadas sobre el punto targetWorld
          const offX = targetWorld.x - importResult.width / 2;
          const offY = targetWorld.y - importResult.height / 2;

          const offsetNode = (node: LayerChildNode): LayerChildNode => {
            if (node.type === 'group') {
              return {
                ...node,
                children: node.children.map(offsetNode),
              };
            }
            return {
              ...node,
              x: node.x + offX,
              y: node.y + offY,
            };
          };

          return importResult.shapes.map(offsetNode);
        }
      } catch {
        // Fallback a ImageNode si el parsing SVG nativo no prospera
      }
    }

    // Procesamiento como imagen ráster (o SVG fallback)
    const { asset, width, height } = await assetManager.createAssetFromFile(file);
    stateManager.registerAsset(asset);

    // Escalar inicialmente a un tamaño estándar armónico en el lienzo (máx 600px manteniendo proporción)
    const maxPlacementDim = 600;
    let placeW = width;
    let placeH = height;

    if (width > maxPlacementDim || height > maxPlacementDim) {
      const ratio = Math.min(maxPlacementDim / width, maxPlacementDim / height);
      placeW = Math.max(10, Math.round(width * ratio));
      placeH = Math.max(10, Math.round(height * ratio));
    }

    const baseName = file.name ? file.name.replace(/\.[^/.]+$/, '') : 'Imagen';
    const id = `image-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const imageNode: ImageNode = {
      id,
      type: 'image',
      name: baseName,
      assetId: asset.id,
      x: targetWorld.x - placeW / 2,
      y: targetWorld.y - placeH / 2,
      width: placeW,
      height: placeH,
      naturalWidth: width,
      naturalHeight: height,
    };

    // Pre-cargar inmediatamente en el AssetManager para disponibilidad visual instantánea
    void assetManager.preloadAsset(asset, () => {
      stateManager.markDirty();
    });

    return [imageNode];
  };

  /**
   * Coloca una lista de archivos en el editor
   */
  const placeFiles = async (
    files: FileList | File[],
    screenPos?: { x: number; y: number }
  ): Promise<void> => {
    if (!files || files.length === 0) return;

    const baseTarget = resolveWorldTarget(screenPos);
    const activeLayer = stateManager.getActiveLayer() ?? stateManager.getState().children[0];
    if (!activeLayer) return;

    const allAddedNodes: LayerChildNode[] = [];
    const commands: AddShapeCommand[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      // Desplazamiento en cascada si se colocan múltiples archivos
      const itemTarget = {
        x: baseTarget.x + i * 30,
        y: baseTarget.y + i * 30,
      };

      try {
        const nodes = await processFile(file, itemTarget);
        for (const node of nodes) {
          allAddedNodes.push(node);
          commands.push(new AddShapeCommand(stateManager, node, activeLayer.id));
        }
      } catch (err) {
        console.error(`[PlacementController] Error al colocar archivo ${file.name}:`, err);
      }
    }

    if (commands.length === 0) return;

    if (commands.length === 1) {
      commandManager.executeCommand(commands[0]);
    } else {
      const batch = new BatchCommand(commands, 'Colocar archivos');
      commandManager.executeCommand(batch);
    }

    // Seleccionar los elementos recién colocados
    const newIds = allAddedNodes.map((n) => n.id);
    stateManager.setSelection(newIds);
    stateManager.markDirty();

    if (options.onPlacementComplete) {
      options.onPlacementComplete();
    }
  };

  const openFilePicker = () => {
    if (fileInput) {
      fileInput.click();
    }
  };

  // 1. Manejador de evento change en fileInput
  const onFileInputChange = (e: Event) => {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      void placeFiles(input.files);
    }
    input.value = '';
  };

  // 2. Drag & Drop sobre el canvas y contenedor
  const onDragOver = (e: DragEvent) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (canvas) {
        canvas.classList.add('canvas-dragover');
      }
      if (container) {
        container.classList.add('canvas-dragover');
      }
    }
  };

  const onDragLeave = (e: DragEvent) => {
    const target = e.relatedTarget as Node | null;
    const isOutside =
      (!canvas || !canvas.contains(target)) &&
      (!container || !container.contains(target));
    if (isOutside) {
      if (canvas) canvas.classList.remove('canvas-dragover');
      if (container) container.classList.remove('canvas-dragover');
    }
  };

  const onDrop = (e: DragEvent) => {
    if (canvas) canvas.classList.remove('canvas-dragover');
    if (container) container.classList.remove('canvas-dragover');

    if (e.defaultPrevented) return;
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      e.preventDefault();
      void placeFiles(e.dataTransfer.files, { x: e.clientX, y: e.clientY });
    }
  };

  const onWindowDragOver = (e: DragEvent) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
      e.preventDefault();
    }
  };

  const onWindowDrop = (e: DragEvent) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
      e.preventDefault();
    }
  };

  // 3. Pegar imágenes desde el portapapeles (Ctrl+V)
  const onPaste = (e: ClipboardEvent) => {
    // Si el foco está en un input o textarea editable, permitir el comportamiento estándar
    const activeEl = document.activeElement;
    if (
      activeEl &&
      (activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.getAttribute('contenteditable') === 'true')
    ) {
      return;
    }

    if (!e.clipboardData || !e.clipboardData.items) return;

    const imageFiles: File[] = [];
    for (let i = 0; i < e.clipboardData.items.length; i++) {
      const item = e.clipboardData.items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault();
      void placeFiles(imageFiles);
    }
  };

  // 4. Atajo de teclado Ctrl+Shift+P para "Colocar archivo..."
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      openFilePicker();
    }
  };

  if (fileInput && typeof fileInput.addEventListener === 'function') {
    fileInput.addEventListener('change', onFileInputChange);
  }

  if (canvas && typeof canvas.addEventListener === 'function') {
    canvas.addEventListener('dragover', onDragOver);
    canvas.addEventListener('dragleave', onDragLeave);
    canvas.addEventListener('drop', onDrop);
  }

  if (container && container !== canvas && typeof container.addEventListener === 'function') {
    container.addEventListener('dragover', onDragOver);
    container.addEventListener('dragleave', onDragLeave);
    container.addEventListener('drop', onDrop);
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('dragover', onWindowDragOver);
    window.addEventListener('drop', onWindowDrop);
    window.addEventListener('paste', onPaste);
    window.addEventListener('keydown', onKeyDown);
  }

  return {
    placeFiles,
    openFilePicker,
    cleanup: () => {
      if (fileInput && typeof fileInput.removeEventListener === 'function') {
        fileInput.removeEventListener('change', onFileInputChange);
        if (createdFileInput && fileInput.parentNode) {
          fileInput.parentNode.removeChild(fileInput);
        }
      }
      if (canvas && typeof canvas.removeEventListener === 'function') {
        canvas.removeEventListener('dragover', onDragOver);
        canvas.removeEventListener('dragleave', onDragLeave);
        canvas.removeEventListener('drop', onDrop);
      }
      if (container && container !== canvas && typeof container.removeEventListener === 'function') {
        container.removeEventListener('dragover', onDragOver);
        container.removeEventListener('dragleave', onDragLeave);
        container.removeEventListener('drop', onDrop);
      }
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('dragover', onWindowDragOver);
        window.removeEventListener('drop', onWindowDrop);
        window.removeEventListener('paste', onPaste);
        window.removeEventListener('keydown', onKeyDown);
      }
    },
  };
}
