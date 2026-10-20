import type { StateManager, ShapePositionEntry } from '../../state/StateManager.ts';
import { getLeafShapes } from '../../state/StateManager.ts';
import type { CommandManager } from '../../commands/CommandManager.ts';
import type { SnapGuide } from '../../types/engine.ts';
import {
  isGroup,
  isSelectable,
  isShape,
  isGradient,
  type AABB,
  type LayerChildNode,
  type Path,
  type PathPoint,
  type Rectangle,
  type Polygon,
  type Star,
  type SelectableNode,
  type Shape,
  type Vector2D,
  type Gradient,
} from '../../types/scene-graph.ts';
import {
  computeBoxScale,
  computeRotationDelta,
  calculateAnchoredSnapping,
  calculateSnapping,
  getPathBaseAABB,
  getSelectionBounds,
  getSelectionBoxHandles,
  getSelectionHandles,
  getShapeAABB,
  getShapesIntersectingRect,
  getTextBaseAABB,
  isPointInAABB,
  type HandleType,
} from '../../utils/geometry.ts';
import {
  rotateShapesAboutPivot,
  scaleShapesAboutAnchor,
  getShapeDimensions,
} from '../../utils/transform.ts';
import {
  TransformShapesCommand,
  type ShapeTransformEntry,
} from '../../commands/TransformShapesCommand.ts';
import { TranslateCommand } from '../../commands/TranslateCommand.ts';
import { BatchCommand } from '../../commands/BatchCommand.ts';
import { ResizeCommand, type ShapeDimensions } from '../../commands/ResizeCommand.ts';
import { RotateCommand } from '../../commands/RotateCommand.ts';
import { AddShapeCommand } from '../../commands/AddShapeCommand.ts';
import { StyleCommand } from '../../commands/StyleCommand.ts';
import {
  hitTestGradientHandles,
  worldToGradientCoord,
  gradientToWorldPoint,
  projectPointOnSegment,
} from '../../utils/gradient.ts';
import {
  getShapeCornerRadiusHandles,
  hitTestCornerRadiusHandle,
  calculateRadiusFromHandleDrag,
  type CornerRadiusHandle,
} from '../../utils/cornerSmoothing.ts';
import type { ViewportManager } from '../../utils/viewport.ts';
import type { SelectionOperations, PreparedClone } from '../SelectionOperations.ts';
import type { ToolHandler } from './ToolHandler.ts';
import type { ShapePreview, ToolMode } from '../InputController.ts';

export interface MultiTransformState {
  type: 'scale' | 'rotate';
  leafShapes: readonly Shape[];
  initialBounds: AABB;
  anchorOrPivot: Vector2D;
  startMouse: Vector2D;
  lastMouse: Vector2D;
  handle?: HandleType;
}

export interface SelectToolHandlerOptions {
  deselectOnEmptyClick?: boolean;
}

export class SelectToolHandler implements ToolHandler {
  private readonly stateManager: StateManager;
  private readonly commandManager: CommandManager;
  private readonly selectionOperations: SelectionOperations;
  private readonly canvas: HTMLCanvasElement;
  private readonly getViewportManager: () => ViewportManager;
  private readonly hitTest: (x: number, y: number) => Shape | null;
  private readonly resolveNodeToSelect: (hitShape: Shape) => SelectableNode;
  private readonly isSmartGuidesEnabled: () => boolean;
  private readonly setActiveGuides: (guides: SnapGuide[]) => void;
  private readonly getScreenCoordinates: (event: MouseEvent) => { x: number; y: number };
  private readonly options: SelectToolHandlerOptions;

  // Estado del arrastre
  private _isDragging: boolean = false;
  private dragOrigin: { x: number; y: number } | null = null;
  private initialShapesPositions: Map<string, { x: number; y: number }> | null = null;
  private initialShapesBounds: Map<string, AABB> | null = null;
  private originalLeafBounds: Map<string, AABB> | null = null;
  private pendingSingleSelectionId: string | null = null;
  private dragStartScreen: { x: number; y: number } | null = null;
  private hasMovedPastThreshold: boolean = false;
  private _isCopyDragging: boolean = false;
  private originalSelectionIds: readonly string[] = [];
  private originalLeafPositions: Map<string, { x: number; y: number }> | null = null;
  private activeClonePlacements: PreparedClone[] | null = null;

  // Estado del rectángulo de selección marquesina
  private _isMarqueeSelecting: boolean = false;
  private _marqueeStartWorld: { x: number; y: number } | null = null;
  private _marqueeStartScreen: { x: number; y: number } | null = null;
  private _marqueeShiftKey: boolean = false;
  private _marqueeInitialSelection: readonly string[] = [];
  private _hasMarqueeDragged: boolean = false;
  private _shapePreview: ShapePreview | null = null;

  // Estado del redimensionado por manejadores
  private _isResizing: boolean = false;
  private resizeOrigin: { x: number; y: number } | null = null;
  private _lastResizeMousePos: { x: number; y: number } | null = null;
  private _lastShiftKey: boolean = false;
  private _lastAltKey: boolean = false;
  private activeResizeHandle: HandleType | null = null;
  private resizingShapeId: string | null = null;
  private initialDimensions: ShapeDimensions | null = null;

  // Estado de rotación
  private _isRotating: boolean = false;
  private rotatingShapeId: string | null = null;
  private initialRotation: number | null = null;
  private rotationAngleOffset: number = 0;
  private rotationCentroid: { x: number; y: number } | null = null;

  // Estado de transformación combinada
  private _multiTransformState: MultiTransformState | null = null;

  // Estado de manipulación interactiva de degradados
  private _activeGradientDrag: {
    readonly shapeId: string;
    readonly property: 'fill' | 'stroke';
    readonly initialGradient: Gradient;
    currentGradient: Gradient;
    readonly handleType: 'gradient-start' | 'gradient-end' | 'gradient-center' | 'gradient-radius' | 'gradient-stop';
    readonly stopId?: string;
    readonly startMouse: Vector2D;
  } | null = null;

  // Estado de manipulación interactiva de radios de esquina
  private _activeCornerRadiusDrag: {
    readonly handle: CornerRadiusHandle;
    readonly shapeId: string;
    readonly initialRadius: number;
    readonly startMouse: Vector2D;
  } | null = null;

  private _hoveredShapeId: string | null = null;

  constructor(
    stateManager: StateManager,
    commandManager: CommandManager,
    selectionOperations: SelectionOperations,
    canvas: HTMLCanvasElement,
    getViewportManager: () => ViewportManager,
    hitTest: (x: number, y: number) => Shape | null,
    resolveNodeToSelect: (hitShape: Shape) => SelectableNode,
    isSmartGuidesEnabled: () => boolean,
    setActiveGuides: (guides: SnapGuide[]) => void,
    getScreenCoordinates: (event: MouseEvent) => { x: number; y: number },
    options: SelectToolHandlerOptions = {}
  ) {
    this.stateManager = stateManager;
    this.commandManager = commandManager;
    this.selectionOperations = selectionOperations;
    this.canvas = canvas;
    this.getViewportManager = getViewportManager;
    this.hitTest = hitTest;
    this.resolveNodeToSelect = resolveNodeToSelect;
    this.isSmartGuidesEnabled = isSmartGuidesEnabled;
    this.setActiveGuides = setActiveGuides;
    this.getScreenCoordinates = getScreenCoordinates;
    this.options = options;
  }

  public get lastResizeMousePos(): { x: number; y: number } | null {
    return this._lastResizeMousePos ? { ...this._lastResizeMousePos } : null;
  }

  public get isDragging(): boolean {
    return this._isDragging;
  }

  public get isCopyDragging(): boolean {
    return this._isCopyDragging;
  }

  public get isMarqueeSelecting(): boolean {
    return this._isMarqueeSelecting;
  }

  public get isResizing(): boolean {
    return this._isResizing;
  }

  public get isRotating(): boolean {
    return this._isRotating;
  }

  public get isMultiTransforming(): boolean {
    return this._multiTransformState !== null;
  }

  public get multiTransformState(): MultiTransformState | null {
    return this._multiTransformState ? { ...this._multiTransformState } : null;
  }

  public get rotatingNodeId(): string | null {
    return this.rotatingShapeId;
  }

  public get initialRotateAngle(): number | null {
    return this.initialRotation;
  }

  public get resizeOriginPoint(): { x: number; y: number } | null {
    return this.resizeOrigin ? { ...this.resizeOrigin } : null;
  }

  public get currentResizeHandle(): HandleType | null {
    return this.activeResizeHandle;
  }

  public get resizingNodeId(): string | null {
    return this.resizingShapeId;
  }

  public get initialResizeDimensions(): ShapeDimensions | null {
    return this.initialDimensions ? { ...this.initialDimensions } : null;
  }

  public get hoveredShapeId(): string | null {
    return this._hoveredShapeId;
  }

  public get shapePreview(): ShapePreview | null {
    return this._shapePreview;
  }

  public onActivate(): void {
    this.canvas.style.cursor = 'default';
  }

