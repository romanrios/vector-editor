import type { StateManager } from '../../state/StateManager.ts';
import { getLeafShapes } from '../../state/StateManager.ts';
import type { CommandManager } from '../../commands/CommandManager.ts';
import type { SnapGuide } from '../../types/engine.ts';
import {
  isGroup,
  isShape,
  isGradient,
  type AABB,
  type Guide,
  type SelectableNode,
  type Shape,
  type Vector2D,
} from '../../types/scene-graph.ts';
import {
  computeBoxScale,
  getSelectionBounds,
  getSelectionBoxHandles,
  getSelectionHandles,
  isPointInAABB,
  type HandleType,
} from '../../utils/geometry.ts';
import type { ViewportManager } from '../../utils/viewport.ts';
import type { SelectionOperations } from '../SelectionOperations.ts';
import type { ToolHandler } from './ToolHandler.ts';
import type { ShapePreview, ToolMode } from '../InputController.ts';
import type { ShapeDimensions } from '../../commands/ResizeCommand.ts';

import type { MultiTransformState, SelectToolHandlerOptions } from './select/types.ts';
import {
  getShapeCentroid,
  getResizeCursor,
  calculateResizedDimensions,
  hasDimensionsChanged,
} from './select/resizeGeometry.ts';
import { calculateAABBSnap } from './select/snapGuides.ts';
import { MarqueeSelectionHandler } from './select/MarqueeSelectionHandler.ts';
import { DragMoveHandler } from './select/DragMoveHandler.ts';
import { ResizeHandler } from './select/ResizeHandler.ts';
import { RotateHandler } from './select/RotateHandler.ts';
import { MultiTransformHandler } from './select/MultiTransformHandler.ts';
import { OverlayInteractionsHandler } from './select/OverlayInteractionsHandler.ts';
import { hitTestGradientHandles } from '../../utils/gradient.ts';
import {
  getShapeCornerRadiusHandles,
  hitTestCornerRadiusHandle,
} from '../../utils/cornerSmoothing.ts';