  public onDeactivate(_nextTool?: ToolMode): void {
    if (this._isMarqueeSelecting) {
      this.cancelMarquee();
    }
    if (this._isRotating) {
      if (this.rotatingShapeId && this.initialRotation !== null) {
        const rawNode = this.stateManager.findNode(this.rotatingShapeId);
        const selectedShape = rawNode && isShape(rawNode) ? rawNode : null;
        if (selectedShape) {
          const finalRotation = selectedShape.rotation ?? this.initialRotation;
          if (finalRotation !== this.initialRotation) {
            const command = new RotateCommand(
              this.stateManager,
              this.rotatingShapeId,
              this.initialRotation,
              finalRotation
            );
            this.commandManager.recordCommand(command);
          }
        }
      }
      this.resetRotate();
    }
    if (this._isResizing) {
      this.resetResize();
    }
    this._activeCornerRadiusDrag = null;
    this.resetDrag();
  }

  public onMouseDown(event: MouseEvent, coords: Vector2D): void {
    if (event.button !== 0 && event.button !== undefined) {
      return;
    }

    const { x, y } = coords;

    // 1. Manejadores de redimensionado y rotación:
    const selectedNodes = this.stateManager
      .getSelectedNodes()
      .filter((n) => !this.stateManager.isEffectivelyLocked(n.id));
    const isMultiOrGroup = selectedNodes.length >= 2 || (selectedNodes.length === 1 && isGroup(selectedNodes[0]));

    if (isMultiOrGroup) {
      const bounds = getSelectionBounds(selectedNodes);
      if (bounds) {
        const zoom = this.getViewportManager().zoom;
        const handles = getSelectionBoxHandles(bounds, 8 / zoom, 30 / zoom);
        const hitHandle = handles.find((handle) => isPointInAABB(x, y, handle));

        if (hitHandle) {
          const leafShapes = getLeafShapes(selectedNodes);
          if (hitHandle.type === 'rotation-handle') {
            const pivot: Vector2D = {
              x: (bounds.minX + bounds.maxX) / 2,
              y: (bounds.minY + bounds.maxY) / 2,
            };
            this._multiTransformState = {
              type: 'rotate',
              leafShapes,
              initialBounds: bounds,
              anchorOrPivot: pivot,
              startMouse: { x, y },
              lastMouse: { x, y },
            };
            this.canvas.style.cursor = 'crosshair';
            return;
          } else {
            const { anchor } = computeBoxScale(bounds, hitHandle.type, 0, 0, false);
            this._multiTransformState = {
              type: 'scale',
              leafShapes,
              initialBounds: bounds,
              anchorOrPivot: anchor,
              startMouse: { x, y },
              lastMouse: { x, y },
              handle: hitHandle.type,
            };
            this.canvas.style.cursor = this.getResizeCursor(hitHandle.type, 0);
            return;
          }
        }
      }
    } else if (selectedNodes.length === 1) {
      const selectedNode = this.stateManager.getSelectedNode();
      if (selectedNode && isShape(selectedNode)) {
        const zoom = this.getViewportManager().zoom;

        // Comprobar manipulación interactiva de degradados
        const grad = isGradient(selectedNode.fill)
          ? selectedNode.fill
          : isGradient(selectedNode.stroke)
          ? selectedNode.stroke
          : null;
        const gradProp: 'fill' | 'stroke' = isGradient(selectedNode.fill) ? 'fill' : 'stroke';

        if (grad) {
          const hitGrad = hitTestGradientHandles(selectedNode, grad, x, y, 10 / zoom);
          if (hitGrad) {
            this._activeGradientDrag = {
              shapeId: selectedNode.id,
              property: gradProp,
              initialGradient: grad,
              currentGradient: grad,
              handleType: hitGrad.type,
              stopId: hitGrad.stopId,
              startMouse: { x, y },
            };
            this._isDragging = false;
            this._isResizing = false;
            this._isRotating = false;
            this.canvas.style.cursor = 'crosshair';
            return;
          }
        }

        const handles = getSelectionHandles(selectedNode, 8 / zoom, 30 / zoom);
        const hitHandle = handles.find((handle) => isPointInAABB(x, y, handle));

        if (hitHandle) {
          if (hitHandle.type === 'rotation-handle') {
            this._isRotating = true;
            this._isResizing = false;
            this._isDragging = false;
            this.rotatingShapeId = selectedNode.id;
            this.initialRotation = selectedNode.rotation ?? 0;

            const centroid = this.getShapeCentroid(selectedNode);
            this.rotationCentroid = centroid;
            const clickAngle = (Math.atan2(y - centroid.y, x - centroid.x) * 180) / Math.PI;
            const expectedHandleAngle = this.initialRotation - 90;
            let offset = clickAngle - expectedHandleAngle;
            while (offset > 180) offset -= 360;
            while (offset <= -180) offset += 360;
            this.rotationAngleOffset = offset;

            this.canvas.style.cursor = 'crosshair';
            return;
          }

          // Marca la bandera _isResizing = true (y el origen del resize) en lugar de _isDragging
          this._isResizing = true;
          this._isDragging = false;
          this._isRotating = false;
          this.resizeOrigin = { x, y };
          this._lastResizeMousePos = { x, y };
          this._lastShiftKey = Boolean(event.shiftKey);
          this._lastAltKey = Boolean(event.altKey);
          this.activeResizeHandle = hitHandle.type;
          this.resizingShapeId = selectedNode.id;

          if (selectedNode.type === 'rectangle' || selectedNode.type === 'image') {
            this.initialDimensions = {
              x: selectedNode.x,
              y: selectedNode.y,
              width: selectedNode.width,
              height: selectedNode.height,
              rotation: selectedNode.rotation ?? 0,
            };
          } else if (selectedNode.type === 'ellipse') {
            this.initialDimensions = {
              x: selectedNode.x,
              y: selectedNode.y,
              radiusX: selectedNode.radiusX,
              radiusY: selectedNode.radiusY,
              rotation: selectedNode.rotation ?? 0,
            };
          } else if (selectedNode.type === 'path') {
            const aabb = getPathBaseAABB(selectedNode);
            this.initialDimensions = {
              x: selectedNode.x,
              y: selectedNode.y,
              width: aabb.width,
              height: aabb.height,
              points: selectedNode.points,
              rotation: selectedNode.rotation ?? 0,
            };
          } else if (selectedNode.type === 'text') {
            const ctx = typeof this.canvas.getContext === 'function' ? this.canvas.getContext('2d') : null;
            const aabb = getTextBaseAABB(selectedNode, ctx);
            this.initialDimensions = {
              x: selectedNode.x,
              y: selectedNode.y,
              baseX: aabb.minX,
              baseY: aabb.minY,
              width: aabb.width,
              height: aabb.height,
              fontSize: selectedNode.fontSize ?? 16,
              lineHeight: selectedNode.lineHeight,
              letterSpacing: selectedNode.letterSpacing,
              rotation: selectedNode.rotation ?? 0,
              boxWidth: selectedNode.boxWidth,
            };
          } else {
            this.initialDimensions = null;
          }

          this.canvas.style.cursor = this.getResizeCursor(hitHandle.type, selectedNode.rotation ?? 0);
          return;
        }

        // Comprobar si se hizo clic sobre un tirador de radio de esquina (Corner Radius Handle)
        const crHandles = getShapeCornerRadiusHandles(selectedNode, zoom);
        const hitCRHandle = hitTestCornerRadiusHandle(crHandles, x, y, 8 / zoom);
        if (hitCRHandle) {
          this._activeCornerRadiusDrag = {
            handle: hitCRHandle,
            shapeId: selectedNode.id,
            initialRadius: hitCRHandle.currentRadius,
            startMouse: { x, y },
          };
          this._isDragging = false;
          this._isResizing = false;
          this._isRotating = false;
          this.canvas.style.cursor = 'crosshair';
          return;
        }
      }
    }

    // 2. Si no hubo colisión con los manejadores, evaluar colisiones con figuras mediante hitTest
    const hitShape = this.hitTest(x, y);

    if (hitShape) {
      if (this._isMarqueeSelecting) {
        this.cancelMarquee();
      }

      const targetNode = this.resolveNodeToSelect(hitShape);
      const targetId = targetNode.id;

      // Shift+clic sobre una figura/grupo: la añade o quita de la selección (toggleInSelection). Sin arrastre.
      if (event.shiftKey) {
        this.stateManager.toggleInSelection(targetId);
        this.resetDrag();
        this.resetResize();
        this.resetRotate();
        return;
      }

      // Clic sin Shift sobre una figura/grupo
      const isAlreadySelected = this.stateManager.isSelected(targetId);
      const isMultiSelection = this.stateManager.getSelection().length > 1;

      if (isAlreadySelected && isMultiSelection) {
        this.pendingSingleSelectionId = targetId;
      } else if (!isAlreadySelected) {
        this.stateManager.selectNode(targetId);
        this.pendingSingleSelectionId = null;
      } else {
        this.pendingSingleSelectionId = null;
      }

      this._isDragging = true;
      this._isCopyDragging = false;
      this.originalSelectionIds = this.stateManager.getSelection();
      this.activeClonePlacements = null;
      this._isResizing = false;
      this._isRotating = false;
      this.dragOrigin = { x, y };
      this.dragStartScreen = this.getScreenCoordinates(event);
      this.hasMovedPastThreshold = false;

      // Registrar posiciones iniciales de todas las figuras hoja del conjunto seleccionado
      const selectedNodesAfter = this.stateManager.getSelectedNodes();
      const leafShapes = getLeafShapes(selectedNodesAfter);
      this.initialShapesPositions = new Map<string, { x: number; y: number }>();
      this.initialShapesBounds = new Map<string, AABB>();
      this.originalLeafPositions = new Map<string, { x: number; y: number }>();
      this.originalLeafBounds = new Map<string, AABB>();
      for (const node of leafShapes) {
        this.initialShapesPositions.set(node.id, { x: node.x, y: node.y });
        this.initialShapesBounds.set(node.id, getShapeAABB(node));
        this.originalLeafPositions.set(node.id, { x: node.x, y: node.y });
        this.originalLeafBounds.set(node.id, getShapeAABB(node));
      }

      this.canvas.style.cursor = 'grabbing';
      return;
    }

    // 3. Clic sobre el vacío: Prepara el rectángulo de selección marquesina.
    this.resetDrag();
    this.resetResize();
    this.resetRotate();

    this._isMarqueeSelecting = true;
    this._marqueeStartWorld = { x, y };
    this._marqueeStartScreen = this.getScreenCoordinates(event);
    this._marqueeShiftKey = Boolean(event.shiftKey);
    this._marqueeInitialSelection = [...this.stateManager.getSelection()];
    this._hasMarqueeDragged = false;
    this._shapePreview = null;

    if (!event.shiftKey && this.options.deselectOnEmptyClick) {
      this.stateManager.selectNode(null);
    }
  }