export type { MultiTransformState, SelectToolHandlerOptions } from './select/types.ts';

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

  private readonly marqueeHandler: MarqueeSelectionHandler;
  private readonly dragMoveHandler: DragMoveHandler;
  private readonly resizeHandler: ResizeHandler;
  private readonly rotateHandler: RotateHandler;
  private readonly multiTransformHandler: MultiTransformHandler;
  private readonly overlayHandler: OverlayInteractionsHandler;

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

    const getZoom = (): number => this.getViewportManager().zoom;
    const isTouch = (): boolean => this.options.isTouch?.() ?? false;
    const getCtx = (): CanvasRenderingContext2D | null =>
      typeof this.canvas.getContext === 'function' ? this.canvas.getContext('2d') : null;

    this.marqueeHandler = new MarqueeSelectionHandler(
      this.stateManager,
      this.getScreenCoordinates,
      this.options
    );

    this.dragMoveHandler = new DragMoveHandler(
      this.stateManager,
      this.commandManager,
      this.selectionOperations,
      this.getScreenCoordinates,
      getZoom,
      this.isSmartGuidesEnabled,
      this.setActiveGuides
    );

    this.resizeHandler = new ResizeHandler(
      this.stateManager,
      this.commandManager,
      getZoom,
      this.isSmartGuidesEnabled,
      this.setActiveGuides,
      getCtx
    );

    this.rotateHandler = new RotateHandler(
      this.stateManager,
      this.commandManager
    );

    this.multiTransformHandler = new MultiTransformHandler(
      this.stateManager,
      this.commandManager,
      getZoom,
      this.isSmartGuidesEnabled,
      this.setActiveGuides
    );

    this.overlayHandler = new OverlayInteractionsHandler(
      this.stateManager,
      this.commandManager,
      getZoom,
      isTouch,
      this.getScreenCoordinates
    );
  }

  private get isTouch(): boolean {
    return this.options.isTouch?.() ?? false;
  }

  public get activeGuideDrag(): Guide | null {
    return this.overlayHandler.activeGuideDrag;
  }

  public get hoveredGuide(): Guide | null {
    return this.overlayHandler.hoveredGuide;
  }

  public get isDragging(): boolean {
    return this.dragMoveHandler.isDragging;
  }

  public get isCopyDragging(): boolean {
    return this.dragMoveHandler.isCopyDragging;
  }

  public get isMarqueeSelecting(): boolean {
    return this.marqueeHandler.isMarqueeSelecting;
  }

  public get shapePreview(): ShapePreview | null {
    return this.marqueeHandler.shapePreview;
  }

  public get isResizing(): boolean {
    return this.resizeHandler.isResizing;
  }

  public get resizeOriginPoint(): { x: number; y: number } | null {
    return this.resizeHandler.resizeOriginPoint;
  }

  public get currentResizeHandle(): HandleType | null {
    return this.resizeHandler.currentResizeHandle;
  }

  public get resizingNodeId(): string | null {
    return this.resizeHandler.resizingNodeId;
  }

  public get initialResizeDimensions(): ShapeDimensions | null {
    return this.resizeHandler.initialResizeDimensions;
  }

  public get lastResizeMousePos(): { x: number; y: number } | null {
    return this.resizeHandler.lastResizeMousePos;
  }

  public get isRotating(): boolean {
    return this.rotateHandler.isRotating;
  }

  public get rotatingNodeId(): string | null {
    return this.rotateHandler.rotatingNodeId;
  }

  public get initialRotateAngle(): number | null {
    return this.rotateHandler.initialRotateAngle;
  }

  public get isMultiTransforming(): boolean {
    return this.multiTransformHandler.isMultiTransforming;
  }

  public get multiTransformState(): MultiTransformState | null {
    return this.multiTransformHandler.multiTransformState;
  }

  public get hoveredShapeId(): string | null {
    return this._hoveredShapeId;
  }

  public onActivate(): void {
    this.canvas.style.cursor = 'default';
  }

  public onDeactivate(_nextTool?: ToolMode): void {
    if (this.marqueeHandler.isMarqueeSelecting) {
      this.marqueeHandler.cancel();
    }
    if (this.rotateHandler.isRotating) {
      this.rotateHandler.finish();
    }
    if (this.resizeHandler.isResizing) {
      this.resizeHandler.reset();
    }
    this.overlayHandler.reset();
    this.dragMoveHandler.reset();
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
        const handleScreenSize = this.isTouch ? 22 : 8;
        const rotationDistance = this.isTouch ? 36 : 30;
        const handles = getSelectionBoxHandles(bounds, handleScreenSize / zoom, rotationDistance / zoom, true);
        const hitHandle = handles.find((handle) => isPointInAABB(x, y, handle));

        if (hitHandle) {
          const leafShapes = getLeafShapes(selectedNodes);
          if (hitHandle.type === 'rotation-handle') {
            this.multiTransformHandler.startRotate(coords, bounds, leafShapes);
            this.canvas.style.cursor = 'crosshair';
            return;
          } else {
            const { anchor } = computeBoxScale(bounds, hitHandle.type, 0, 0, false);
            this.multiTransformHandler.startScale(coords, bounds, leafShapes, hitHandle.type, anchor);
            this.canvas.style.cursor = this.getResizeCursor(hitHandle.type, 0);
            return;
          }
        }
      }
    } else if (selectedNodes.length === 1) {
      const selectedNode = this.stateManager.getSelectedNode();
      if (selectedNode && isShape(selectedNode)) {
        // Comprobar manipulación interactiva de degradados
        if (this.overlayHandler.tryStartGradient(coords, selectedNode)) {
          this.dragMoveHandler.reset();
          this.resizeHandler.reset();
          this.rotateHandler.reset();
          this.canvas.style.cursor = 'crosshair';
          return;
        }

        const zoom = this.getViewportManager().zoom;
        const handleScreenSize = this.isTouch ? 22 : 8;
        const rotationDistance = this.isTouch ? 36 : 30;
        const handles = getSelectionHandles(selectedNode, handleScreenSize / zoom, rotationDistance / zoom, true);
        const hitHandle = handles.find((handle) => isPointInAABB(x, y, handle));

        if (hitHandle) {
          if (hitHandle.type === 'rotation-handle') {
            this.rotateHandler.start(coords, selectedNode);
            this.resizeHandler.reset();
            this.dragMoveHandler.reset();
            this.canvas.style.cursor = 'crosshair';
            return;
          }

          this.resizeHandler.start(coords, event, selectedNode, hitHandle.type);
          this.dragMoveHandler.reset();
          this.rotateHandler.reset();
          this.canvas.style.cursor = this.getResizeCursor(hitHandle.type, selectedNode.rotation ?? 0);
          return;
        }

        // Comprobar si se hizo clic sobre un tirador de radio de esquina (Corner Radius Handle)
        if (this.overlayHandler.tryStartCornerRadius(coords, selectedNode)) {
          this.dragMoveHandler.reset();
          this.resizeHandler.reset();
          this.rotateHandler.reset();
          this.canvas.style.cursor = 'crosshair';
          return;
        }
      }
    }

    // 1.5. Comprobar si se hizo clic sobre una guía de usuario
    const hitGuide = this.overlayHandler.tryStartGuide(coords, event);
    if (hitGuide) {
      this.dragMoveHandler.reset();
      this.resizeHandler.reset();
      this.rotateHandler.reset();
      this.canvas.style.cursor = hitGuide.axis === 'x' ? 'col-resize' : 'row-resize';
      return;
    }

    // 2. Si no hubo colisión con los manejadores, evaluar colisiones con figuras mediante hitTest
    const hitShape = this.hitTest(x, y);

    if (hitShape) {
      if (this.marqueeHandler.isMarqueeSelecting) {
        this.marqueeHandler.cancel();
      }

      this.resizeHandler.reset();
      this.rotateHandler.reset();
      this.dragMoveHandler.start(coords, event, hitShape, this.resolveNodeToSelect);

      if (!event.shiftKey) {
        this.canvas.style.cursor = 'grabbing';
      }
      return;
    }

    // 3. Clic sobre el vacío: Prepara el rectángulo de selección marquesina.
    this.dragMoveHandler.reset();
    this.resizeHandler.reset();
    this.rotateHandler.reset();
    this.marqueeHandler.start(coords, event);
  }

  public onMouseMove(event: MouseEvent, coords: Vector2D): void {
    const { x, y } = coords;

    if (this.overlayHandler.isDraggingGuide) {
      this.overlayHandler.update(coords);
      const guide = this.overlayHandler.activeGuideDrag;
      this.canvas.style.cursor = guide?.axis === 'x' ? 'col-resize' : 'row-resize';
      return;
    }

    if (this.overlayHandler.isDraggingCornerRadius || this.overlayHandler.isDraggingGradient) {
      this.overlayHandler.update(coords);
      this.canvas.style.cursor = 'crosshair';
      return;
    }

    if (this.multiTransformHandler.isMultiTransforming) {
      this.multiTransformHandler.update(coords, event);
      const state = this.multiTransformHandler.multiTransformState;
      if (state?.type === 'rotate') {
        this.canvas.style.cursor = 'crosshair';
      } else if (state?.handle) {
        this.canvas.style.cursor = this.getResizeCursor(state.handle, 0);
      }
      return;
    }

    if (this.rotateHandler.isRotating) {
      this.rotateHandler.update(coords, event);
      this.canvas.style.cursor = 'crosshair';
      return;
    }

    if (this.marqueeHandler.isMarqueeSelecting) {
      this.marqueeHandler.update(coords, event);
      this.canvas.style.cursor = 'default';
      return;
    }

    if (this.dragMoveHandler.isDragging) {
      this.dragMoveHandler.update(coords, event);
      this.canvas.style.cursor = this.dragMoveHandler.isCopyDragging ? 'copy' : 'grabbing';
      return;
    }

    if (this.resizeHandler.isResizing) {
      this.resizeHandler.update(coords, event);
      const currentShape = this.stateManager.findNode(this.resizeHandler.resizingNodeId ?? '') as Shape | null;
      const handle = this.resizeHandler.currentResizeHandle;
      if (handle) {
        this.canvas.style.cursor = this.getResizeCursor(
          handle,
          currentShape?.rotation ?? this.resizeHandler.initialResizeDimensions?.rotation ?? 0
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
        const handleScreenSize = this.isTouch ? 22 : 8;
        const rotationDistance = this.isTouch ? 36 : 30;
        const handles = getSelectionBoxHandles(bounds, handleScreenSize / zoom, rotationDistance / zoom, true);
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
          const gradTolerance = (this.isTouch ? 20 : 10) / zoom;
          const hitGrad = hitTestGradientHandles(selectedShape, grad, x, y, gradTolerance);
          if (hitGrad) {
            this.canvas.style.cursor = 'crosshair';
            return;
          }
        }

        const handleScreenSize = this.isTouch ? 22 : 8;
        const rotationDistance = this.isTouch ? 36 : 30;
        const handles = getSelectionHandles(selectedShape, handleScreenSize / zoom, rotationDistance / zoom, true);
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

    const currentZoom = this.getViewportManager().zoom;
    const hitGuide = this.overlayHandler.hitTestGuide(x, y, 6 / currentZoom);
    this.overlayHandler.hoveredGuide = hitGuide;
    if (hitGuide && !this.dragMoveHandler.isDragging && !this.resizeHandler.isResizing && !this.rotateHandler.isRotating && !this.marqueeHandler.isMarqueeSelecting) {
      this.canvas.style.cursor = hitGuide.axis === 'x' ? 'col-resize' : 'row-resize';
      return;
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

    if (this.overlayHandler.isDraggingGuide || this.overlayHandler.isDraggingCornerRadius || this.overlayHandler.isDraggingGradient) {
      this.overlayHandler.finish(coords, event);
      const hitShape = this.hitTest(x, y);
      this.canvas.style.cursor = hitShape ? (this.stateManager.isSelected(hitShape.id) ? 'move' : 'pointer') : 'default';
      return;
    }

    if (this.multiTransformHandler.isMultiTransforming) {
      this.multiTransformHandler.finish();
      const hitShape = this.hitTest(x, y);
      this.canvas.style.cursor = hitShape ? (this.stateManager.isSelected(hitShape.id) ? 'move' : 'pointer') : 'default';
      return;
    }

    if (this.rotateHandler.isRotating) {
      this.rotateHandler.finish();
      const hitShape = this.hitTest(x, y);
      this.canvas.style.cursor = hitShape ? (this.stateManager.isSelected(hitShape.id) ? 'move' : 'pointer') : 'default';
      return;
    }

    if (this.resizeHandler.isResizing) {
      this.resizeHandler.finish(coords, event);
      const hitShape = this.hitTest(x, y);
      this.canvas.style.cursor = hitShape ? (this.stateManager.isSelected(hitShape.id) ? 'move' : 'pointer') : 'default';
      return;
    }

    if (this.marqueeHandler.isMarqueeSelecting) {
      this.marqueeHandler.finish(event);
      const hitShape = this.hitTest(x, y);
      this.canvas.style.cursor = hitShape ? (this.stateManager.isSelected(hitShape.id) ? 'move' : 'pointer') : 'default';
      return;
    }

    if (this.dragMoveHandler.isDragging) {
      this.dragMoveHandler.finish(coords, event);
      const hitShape = this.hitTest(x, y);
      this.canvas.style.cursor = hitShape ? (this.stateManager.isSelected(hitShape.id) ? 'move' : 'pointer') : 'default';
      return;
    }

    this.dragMoveHandler.reset();
    const hitShape = this.hitTest(x, y);
    this.canvas.style.cursor = hitShape ? (this.stateManager.isSelected(hitShape.id) ? 'move' : 'pointer') : 'default';
  }

  public cancelMarquee(): void {
    this.marqueeHandler.cancel();
  }

  public resetDrag(): void {
    this.dragMoveHandler.reset();
  }

  public resetResize(): void {
    this.resizeHandler.reset();
  }

  public resetRotate(): void {
    this.rotateHandler.reset();
  }

  public resetMultiTransform(): void {
    this.multiTransformHandler.reset();
  }

  public handleShiftToggle(shiftKey: boolean): void {
    if (this.multiTransformHandler.handleShiftToggle(shiftKey)) {
      return;
    }

    if (this.resizeHandler.isResizing) {
      const lastPos = this.resizeHandler.lastResizeMousePos;
      if (lastPos) {
        this.resizeHandler.calculateSnappedResizeDimensions(lastPos.x, lastPos.y, shiftKey);
      }
    }
  }

  public handleAltToggle(altKey: boolean): void {
    if (this.multiTransformHandler.handleAltToggle(altKey)) {
      return;
    }

    if (this.dragMoveHandler.isDragging) {
      this.dragMoveHandler.syncCopyDragMode(altKey);
      this.canvas.style.cursor = altKey ? 'copy' : 'grabbing';
      return;
    }

    if (this.resizeHandler.isResizing) {
      const lastPos = this.resizeHandler.lastResizeMousePos;
      if (lastPos) {
        this.resizeHandler.calculateSnappedResizeDimensions(lastPos.x, lastPos.y, false, altKey);
      }
    }
  }

  public handleEscape(): boolean {
    if (this.dragMoveHandler.handleEscape()) {
      this.canvas.style.cursor = 'default';
      return true;
    }

    if (this.marqueeHandler.isMarqueeSelecting) {
      this.marqueeHandler.cancel();
      this.canvas.style.cursor = 'default';
      return true;
    }

    if (this.multiTransformHandler.handleEscape()) {
      this.canvas.style.cursor = 'default';
      return true;
    }

    if (this.rotateHandler.handleEscape()) {
      this.canvas.style.cursor = 'default';
      return true;
    }

    if (this.resizeHandler.handleEscape()) {
      this.canvas.style.cursor = 'default';
      return true;
    }

    return false;
  }

  public syncCopyDragMode(altKey: boolean): void {
    this.dragMoveHandler.syncCopyDragMode(altKey);
  }

  public applyMultiTransform(x: number, y: number, shiftKey: boolean, altKey: boolean = false): void {
    this.multiTransformHandler.apply(x, y, shiftKey, altKey);
  }

  public calculateDragSnap(deltaX: number, deltaY: number): { dx: number; dy: number; guides: SnapGuide[] } {
    return this.dragMoveHandler.calculateDragSnap(deltaX, deltaY);
  }

  public calculateAABBSnap(
    movingAABB: AABB,
    excludedShapeIds: ReadonlySet<string> = new Set(),
    fixedXFeature?: 0 | 2 | 'all',
    fixedYFeature?: 0 | 2 | 'all'
  ): { dx: number; dy: number; guides: SnapGuide[] } {
    return calculateAABBSnap(
      this.stateManager,
      this.getViewportManager().zoom,
      this.isSmartGuidesEnabled(),
      movingAABB,
      excludedShapeIds,
      fixedXFeature,
      fixedYFeature
    );
  }

  public calculateSnappedResizeDimensions(
    mouseX: number,
    mouseY: number,
    shiftKey: boolean,
    altKey: boolean = false
  ): ShapeDimensions | null {
    return this.resizeHandler.calculateSnappedResizeDimensions(mouseX, mouseY, shiftKey, altKey);
  }

  public getShapeCentroid(shape: Shape): { x: number; y: number } {
    return getShapeCentroid(shape);
  }

  public getResizeCursor(handle: HandleType, rotation: number = 0): string {
    return getResizeCursor(handle, rotation);
  }

  public calculateResizedDimensions(
    initial: ShapeDimensions,
    handle: HandleType,
    dx: number,
    dy: number,
    preserveAspectRatio: boolean = false,
    fromCenter: boolean = false
  ): ShapeDimensions {
    return calculateResizedDimensions(initial, handle, dx, dy, preserveAspectRatio, fromCenter);
  }

  public hasDimensionsChanged(a: ShapeDimensions, b: ShapeDimensions): boolean {
    return hasDimensionsChanged(a, b);
  }

  public hitTestGuide(x: number, y: number, tolerance: number): Guide | null {
    return this.overlayHandler.hitTestGuide(x, y, tolerance);
  }

  public deleteHoveredGuide(): boolean {
    return this.overlayHandler.deleteHoveredGuide();
  }

  public destroy(): void {
    this.dragMoveHandler.reset();
    this.resizeHandler.reset();
    this.rotateHandler.reset();
  }
}