  public onMouseMove(event: MouseEvent, coords: Vector2D): void {
    const { x, y } = coords;

    if (this._activeCornerRadiusDrag) {
      const { handle, shapeId } = this._activeCornerRadiusDrag;
      const newRadius = calculateRadiusFromHandleDrag(handle, x, y);
      const node = this.stateManager.findNode(shapeId);
      if (node && isShape(node)) {
        if (node.type === 'star' && handle.isInner) {
          this.stateManager.updateShapeDimensions(shapeId, { innerCornerRadius: newRadius });
        } else {
          this.stateManager.updateShapeDimensions(shapeId, { cornerRadius: newRadius });
        }
      }
      this.canvas.style.cursor = 'crosshair';
      return;
    }

    if (this._activeGradientDrag) {
      const { shapeId, property, currentGradient, handleType, stopId } = this._activeGradientDrag;
      const currentShape = this.stateManager.findNode(shapeId);
      if (!currentShape || !isShape(currentShape)) return;

      const norm = worldToGradientCoord(currentShape, x, y);
      let nextGrad: Gradient = currentGradient;

      if (handleType === 'gradient-start' && currentGradient.type === 'linear') {
        nextGrad = { ...currentGradient, x1: norm.x, y1: norm.y };
      } else if (handleType === 'gradient-end' && currentGradient.type === 'linear') {
        nextGrad = { ...currentGradient, x2: norm.x, y2: norm.y };
      } else if (handleType === 'gradient-center' && currentGradient.type === 'radial') {
        nextGrad = { ...currentGradient, cx: norm.x, cy: norm.y };
      } else if (handleType === 'gradient-radius' && currentGradient.type === 'radial') {
        const dx = norm.x - currentGradient.cx;
        const dy = norm.y - currentGradient.cy;
        const r = Math.max(0.01, Math.hypot(dx, dy));
        nextGrad = { ...currentGradient, r };
      } else if (handleType === 'gradient-stop' && stopId) {
        let t = 0;
        if (currentGradient.type === 'linear') {
          const p1 = gradientToWorldPoint(currentShape, currentGradient.x1, currentGradient.y1);
          const p2 = gradientToWorldPoint(currentShape, currentGradient.x2, currentGradient.y2);
          t = projectPointOnSegment(coords, p1, p2);
        } else {
          const c = gradientToWorldPoint(currentShape, currentGradient.cx, currentGradient.cy);
          const rPt = gradientToWorldPoint(currentShape, currentGradient.cx + currentGradient.r, currentGradient.cy);
          t = projectPointOnSegment(coords, c, rPt);
        }
        const updatedStops = currentGradient.stops.map((s) => (s.id === stopId ? { ...s, offset: t } : s));
        nextGrad = { ...currentGradient, stops: updatedStops };
      }

      this._activeGradientDrag.currentGradient = nextGrad;
      this.stateManager.updateShape(shapeId, { [property]: nextGrad });
      this.canvas.style.cursor = 'crosshair';
      return;
    }

    if (this._multiTransformState) {
      this._lastShiftKey = Boolean(event.shiftKey);
      this._lastAltKey = Boolean(event.altKey);
      this.applyMultiTransform(x, y, Boolean(event.shiftKey), Boolean(event.altKey));
      return;
    }

    if (this._isRotating && this.rotatingShapeId) {
      const rawNode = this.stateManager.findNode(this.rotatingShapeId) ?? this.stateManager.getSelectedNode();
      const selectedShape = rawNode && isShape(rawNode) ? rawNode : null;
      if (selectedShape) {
        const centroid = this.rotationCentroid ?? this.getShapeCentroid(selectedShape);
        const deltaX = x - centroid.x;
        const deltaY = y - centroid.y;
        const radians = Math.atan2(deltaY, deltaX);
        const mouseAngle = (radians * 180) / Math.PI;

        let degrees = mouseAngle - this.rotationAngleOffset + 90;
        if (event.shiftKey) {
          degrees = Math.round(degrees / 15) * 15;
        } else {
          degrees = Math.round(degrees);
        }
        while (degrees > 180) degrees -= 360;
        while (degrees <= -180) degrees += 360;

        this.stateManager.updateShape(this.rotatingShapeId, { rotation: degrees });
        this.canvas.style.cursor = 'crosshair';
        return;
      }
    }

    // 1. Arrastre del rectángulo de selección marquesina
    if (this._isMarqueeSelecting && this._marqueeStartWorld && this._marqueeStartScreen) {
      const screenPos = this.getScreenCoordinates(event);
      const screenDist = Math.hypot(
        screenPos.x - this._marqueeStartScreen.x,
        screenPos.y - this._marqueeStartScreen.y
      );

      if (screenDist > 3 || this._hasMarqueeDragged) {
        this._hasMarqueeDragged = true;

        const minX = Math.min(this._marqueeStartWorld.x, x);
        const minY = Math.min(this._marqueeStartWorld.y, y);
        const width = Math.abs(x - this._marqueeStartWorld.x);
        const height = Math.abs(y - this._marqueeStartWorld.y);

        this._shapePreview = {
          type: 'marquee',
          x: minX,
          y: minY,
          width,
          height,
        };

        const docState = this.stateManager.getState();
        const candidates: SelectableNode[] = [];
        for (const layer of docState.children) {
          if (layer.visible === false || layer.locked === true) {
            continue;
          }
          for (const child of layer.children) {
            if (child.visible === false || child.locked === true) {
              continue;
            }
            if (isSelectable(child)) {
              candidates.push(child);
            }
          }
        }

        const intersecting = getShapesIntersectingRect(candidates, {
          x: minX,
          y: minY,
          width,
          height,
        });

        const hitIds = intersecting.map((s) => s.id);

        if (this._marqueeShiftKey) {
          const combined = new Set([...this._marqueeInitialSelection, ...hitIds]);
          this.stateManager.setSelection(Array.from(combined));
        } else {
          this.stateManager.setSelection(hitIds);
        }

        this.stateManager.markDirty();
      }

      this.canvas.style.cursor = 'default';
      return;
    }

    // 2. Arrastre de figuras
    if (this._isDragging && this.initialShapesPositions && this.dragOrigin && this.dragStartScreen) {
      const screenPos = this.getScreenCoordinates(event);
      const screenDist = Math.hypot(
        screenPos.x - this.dragStartScreen.x,
        screenPos.y - this.dragStartScreen.y
      );

      const shouldMove = screenDist > 3 || this.hasMovedPastThreshold;

      if (shouldMove) {
        if (screenDist > 3) {
          this.hasMovedPastThreshold = true;
          this.pendingSingleSelectionId = null;
        }

        // Evaluar Alt para alternar entre modo copia y modo normal
        this.syncCopyDragMode(Boolean(event.altKey));

        const rawDeltaX = x - this.dragOrigin.x;
        const rawDeltaY = y - this.dragOrigin.y;
        const snap = this.calculateDragSnap(rawDeltaX, rawDeltaY);
        this.setActiveGuides(snap.guides);
        const deltaX = rawDeltaX + snap.dx;
        const deltaY = rawDeltaY + snap.dy;

        const entries: ShapePositionEntry[] = [];
        for (const [id, initialPos] of this.initialShapesPositions.entries()) {
          entries.push({
            id,
            x: initialPos.x + deltaX,
            y: initialPos.y + deltaY,
          });
        }

        this.stateManager.updateShapesPosition(entries);
        this.canvas.style.cursor = this._isCopyDragging ? 'copy' : 'grabbing';
        return;
      }
    }

    if (this._isResizing) {
      if (
        this.resizingShapeId &&
        this.resizeOrigin &&
        this.activeResizeHandle &&
        this.initialDimensions
      ) {
        this._lastResizeMousePos = { x, y };
        this._lastShiftKey = Boolean(event.shiftKey);
        this._lastAltKey = Boolean(event.altKey);
        this.calculateSnappedResizeDimensions(x, y, Boolean(event.shiftKey), Boolean(event.altKey));

        const currentShape = this.stateManager.findNode(this.resizingShapeId) as Shape | null;
        this.canvas.style.cursor = this.getResizeCursor(
          this.activeResizeHandle,
          currentShape?.rotation ?? this.initialDimensions.rotation ?? 0
        );
      }
      return;
    }

    // Verificar si el cursor sobrevuela uno de los manejadores del nodo seleccionado (o grupo / multiselección)
    const currentSelected = this.stateManager.getSelectedNodes();
    const isMultiOrGroupHover = currentSelected.length >= 2 || (currentSelected.length === 1 && isGroup(currentSelected[0]));

    if (isMultiOrGroupHover) {
      const bounds = getSelectionBounds(currentSelected);
      if (bounds) {
        const zoom = this.getViewportManager().zoom;
        const handles = getSelectionBoxHandles(bounds, 8 / zoom, 30 / zoom);
        const hoveredHandle = handles.find((handle) => isPointInAABB(x, y, handle));
        if (hoveredHandle) {
          if (hoveredHandle.type === 'rotation-handle') {
            this.canvas.style.cursor = 'crosshair';
            return;
          }
          this.canvas.style.cursor = this.getResizeCursor(hoveredHandle.type, 0);
          return;
        }
      }
    } else if (currentSelected.length === 1) {
      const selectedShape = currentSelected[0];
      if (isShape(selectedShape)) {
        const zoom = this.getViewportManager().zoom;

        const grad = isGradient(selectedShape.fill)
          ? selectedShape.fill
          : isGradient(selectedShape.stroke)
          ? selectedShape.stroke
          : null;
        if (grad) {
          const hitGrad = hitTestGradientHandles(selectedShape, grad, x, y, 10 / zoom);
          if (hitGrad) {
            this.canvas.style.cursor = 'crosshair';
            return;
          }
        }

        const handles = getSelectionHandles(selectedShape, 8 / zoom, 30 / zoom);
        const hoveredHandle = handles.find((handle) => isPointInAABB(x, y, handle));
        if (hoveredHandle) {
          if (hoveredHandle.type === 'rotation-handle') {
            this.canvas.style.cursor = 'crosshair';
            return;
          }
          this.canvas.style.cursor = this.getResizeCursor(hoveredHandle.type, selectedShape.rotation ?? 0);
          return;
        }

        const crHandles = getShapeCornerRadiusHandles(selectedShape, zoom);
        const hoveredCRHandle = hitTestCornerRadiusHandle(crHandles, x, y, 8 / zoom);
        if (hoveredCRHandle) {
          this.canvas.style.cursor = 'crosshair';
          return;
        }
      }
    }

    const hitShape = this.hitTest(x, y);
    this._hoveredShapeId = hitShape ? hitShape.id : null;

    if (hitShape) {
      this.canvas.style.cursor = this.stateManager.isSelected(hitShape.id) ? 'move' : 'pointer';
    } else {
      this.canvas.style.cursor = 'default';
    }
  }

  public onMouseUp(event: MouseEvent, coords: Vector2D): void {
    const { x, y } = coords;

    if (this._activeCornerRadiusDrag) {
      const { handle, shapeId, initialRadius } = this._activeCornerRadiusDrag;
      this._activeCornerRadiusDrag = null;
      const node = this.stateManager.findNode(shapeId);
      const finalRadius = node && isShape(node)
        ? (node.type === 'star' && handle.isInner ? (node as Star).innerCornerRadius ?? 0 : (node as Rectangle | Polygon | Star | Path).cornerRadius ?? 0)
        : initialRadius;

      if (finalRadius !== initialRadius) {
        const cmd = new ResizeCommand(
          this.stateManager,
          shapeId,
          handle.isInner ? { innerCornerRadius: initialRadius } : { cornerRadius: initialRadius },
          handle.isInner ? { innerCornerRadius: finalRadius } : { cornerRadius: finalRadius }
        );
        this.commandManager.recordCommand(cmd);
      }

      const hitShape = this.hitTest(x, y);
      this.canvas.style.cursor = hitShape ? (this.stateManager.isSelected(hitShape.id) ? 'move' : 'pointer') : 'default';
      return;
    }

    if (this._activeGradientDrag) {
      const { shapeId, property, initialGradient, currentGradient } = this._activeGradientDrag;
      this._activeGradientDrag = null;

      if (JSON.stringify(initialGradient) !== JSON.stringify(currentGradient)) {
        const cmd = new StyleCommand(
          this.stateManager,
          shapeId,
          { [property]: initialGradient },
          { [property]: currentGradient }
        );
        this.commandManager.recordCommand(cmd);
      }

      const hitShape = this.hitTest(x, y);
      this.canvas.style.cursor = hitShape ? (this.stateManager.isSelected(hitShape.id) ? 'move' : 'pointer') : 'default';
      return;
    }

    if (this._multiTransformState) {
      const entries: ShapeTransformEntry[] = this._multiTransformState.leafShapes.map((initialShape) => {
        const currentShape = (this.stateManager.findNode(initialShape.id) as Shape | null) ?? initialShape;
        return {
          id: initialShape.id,
          before: getShapeDimensions(initialShape),
          after: getShapeDimensions(currentShape),
        };
      });

      const command = new TransformShapesCommand(this.stateManager, entries);
      if (!command.isAlreadyAtTarget) {
        this.commandManager.recordCommand(command);
      }

      this.resetMultiTransform();
      const hitShape = this.hitTest(x, y);
      this.canvas.style.cursor = hitShape ? (this.stateManager.isSelected(hitShape.id) ? 'move' : 'pointer') : 'default';
      return;
    }

    if (this._isRotating) {
      if (this.rotatingShapeId && this.initialRotation !== null) {
        const rawNode = this.stateManager.findNode(this.rotatingShapeId) ?? this.stateManager.getSelectedNode();
        const selectedShape = rawNode && isShape(rawNode) ? rawNode : null;
        if (selectedShape) {
          const finalRotation = selectedShape.rotation ?? this.initialRotation;
          if (finalRotation !== this.initialRotation) {
            const command = new RotateCommand(
              this.stateManager,
              this.rotatingShapeId,
              this.initialRotation,
              finalRotation
            );
            this.commandManager.recordCommand(command);
          }
        }
      }

      this.resetRotate();
      const hitShape = this.hitTest(x, y);
      this.canvas.style.cursor = hitShape ? (this.stateManager.isSelected(hitShape.id) ? 'move' : 'pointer') : 'default';
      return;
    }

    if (this._isResizing) {
      if (
        this.resizingShapeId &&
        this.resizeOrigin &&
        this.activeResizeHandle &&
        this.initialDimensions
      ) {
        const finalDimensions = this.calculateSnappedResizeDimensions(
          x,
          y,
          Boolean(event.shiftKey),
          Boolean(event.altKey)
        );

        if (finalDimensions && this.hasDimensionsChanged(this.initialDimensions, finalDimensions)) {
          const command = new ResizeCommand(
            this.stateManager,
            this.resizingShapeId,
            this.initialDimensions,
            finalDimensions
          );
          this.commandManager.recordCommand(command);
        }
      }

      this.resetResize();
      const hitShape = this.hitTest(x, y);
      this.canvas.style.cursor = hitShape ? (this.stateManager.isSelected(hitShape.id) ? 'move' : 'pointer') : 'default';
      return;
    }

    // Finalizar selección marquesina si estaba activa
    if (this._isMarqueeSelecting) {
      if (!this._hasMarqueeDragged) {
        if (!this._marqueeShiftKey && this.options.deselectOnEmptyClick) {
          this.stateManager.selectNode(null);
        } else if (this._marqueeShiftKey) {
          this.stateManager.setSelection(this._marqueeInitialSelection);
        }
      }
      this._isMarqueeSelecting = false;
      this._marqueeStartWorld = null;
      this._marqueeStartScreen = null;
      this._marqueeShiftKey = false;
      this._marqueeInitialSelection = [];
      this._hasMarqueeDragged = false;
      this._shapePreview = null;
      this.stateManager.markDirty();

      const hitShape = this.hitTest(x, y);
      this.canvas.style.cursor = hitShape ? (this.stateManager.isSelected(hitShape.id) ? 'move' : 'pointer') : 'default';
      return;
    }

    if (!this._isDragging) {
      this.resetDrag();
      return;
    }

    if (event.button !== 0 && event.button !== undefined) {
      this.resetDrag();
      return;
    }

    const screenPos = this.getScreenCoordinates(event);
    const screenDist = this.dragStartScreen
      ? Math.hypot(screenPos.x - this.dragStartScreen.x, screenPos.y - this.dragStartScreen.y)
      : 0;

    // Soltar sobre una figura que formaba parte de multiselección sin haber arrastrado (>3px):
    if (this.pendingSingleSelectionId && screenDist <= 3 && !this.hasMovedPastThreshold) {
      if (this.initialShapesPositions) {
        const restoreEntries: ShapePositionEntry[] = [];
        for (const [id, pos] of this.initialShapesPositions.entries()) {
          restoreEntries.push({ id, x: pos.x, y: pos.y });
        }
        this.stateManager.updateShapesPosition(restoreEntries);
      }
      this.stateManager.selectNode(this.pendingSingleSelectionId);
      this.resetDrag();
      const hitShape = this.hitTest(x, y);
      this.canvas.style.cursor = hitShape ? (this.stateManager.isSelected(hitShape.id) ? 'move' : 'pointer') : 'default';
      return;
    }

    // Finalizar arrastre de figuras:
    if (this.hasMovedPastThreshold && this.initialShapesPositions && this.dragOrigin) {
      // Evaluar Alt también en el mouseup
      this.syncCopyDragMode(Boolean(event.altKey));

      const rawDeltaX = x - this.dragOrigin.x;
      const rawDeltaY = y - this.dragOrigin.y;

      if (this._isCopyDragging && this.activeClonePlacements) {
        // Asegurar posición final de las figuras hoja de los clones
        const entries: ShapePositionEntry[] = [];
        for (const [id, initialPos] of this.initialShapesPositions.entries()) {
          entries.push({ id, x: initialPos.x + rawDeltaX, y: initialPos.y + rawDeltaY });
        }
        this.stateManager.updateShapesPosition(entries);

        // BatchCommand de AddShapeCommand construido con los clones tal como están ahora en el estado
        const commands: AddShapeCommand[] = [];
        for (const p of this.activeClonePlacements) {
          const finalClone = this.stateManager.findNode(p.clonedNode.id) as SelectableNode;
          if (finalClone) {
            commands.push(new AddShapeCommand(this.stateManager, p.parentId, finalClone, p.targetIndex));
          }
        }

        if (commands.length > 0) {
          const batch = new BatchCommand(commands, 'Copiar y mover');
          this.commandManager.recordCommand(batch);
        }

        this.resetDrag();
        const hitShape = this.hitTest(x, y);
        this.canvas.style.cursor = hitShape ? (this.stateManager.isSelected(hitShape.id) ? 'move' : 'pointer') : 'default';
        return;
      }

      const snap = this.calculateDragSnap(rawDeltaX, rawDeltaY);
      this.setActiveGuides(snap.guides);
      const deltaX = rawDeltaX + snap.dx;
      const deltaY = rawDeltaY + snap.dy;
      const selectedNodes = this.stateManager.getSelectedNodes();
      const isGroupSelected = selectedNodes.some(isGroup);

      if (this.initialShapesPositions.size > 1 || isGroupSelected) {
        const commands: TranslateCommand[] = [];
        const entries: ShapePositionEntry[] = [];

        for (const [id, initialPos] of this.initialShapesPositions.entries()) {
          const finalX = initialPos.x + deltaX;
          const finalY = initialPos.y + deltaY;
          entries.push({ id, x: finalX, y: finalY });

          if (finalX !== initialPos.x || finalY !== initialPos.y) {
            commands.push(
              new TranslateCommand(
                this.stateManager,
                id,
                initialPos.x,
                initialPos.y,
                finalX,
                finalY,
                { mergeTimeout: 0 }
              )
            );
          }
        }

        this.stateManager.updateShapesPosition(entries);

        if (commands.length > 0) {
          const batch = new BatchCommand(commands, 'Mover figuras');
          this.commandManager.recordCommand(batch);
        }
      } else if (this.initialShapesPositions.size === 1) {
        const [singleId, initialPos] = Array.from(this.initialShapesPositions.entries())[0];
        const finalX = initialPos.x + deltaX;
        const finalY = initialPos.y + deltaY;

        this.stateManager.updateShapePosition(singleId, finalX, finalY);

        if (finalX !== initialPos.x || finalY !== initialPos.y) {
          const command = new TranslateCommand(
            this.stateManager,
            singleId,
            initialPos.x,
            initialPos.y,
            finalX,
            finalY,
            { mergeTimeout: 0 }
          );
          this.commandManager.recordCommand(command);
        }
      }
    } else if (!this.hasMovedPastThreshold && this.initialShapesPositions) {
      // Si no superó el umbral de arrastre (>3px), restaurar posiciones originales por si hubo micro-movimiento
      const restoreEntries: ShapePositionEntry[] = [];
      for (const [id, pos] of this.initialShapesPositions.entries()) {
        restoreEntries.push({ id, x: pos.x, y: pos.y });
      }
      this.stateManager.updateShapesPosition(restoreEntries);
    }

    this.resetDrag();

    const hitShape = this.hitTest(x, y);
    this.canvas.style.cursor = hitShape ? (this.stateManager.isSelected(hitShape.id) ? 'move' : 'pointer') : 'default';
  }

  public cancelMarquee(): void {
    if (!this._isMarqueeSelecting && this._shapePreview === null) {
      return;
    }
    this._isMarqueeSelecting = false;
    this.stateManager.setSelection(this._marqueeInitialSelection);
    this._shapePreview = null;
    this._marqueeStartWorld = null;
    this._marqueeStartScreen = null;
    this._marqueeShiftKey = false;
    this._marqueeInitialSelection = [];
    this._hasMarqueeDragged = false;
    this.stateManager.markDirty();
  }

  public resetDrag(): void {
    this.setActiveGuides([]);
    this._isDragging = false;
    this._isCopyDragging = false;
    this.originalSelectionIds = [];
    this.originalLeafPositions = null;
    this.originalLeafBounds = null;
    this.activeClonePlacements = null;
    this.dragOrigin = null;
    this.initialShapesPositions = null;
    this.initialShapesBounds = null;
    this.pendingSingleSelectionId = null;
    this.dragStartScreen = null;
    this.hasMovedPastThreshold = false;
    this._activeGradientDrag = null;
  }

  public resetResize(): void {
    this._isResizing = false;
    this.resizeOrigin = null;
    this._lastResizeMousePos = null;
    this._lastShiftKey = false;
    this._lastAltKey = false;
    this.activeResizeHandle = null;
    this.resizingShapeId = null;
    this.initialDimensions = null;
    this.resetMultiTransform();
  }

  public resetRotate(): void {
    this._isRotating = false;
    this.rotatingShapeId = null;
    this.initialRotation = null;
    this.rotationAngleOffset = 0;
    this.rotationCentroid = null;
    this.resetMultiTransform();
  }

  public resetMultiTransform(): void {
    this._multiTransformState = null;
    this.setActiveGuides([]);
  }

  public handleShiftToggle(shiftKey: boolean): void {
    this._lastShiftKey = shiftKey;
    if (this._multiTransformState && this._multiTransformState.lastMouse) {
      this.applyMultiTransform(
        this._multiTransformState.lastMouse.x,
        this._multiTransformState.lastMouse.y,
        shiftKey,
        this._lastAltKey
      );
      this.stateManager.markDirty();
      return;
    }
    if (
      this._isResizing &&
      this.resizingShapeId &&
      this.resizeOrigin &&
      this.activeResizeHandle &&
      this.initialDimensions &&
      this._lastResizeMousePos
    ) {
      this.calculateSnappedResizeDimensions(
        this._lastResizeMousePos.x,
        this._lastResizeMousePos.y,
        shiftKey,
        this._lastAltKey
      );
      this.stateManager.markDirty();
    }
  }

  public handleAltToggle(altKey: boolean): void {
    this._lastAltKey = altKey;
    if (this._multiTransformState && this._multiTransformState.lastMouse) {
      this.applyMultiTransform(
        this._multiTransformState.lastMouse.x,
        this._multiTransformState.lastMouse.y,
        this._lastShiftKey,
        altKey
      );
      this.stateManager.markDirty();
      return;
    }
    if (
      this._isResizing &&
      this.resizingShapeId &&
      this.resizeOrigin &&
      this.activeResizeHandle &&
      this.initialDimensions &&
      this._lastResizeMousePos
    ) {
      this.calculateSnappedResizeDimensions(
        this._lastResizeMousePos.x,
        this._lastResizeMousePos.y,
        this._lastShiftKey,
        altKey
      );
      this.stateManager.markDirty();
    }
  }

  public handleEscape(): boolean {
    if (this._activeGradientDrag) {
      this.stateManager.updateShape(this._activeGradientDrag.shapeId, {
        [this._activeGradientDrag.property]: this._activeGradientDrag.initialGradient,
      });
      this._activeGradientDrag = null;
      this.stateManager.markDirty();
      this.canvas.style.cursor = 'default';
      return true;
    }

    if (this._multiTransformState) {
      const restoreEntries = this._multiTransformState.leafShapes.map((shape) => ({
        id: shape.id,
        dimensions: getShapeDimensions(shape),
      }));
      this.stateManager.updateShapesDimensions(restoreEntries);
      this.resetMultiTransform();
      this.stateManager.markDirty();
      this.canvas.style.cursor = 'default';
      return true;
    }

    if (this._isDragging && this._isCopyDragging && this.activeClonePlacements) {
      for (const p of this.activeClonePlacements) {
        this.stateManager.removeFromSelection([p.clonedNode.id]);
        this.stateManager.removeNode(p.clonedNode.id);
      }
      this.stateManager.setSelection(this.originalSelectionIds);
      if (this.originalLeafPositions) {
        const restoreEntries: ShapePositionEntry[] = [];
        for (const [id, pos] of this.originalLeafPositions.entries()) {
          restoreEntries.push({ id, x: pos.x, y: pos.y });
        }
        this.stateManager.updateShapesPosition(restoreEntries);
      }
      this.resetDrag();
      this.stateManager.markDirty();
      this.canvas.style.cursor = 'default';
      return true;
    }

    if (this._isDragging) {
      if (this.initialShapesPositions) {
        const restoreEntries: ShapePositionEntry[] = [];
        for (const [id, pos] of this.initialShapesPositions.entries()) {
          restoreEntries.push({ id, x: pos.x, y: pos.y });
        }
        this.stateManager.updateShapesPosition(restoreEntries);
      }
      this.resetDrag();
      this.stateManager.markDirty();
      this.canvas.style.cursor = 'default';
      return true;
    }

    if (this._isMarqueeSelecting) {
      this.cancelMarquee();
      return true;
    }

    if (this._isRotating && this.rotatingShapeId && this.initialRotation !== null) {
      this.stateManager.updateShape(this.rotatingShapeId, { rotation: this.initialRotation });
      this.resetRotate();
      this.stateManager.markDirty();
      this.canvas.style.cursor = 'default';
      return true;
    }

    if (this._isResizing && this.resizingShapeId && this.initialDimensions) {
      this.stateManager.updateShape(this.resizingShapeId, this.initialDimensions);
      this.resetResize();
      this.stateManager.markDirty();
      this.canvas.style.cursor = 'default';
      return true;
    }

    return false;
  }

  public syncCopyDragMode(altKey: boolean): void {
    if (altKey && !this._isCopyDragging) {
      // 1. Restaurar originales a su posición inicial si se habían movido
      if (this.originalLeafPositions) {
        const restoreEntries: ShapePositionEntry[] = [];
        for (const [id, pos] of this.originalLeafPositions.entries()) {
          restoreEntries.push({ id, x: pos.x, y: pos.y });
        }
        this.stateManager.updateShapesPosition(restoreEntries);
      }

      // 2. Obtener los nodos originales para clonar
      const originalNodes: SelectableNode[] = [];
      for (const id of this.originalSelectionIds) {
        const node = this.stateManager.findNode(id);
        if (node && isSelectable(node)) {
          originalNodes.push(node);
        }
      }

      // 3. Crear clones con desplazamiento 0 e insertarlos en el estado (sin historial)
      const prepared = this.selectionOperations.prepareClones(originalNodes, { dx: 0, dy: 0 });
      for (const p of prepared) {
        this.stateManager.addNode(p.parentId, p.clonedNode, p.targetIndex);
      }
      this.activeClonePlacements = prepared;

      // 4. Pasar la selección a los clones
      const cloneIds = prepared.map((p) => p.clonedNode.id);
      this.stateManager.setSelection(cloneIds);

      // 5. Usar las posiciones iniciales de las figuras hoja de los clones como nueva instantánea
      const clonedSelectedNodes = this.stateManager.getSelectedNodes();
      const clonedLeafShapes = getLeafShapes(clonedSelectedNodes);
      this.initialShapesPositions = new Map<string, { x: number; y: number }>();
      this.initialShapesBounds = new Map<string, AABB>();
      for (const leaf of clonedLeafShapes) {
        this.initialShapesPositions.set(leaf.id, { x: leaf.x, y: leaf.y });
        this.initialShapesBounds.set(leaf.id, getShapeAABB(leaf));
      }

      this._isCopyDragging = true;
    } else if (!altKey && this._isCopyDragging) {
      // 1. Eliminar los clones del estado
      if (this.activeClonePlacements) {
        for (const p of this.activeClonePlacements) {
          this.stateManager.removeFromSelection([p.clonedNode.id]);
          this.stateManager.removeNode(p.clonedNode.id);
        }
        this.activeClonePlacements = null;
      }

      // 2. Volver a seleccionar las figuras originales
      this.stateManager.setSelection(this.originalSelectionIds);

      // 3. Restaurar la instantánea a las posiciones iniciales de los originales
      if (this.originalLeafPositions) {
        this.initialShapesPositions = new Map(this.originalLeafPositions);
      }
      if (this.originalLeafBounds) {
        this.initialShapesBounds = new Map(this.originalLeafBounds);
      }

      this._isCopyDragging = false;
    }
  }

  public applyMultiTransform(x: number, y: number, shiftKey: boolean, altKey: boolean = false): void {
    if (!this._multiTransformState) {
      return;
    }
    const transformState = this._multiTransformState;
    transformState.lastMouse = { x, y };

    if (transformState.type === 'rotate') {
      this.setActiveGuides([]);
      const pivot = transformState.anchorOrPivot;
      const startMouse = transformState.startMouse;
      const currentMouse = { x, y };
      const deltaDeg = computeRotationDelta(pivot, startMouse, currentMouse, shiftKey);
      const changes = rotateShapesAboutPivot(transformState.leafShapes, pivot, deltaDeg);
      if (changes.length === 0) {
        const restoreEntries = transformState.leafShapes.map((shape) => ({
          id: shape.id,
          dimensions: getShapeDimensions(shape),
        }));
        this.stateManager.updateShapesDimensions(restoreEntries);
      } else {
        this.stateManager.updateShapesDimensions(changes);
      }
      this.canvas.style.cursor = 'crosshair';
    } else if (transformState.type === 'scale') {
      const handle = transformState.handle!;
      const bounds = transformState.initialBounds;
      const hasTextOrImage = transformState.leafShapes.some((s) => s.type === 'text' || s.type === 'image');
      const shouldPreserveAspect = hasTextOrImage ? true : shiftKey;

      const applyScale = (mouseX: number, mouseY: number): void => {
        const dx = mouseX - transformState.startMouse.x;
        const dy = mouseY - transformState.startMouse.y;
        const { anchor, sx, sy } = computeBoxScale(bounds, handle, dx, dy, shouldPreserveAspect, altKey);
        const changes = scaleShapesAboutAnchor(transformState.leafShapes, anchor, sx, sy);
        if (changes.length === 0) {
          const restoreEntries = transformState.leafShapes.map((shape) => ({
            id: shape.id,
            dimensions: getShapeDimensions(shape),
          }));
          this.stateManager.updateShapesDimensions(restoreEntries);
        } else {
          this.stateManager.updateShapesDimensions(changes);
        }
      };

      applyScale(x, y);

      if (altKey) {
        this.setActiveGuides([]);
        this.canvas.style.cursor = this.getResizeCursor(handle, 0);
        return;
      }

      const scaledShapes = transformState.leafShapes
        .map((shape) => this.stateManager.findNode(shape.id))
        .filter((shape): shape is Shape => Boolean(shape && isShape(shape)));
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const shape of scaledShapes) {
        const shapeBounds = getShapeAABB(shape);
        minX = Math.min(minX, shapeBounds.minX);
        minY = Math.min(minY, shapeBounds.minY);
        maxX = Math.max(maxX, shapeBounds.maxX);
        maxY = Math.max(maxY, shapeBounds.maxY);
      }
      if (Number.isFinite(minX) && Number.isFinite(minY)) {
        const scaledBounds: AABB = {
          minX,
          minY,
          maxX,
          maxY,
          width: maxX - minX,
          height: maxY - minY,
        };
        const fixedXFeature: 0 | 2 | 'all' = handle.includes('right')
          ? 0
          : handle.includes('left') ? 2 : 'all';
        const fixedYFeature: 0 | 2 | 'all' = handle.includes('bottom')
          ? 0
          : handle.includes('top') ? 2 : 'all';
        const snap = this.calculateAABBSnap(
          scaledBounds,
          new Set(transformState.leafShapes.map((shape) => shape.id)),
          fixedXFeature,
          fixedYFeature
        );
        this.setActiveGuides(snap.guides);
        if (snap.dx !== 0 || snap.dy !== 0) {
          applyScale(x + snap.dx, y + snap.dy);
        }
      } else {
        this.setActiveGuides([]);
      }
      this.canvas.style.cursor = this.getResizeCursor(handle, 0);
    }
  }

  public calculateDragSnap(deltaX: number, deltaY: number): { dx: number; dy: number; guides: SnapGuide[] } {
    if (!this.isSmartGuidesEnabled()) {
      return { dx: 0, dy: 0, guides: [] };
    }
    const initialShapesBounds = this.initialShapesBounds;
    const initialShapesPositions = this.initialShapesPositions;
    if (!initialShapesBounds || !initialShapesPositions || this._isCopyDragging) {
      return { dx: 0, dy: 0, guides: [] };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const bounds of initialShapesBounds.values()) {
      minX = Math.min(minX, bounds.minX + deltaX);
      minY = Math.min(minY, bounds.minY + deltaY);
      maxX = Math.max(maxX, bounds.maxX + deltaX);
      maxY = Math.max(maxY, bounds.maxY + deltaY);
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
      return { dx: 0, dy: 0, guides: [] };
    }

    const movingAABB: AABB = {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
    };
    return this.calculateAABBSnap(movingAABB, new Set(initialShapesPositions.keys()));
  }

  public calculateAABBSnap(
    movingAABB: AABB,
    excludedShapeIds: ReadonlySet<string> = new Set(),
    fixedXFeature?: 0 | 2 | 'all',
    fixedYFeature?: 0 | 2 | 'all'
  ): { dx: number; dy: number; guides: SnapGuide[] } {
    if (!this.isSmartGuidesEnabled()) {
      return { dx: 0, dy: 0, guides: [] };
    }

    const targetAABBs: AABB[] = [];
    const document = this.stateManager.getState();
    if (document.width > 0 && document.height > 0) {
      targetAABBs.push({
        minX: 0,
        minY: 0,
        maxX: document.width,
        maxY: document.height,
        width: document.width,
        height: document.height,
      });
    }

    const visit = (nodes: readonly LayerChildNode[]): void => {
      for (const node of nodes) {
        if (!this.stateManager.isEffectivelyVisible(node.id)) continue;
        if (isGroup(node)) {
          visit(node.children);
        } else if (isShape(node) && !excludedShapeIds.has(node.id)) {
          targetAABBs.push(getShapeAABB(node));
        }
      }
    };
    for (const layer of document.children) {
      if (this.stateManager.isEffectivelyVisible(layer.id)) {
        visit(layer.children);
      }
    }

    const tolerance = 5 / this.getViewportManager().zoom;
    if (fixedXFeature !== undefined && fixedYFeature !== undefined) {
      return calculateAnchoredSnapping(
        movingAABB,
        targetAABBs,
        fixedXFeature,
        fixedYFeature,
        tolerance
      );
    }
    return calculateSnapping(movingAABB, targetAABBs, tolerance);
  }

  public calculateSnappedResizeDimensions(
    mouseX: number,
    mouseY: number,
    shiftKey: boolean,
    altKey: boolean = false
  ): ShapeDimensions | null {
    if (
      !this.resizingShapeId ||
      !this.resizeOrigin ||
      !this.activeResizeHandle ||
      !this.initialDimensions
    ) {
      return null;
    }

    const currentShape = this.stateManager.findNode(this.resizingShapeId);
    const isImageNode = currentShape?.type === 'image';
    const isTextNode = currentShape?.type === 'text';
    const preserveRatio = isImageNode || isTextNode ? true : shiftKey;

    const deltaX = mouseX - this.resizeOrigin.x;
    const deltaY = mouseY - this.resizeOrigin.y;
    const candidateDimensions = this.calculateResizedDimensions(
      this.initialDimensions,
      this.activeResizeHandle,
      deltaX,
      deltaY,
      preserveRatio,
      altKey
    );
    this.stateManager.updateShapeDimensions(this.resizingShapeId, candidateDimensions);

    if (altKey) {
      this.setActiveGuides([]);
      return candidateDimensions;
    }

    const candidateShape = this.stateManager.findNode(this.resizingShapeId);
    if (!candidateShape || !isShape(candidateShape)) {
      this.setActiveGuides([]);
      return candidateDimensions;
    }

    const handle = this.activeResizeHandle;
    const fixedXFeature: 0 | 2 | 'all' = handle.includes('right')
      ? 0
      : handle.includes('left') ? 2 : 'all';
    const fixedYFeature: 0 | 2 | 'all' = handle.includes('bottom')
      ? 0
      : handle.includes('top') ? 2 : 'all';
    const snap = this.calculateAABBSnap(
      getShapeAABB(candidateShape),
      new Set([this.resizingShapeId]),
      fixedXFeature,
      fixedYFeature
    );
    this.setActiveGuides(snap.guides);
    const finalDimensions = this.calculateResizedDimensions(
      this.initialDimensions,
      this.activeResizeHandle,
      deltaX + snap.dx,
      deltaY + snap.dy,
      preserveRatio,
      altKey
    );
    this.stateManager.updateShapeDimensions(this.resizingShapeId, finalDimensions);
    return finalDimensions;
  }

  public getShapeCentroid(shape: Shape): { x: number; y: number } {
    if (shape.type === 'rectangle' || shape.type === 'image') {
      return {
        x: shape.x + shape.width / 2,
        y: shape.y + shape.height / 2,
      };
    }
    if (shape.type === 'ellipse' || shape.type === 'polygon' || shape.type === 'star') {
      return {
        x: shape.x,
        y: shape.y,
      };
    }
    if (shape.type === 'path') {
      const aabb = getPathBaseAABB(shape);
      return {
        x: (aabb.minX + aabb.maxX) / 2,
        y: (aabb.minY + aabb.maxY) / 2,
      };
    }
    const aabb = getShapeAABB(shape);
    return {
      x: (aabb.minX + aabb.maxX) / 2,
      y: (aabb.minY + aabb.maxY) / 2,
    };
  }

  public getResizeCursor(handle: HandleType, rotation: number = 0): string {
    const handleAngles: Record<string, number> = {
      'top-left': 225,
      'top-right': 315,
      'bottom-right': 45,
      'bottom-left': 135,
      'right-center': 0,
    };
    const baseAngle = handleAngles[handle];
    if (baseAngle === undefined) return 'default';

    let totalAngle = (baseAngle + rotation) % 360;
    if (totalAngle < 0) totalAngle += 360;

    if ((totalAngle >= 337.5 || totalAngle < 22.5) || (totalAngle >= 157.5 && totalAngle < 202.5)) {
      return 'ew-resize';
    }
    if ((totalAngle >= 22.5 && totalAngle < 67.5) || (totalAngle >= 202.5 && totalAngle < 247.5)) {
      return 'nwse-resize';
    }
    if ((totalAngle >= 67.5 && totalAngle < 112.5) || (totalAngle >= 247.5 && totalAngle < 292.5)) {
      return 'ns-resize';
    }
    return 'nesw-resize';
  }

  public calculateResizedDimensions(
    initial: ShapeDimensions,
    handle: HandleType,
    dx: number,
    dy: number,
    preserveAspectRatio: boolean = false,
    fromCenter: boolean = false
  ): ShapeDimensions {
    const rotation = initial.rotation ?? 0;
    const rad = (rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const localDx = dx * cos + dy * sin;
    const localDy = -dx * sin + dy * cos;

    if (handle === 'right-center') {
      const initBoxW = initial.boxWidth !== undefined ? initial.boxWidth : (initial.width ?? 0);
      const newBoxWidth = Math.max(5, initBoxW + localDx);
      return {
        x: initial.x,
        y: initial.y,
        rotation,
        boxWidth: newBoxWidth,
      };
    }

    let dxSign = 1;
    let dySign = 1;
    switch (handle) {
      case 'bottom-right':
        dxSign = 1;
        dySign = 1;
        break;
      case 'bottom-left':
        dxSign = -1;
        dySign = 1;
        break;
      case 'top-right':
        dxSign = 1;
        dySign = -1;
        break;
      case 'top-left':
        dxSign = -1;
        dySign = -1;
        break;
    }

    // 1. Redimensionado exclusivo para nodos de tipo Text:
    // Escala proporcional a través de proyección diagonal continua,
    // fijando la esquina opuesta (o el centro del cuadro de texto con Alt).
    if (initial.fontSize !== undefined) {
      const initX = initial.x ?? 0;
      const initY = initial.y ?? 0;
      const initW = Math.max(1, initial.width ?? 1);
      const initH = Math.max(1, initial.height ?? 1);
      const bX = initial.baseX ?? initX;
      const bY = initial.baseY ?? initY;

      // Anclaje en espacio local sin rotar
      let uA: number;
      let vA: number;
      if (fromCenter) {
        uA = bX + initW / 2;
        vA = bY + initH / 2;
      } else {
        uA = dxSign > 0 ? bX : bX + initW;
        vA = dySign > 0 ? bY : bY + initH;
      }

      // Anclaje en coordenadas de mundo (rotado respecto al punto de origen de texto)
      const anchorWorldX = initX + (uA - initX) * cos - (vA - initY) * sin;
      const anchorWorldY = initY + (uA - initX) * sin + (vA - initY) * cos;

      // Progresión diagonal del escalado (producto punto del desplazamiento del cursor sobre la diagonal)
      const diagLenSq = initW * initW + initH * initH;
      const dot = dxSign * localDx * initW + dySign * localDy * initH;
      const deltaScale = (fromCenter ? 2 : 1) * (dot / diagLenSq);

      const rawScale = 1 + deltaScale;
      const minScale = Math.max(4 / Math.max(1, initial.fontSize), 5 / initW, 5 / initH);
      const scale = Math.max(minScale, rawScale);

      const newFontSize = Math.max(4, Math.round(initial.fontSize * scale));
      const effectiveScale = newFontSize / initial.fontSize;

      // Nueva posición (x, y) del nodo Text manteniendo invariante el punto de anclaje en coordenadas de mundo
      const newX = anchorWorldX + effectiveScale * (initX - anchorWorldX);
      const newY = anchorWorldY + effectiveScale * (initY - anchorWorldY);

      const newW = Math.max(5, initW * effectiveScale);
      const newH = Math.max(5, initH * effectiveScale);

      const result: ShapeDimensions = {
        x: newX,
        y: newY,
        width: newW,
        height: newH,
        fontSize: newFontSize,
        rotation,
        ...(initial.boxWidth !== undefined
          ? { boxWidth: Math.max(5, Math.round(initial.boxWidth * effectiveScale)) }
          : {}),
        ...(initial.lineHeight !== undefined
          ? { lineHeight: Math.max(1, Math.round(initial.lineHeight * effectiveScale)) }
          : {}),
        ...(initial.letterSpacing !== undefined
          ? { letterSpacing: Math.round(initial.letterSpacing * effectiveScale * 100) / 100 }
          : {}),
        ...(initial.baseX !== undefined
          ? { baseX: uA + effectiveScale * (bX - uA), baseY: vA + effectiveScale * (bY - vA) }
          : {}),
      };

      return result;
    }

    const computeSize = (
      initW: number,
      initH: number
    ): { newW: number; newH: number; scaleX: number; scaleY: number } => {
      const safeInitW = Math.max(1, initW);
      const safeInitH = Math.max(1, initH);
      const mult = fromCenter ? 2 : 1;

      if (!preserveAspectRatio) {
        const newW = Math.max(5, initW + mult * dxSign * localDx);
        const newH = Math.max(5, initH + mult * dySign * localDy);
        return {
          newW,
          newH,
          scaleX: newW / safeInitW,
          scaleY: newH / safeInitH,
        };
      }

      const rawNewW = initW + mult * dxSign * localDx;
      const rawNewH = initH + mult * dySign * localDy;

      let scale: number;
      if (initW < 1) {
        scale = rawNewH / safeInitH;
      } else if (initH < 1) {
        scale = rawNewW / safeInitW;
      } else {
        const sx = rawNewW / safeInitW;
        const sy = rawNewH / safeInitH;
        scale = Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy;
      }

      const minScale = Math.max(5 / safeInitW, 5 / safeInitH);
      scale = Math.max(minScale, scale);

      const newW = Math.max(5, initW * scale);
      const newH = Math.max(5, initH * scale);

      return {
        newW,
        newH,
        scaleX: scale,
        scaleY: scale,
      };
    };

    if (initial.points !== undefined && initial.points.length > 0) {
      const baseAABB = getPathBaseAABB(initial as Path);
      const minX = baseAABB.minX;
      const minY = baseAABB.minY;
      const maxX = baseAABB.maxX;
      const maxY = baseAABB.maxY;
      const initW = Math.max(1, baseAABB.width);
      const initH = Math.max(1, baseAABB.height);

      const { newW, newH, scaleX, scaleY } = computeSize(initW, initH);

      const anchorX = fromCenter ? (minX + maxX) / 2 : (dxSign > 0 ? minX : maxX);
      const anchorY = fromCenter ? (minY + maxY) / 2 : (dySign > 0 ? minY : maxY);

      const localShiftX = fromCenter ? 0 : (dxSign * (newW - initW)) / 2;
      const localShiftY = fromCenter ? 0 : (dySign * (newH - initH)) / 2;

      const tx = (localShiftX * cos - localShiftY * sin) - localShiftX;
      const ty = (localShiftX * sin + localShiftY * cos) - localShiftY;

      const scaleCoord = (pt: Vector2D): Vector2D => ({
        x: anchorX + (pt.x - anchorX) * scaleX + tx,
        y: anchorY + (pt.y - anchorY) * scaleY + ty,
      });

      const newPoints: PathPoint[] = initial.points.map((pt) => {
        const scaledMain = scaleCoord(pt);
        return {
          ...pt,
          x: scaledMain.x,
          y: scaledMain.y,
          handleIn: pt.handleIn ? scaleCoord(pt.handleIn) : undefined,
          handleOut: pt.handleOut ? scaleCoord(pt.handleOut) : undefined,
        };
      });

      return {
        x: newPoints[0]?.x ?? initial.x ?? 0,
        y: newPoints[0]?.y ?? initial.y ?? 0,
        width: newW,
        height: newH,
        points: newPoints,
        rotation,
      };
    }

    if (initial.width !== undefined && initial.height !== undefined) {
      const initX = initial.x ?? 0;
      const initY = initial.y ?? 0;
      const initW = initial.width;
      const initH = initial.height;

      const { newW, newH } = computeSize(initW, initH);

      const localShiftX = fromCenter ? 0 : (dxSign * (newW - initW)) / 2;
      const localShiftY = fromCenter ? 0 : (dySign * (newH - initH)) / 2;

      const initCenterX = initX + initW / 2;
      const initCenterY = initY + initH / 2;

      const newCenterX = initCenterX + localShiftX * cos - localShiftY * sin;
      const newCenterY = initCenterY + localShiftX * sin + localShiftY * cos;

      return {
        x: newCenterX - newW / 2,
        y: newCenterY - newH / 2,
        width: newW,
        height: newH,
        rotation,
      };
    }

    if (initial.radiusX !== undefined && initial.radiusY !== undefined) {
      const initCenterX = initial.x ?? 0;
      const initCenterY = initial.y ?? 0;
      const initRx = initial.radiusX;
      const initRy = initial.radiusY;

      const initW = initRx * 2;
      const initH = initRy * 2;

      const { newW, newH } = computeSize(initW, initH);

      const localShiftX = fromCenter ? 0 : (dxSign * (newW - initW)) / 2;
      const localShiftY = fromCenter ? 0 : (dySign * (newH - initH)) / 2;

      const newRx = newW / 2;
      const newRy = newH / 2;

      const newCenterX = initCenterX + localShiftX * cos - localShiftY * sin;
      const newCenterY = initCenterY + localShiftX * sin + localShiftY * cos;

      return {
        x: newCenterX,
        y: newCenterY,
        radiusX: newRx,
        radiusY: newRy,
        rotation,
      };
    }

    if (initial.radius !== undefined) {
      const initCenterX = initial.x ?? 0;
      const initCenterY = initial.y ?? 0;
      const initR = initial.radius;
      const initSize = initR * 2;
      const { newW, newH } = computeSize(initSize, initSize);
      const newR = Math.max(2, Math.min(newW, newH) / 2);

      const localShiftX = fromCenter ? 0 : (dxSign * (newR * 2 - initSize)) / 2;
      const localShiftY = fromCenter ? 0 : (dySign * (newR * 2 - initSize)) / 2;

      const newCenterX = initCenterX + localShiftX * cos - localShiftY * sin;
      const newCenterY = initCenterY + localShiftX * sin + localShiftY * cos;

      return {
        x: newCenterX,
        y: newCenterY,
        radius: newR,
        sides: initial.sides,
        rotation,
      };
    }

    if (initial.outerRadius !== undefined && initial.innerRadius !== undefined) {
      const initCenterX = initial.x ?? 0;
      const initCenterY = initial.y ?? 0;
      const initOuter = initial.outerRadius;
      const initSize = initOuter * 2;
      const { newW, newH } = computeSize(initSize, initSize);
      const newOuter = Math.max(2, Math.min(newW, newH) / 2);
      const ratio = initOuter > 0 ? initial.innerRadius / initOuter : 0.5;
      const newInner = Math.max(1, newOuter * ratio);

      const localShiftX = fromCenter ? 0 : (dxSign * (newOuter * 2 - initSize)) / 2;
      const localShiftY = fromCenter ? 0 : (dySign * (newOuter * 2 - initSize)) / 2;

      const newCenterX = initCenterX + localShiftX * cos - localShiftY * sin;
      const newCenterY = initCenterY + localShiftX * sin + localShiftY * cos;

      return {
        x: newCenterX,
        y: newCenterY,
        outerRadius: newOuter,
        innerRadius: newInner,
        starPoints: initial.starPoints,
        rotation,
      };
    }

    return initial;
  }

  public hasDimensionsChanged(a: ShapeDimensions, b: ShapeDimensions): boolean {
    if (a.points && b.points) {
      if (a.points.length !== b.points.length) return true;
      for (let i = 0; i < a.points.length; i++) {
        const p = a.points[i];
        const n = b.points[i];
        if (p.x !== n.x || p.y !== n.y) return true;
        if (p.handleIn?.x !== n.handleIn?.x || p.handleIn?.y !== n.handleIn?.y) return true;
        if (p.handleOut?.x !== n.handleOut?.x || p.handleOut?.y !== n.handleOut?.y) return true;
      }
      return false;
    }
    return (
      a.x !== b.x ||
      a.y !== b.y ||
      a.width !== b.width ||
      a.height !== b.height ||
      a.radiusX !== b.radiusX ||
      a.radiusY !== b.radiusY ||
      a.fontSize !== b.fontSize ||
      a.lineHeight !== b.lineHeight ||
      a.letterSpacing !== b.letterSpacing ||
      a.rotation !== b.rotation ||
      a.boxWidth !== b.boxWidth ||
      a.cornerRadius !== b.cornerRadius ||
      a.radius !== b.radius ||
      a.sides !== b.sides ||
      a.outerRadius !== b.outerRadius ||
      a.innerRadius !== b.innerRadius ||
      a.starPoints !== b.starPoints
    );
  }

  public destroy(): void {
    this.resetDrag();
    this.resetResize();
    this.resetRotate();
  }
}
