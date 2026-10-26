import type { StateManager } from '../../state/StateManager.ts';
import { getLeafShapes } from '../../state/StateManager.ts';
import type { CommandManager } from '../../commands/CommandManager.ts';
import { TransformShapesCommand, type ShapeTransformEntry } from '../../commands/TransformShapesCommand.ts';
import { BatchCommand } from '../../commands/BatchCommand.ts';
import type { ShapeDimensions } from '../../commands/ResizeCommand.ts';
import type {
  Rectangle,
  Polygon,
  Star,
  Path,
  SelectableNode,
  Shape,
  AABB,
} from '../../types/scene-graph.ts';
import { getSelectionBounds, normalizeAngle } from '../../utils/geometry.ts';
import { getShapeDimensions, rotateShapesAboutPivot } from '../../utils/transform.ts';
import type { PropertiesPanelElements } from './types.ts';

export class TransformSectionController {
  private initialCornerRadiusSnapshots: Map<string, number> | null = null;
  private editingNodeIds: readonly string[] | null = null;
  private readonly roundToFourDecimals = (value: number): number => Number(value.toFixed(4));

  private readonly stateManager: StateManager;
  private readonly commandManager: CommandManager;
  private readonly elements: PropertiesPanelElements;
  private readonly syncPropertiesPanel: () => void;

  constructor(
    stateManager: StateManager,
    commandManager: CommandManager,
    elements: PropertiesPanelElements,
    syncPropertiesPanel: () => void
  ) {
    this.stateManager = stateManager;
    this.commandManager = commandManager;
    this.elements = elements;
    this.syncPropertiesPanel = syncPropertiesPanel;
  }


  public captureInitialCornerRadius(): void {
    const selectedNodes = this.stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes);
    const cornerShapes = leafShapes.filter((s): s is Rectangle | Polygon | Star | Path =>
      s.type === 'rectangle' || s.type === 'polygon' || s.type === 'star' || s.type === 'path'
    );
    if (cornerShapes.length > 0) {
      this.initialCornerRadiusSnapshots = new Map(cornerShapes.map((r) => [r.id, r.cornerRadius ?? 0]));
      this.editingNodeIds = cornerShapes.map((r) => r.id);
    } else {
      this.initialCornerRadiusSnapshots = null;
      this.editingNodeIds = null;
    }
  }

  public clearSnapshot(): void {
    this.initialCornerRadiusSnapshots = null;
    this.editingNodeIds = null;
  }


  public applyObjectGeometry(property: 'x' | 'y' | 'width' | 'height', input: HTMLInputElement): void {
    const parsedValue = Number(input.value);
    const value = Number.isFinite(parsedValue) ? this.roundToFourDecimals(parsedValue) : parsedValue;
    if (!Number.isFinite(value) || ((property === 'width' || property === 'height') && value <= 0)) {
      this.syncPropertiesPanel();
      return;
    }

    const selectedNodes = this.stateManager.getSelectedNodes();
    if (this.editingNodeIds) {
      if (
        selectedNodes.length !== this.editingNodeIds.length ||
        !selectedNodes.every((n) => this.editingNodeIds!.includes(n.id))
      ) {
        this.clearSnapshot();
        this.syncPropertiesPanel();
        return;
      }
    }
    const leafShapes = getLeafShapes(selectedNodes);
    const bounds = getSelectionBounds(selectedNodes);
    if (leafShapes.length === 0 || !bounds) return;

    let targetMinX = bounds.minX;
    let targetMinY = bounds.minY;
    let targetWidth = bounds.width;
    let targetHeight = bounds.height;
    if (property === 'x') targetMinX = value;
    if (property === 'y') targetMinY = value;
    if (property === 'width') targetWidth = value;
    if (property === 'height') targetHeight = value;

    const scaleX = targetWidth / Math.max(bounds.width, 0.1);
    const scaleY = targetHeight / Math.max(bounds.height, 0.1);
    const mapX = (x: number) => this.roundToFourDecimals(targetMinX + (x - bounds.minX) * scaleX);
    const mapY = (y: number) => this.roundToFourDecimals(targetMinY + (y - bounds.minY) * scaleY);
    const textScale = scaleX === 1
      ? scaleY
      : scaleY === 1
      ? scaleX
      : Math.sqrt(scaleX * scaleY);

    const entries = leafShapes.map((shape) => {
      const positionBefore: ShapeDimensions = {
        x: shape.x,
        y: shape.y,
        ...(shape.rotation !== undefined ? { rotation: shape.rotation } : {}),
      };
      const positionAfter: ShapeDimensions = {
        x: mapX(shape.x),
        y: mapY(shape.y),
        ...(shape.rotation !== undefined ? { rotation: shape.rotation } : {}),
      };
      let before: ShapeDimensions;
      let after: ShapeDimensions;

      if (shape.type === 'rectangle' || shape.type === 'image') {
        before = { ...positionBefore, width: shape.width, height: shape.height };
        after = {
          ...positionAfter,
          width: this.roundToFourDecimals(shape.width * scaleX),
          height: this.roundToFourDecimals(shape.height * scaleY),
        };
      } else if (shape.type === 'ellipse') {
        before = { ...positionBefore, radiusX: shape.radiusX, radiusY: shape.radiusY };
        after = {
          ...positionAfter,
          radiusX: this.roundToFourDecimals(shape.radiusX * scaleX),
          radiusY: this.roundToFourDecimals(shape.radiusY * scaleY),
        };
      } else if (shape.type === 'path') {
        before = { ...positionBefore, points: shape.points };
        after = {
          ...positionAfter,
          points: shape.points.map((point) => ({
            x: mapX(point.x),
            y: mapY(point.y),
            ...(point.handleIn ? { handleIn: { x: mapX(point.handleIn.x), y: mapY(point.handleIn.y) } } : {}),
            ...(point.handleOut ? { handleOut: { x: mapX(point.handleOut.x), y: mapY(point.handleOut.y) } } : {}),
          })),
        };
      } else if (shape.type === 'polygon') {
        const radiusScale = Math.sqrt(scaleX * scaleY);
        before = { ...positionBefore, radius: shape.radius, sides: shape.sides };
        after = {
          ...positionAfter,
          radius: Math.max(1, this.roundToFourDecimals(shape.radius * radiusScale)),
          sides: shape.sides,
        };
      } else if (shape.type === 'star') {
        const radiusScale = Math.sqrt(scaleX * scaleY);
        before = {
          ...positionBefore,
          outerRadius: shape.outerRadius,
          innerRadius: shape.innerRadius,
          starPoints: shape.points,
        };
        after = {
          ...positionAfter,
          outerRadius: Math.max(1, this.roundToFourDecimals(shape.outerRadius * radiusScale)),
          innerRadius: Math.max(0.5, this.roundToFourDecimals(shape.innerRadius * radiusScale)),
          starPoints: shape.points,
        };
      } else {
        const fontSize = shape.fontSize ?? 16;
        before = {
          ...positionBefore,
          fontSize,
          ...(shape.lineHeight !== undefined ? { lineHeight: shape.lineHeight } : {}),
        };
        after = {
          ...positionAfter,
          fontSize: Math.max(1, this.roundToFourDecimals(fontSize * textScale)),
          ...(shape.lineHeight !== undefined ? { lineHeight: this.roundToFourDecimals(shape.lineHeight * scaleY) } : {}),
        };
      }

      return { id: shape.id, before, after };
    });

    const transformCommand = new TransformShapesCommand(this.stateManager, entries);
    const command = leafShapes.length > 1
      ? new BatchCommand([transformCommand], 'Transform Selection')
      : transformCommand;
    command.execute();
    this.commandManager.recordCommand(command);
    this.clearSnapshot();
  }

  private onTransformFocus = () => {
    this.editingNodeIds = this.stateManager.getSelectedNodes().map((n) => n.id);
  };

  private onObjectXChange = () => this.elements.inputObjectX && this.applyObjectGeometry('x', this.elements.inputObjectX);
  private onObjectYChange = () => this.elements.inputObjectY && this.applyObjectGeometry('y', this.elements.inputObjectY);
  private onObjectWidthChange = () => this.elements.inputObjectWidth && this.applyObjectGeometry('width', this.elements.inputObjectWidth);
  private onObjectHeightChange = () => this.elements.inputObjectHeight && this.applyObjectGeometry('height', this.elements.inputObjectHeight);
  private onObjectGeometryBlur = () => this.syncPropertiesPanel();

  private onObjectRotationChange = () => {
    if (!this.elements.inputObjectRotation) return;
    const parsedRotation = Number(this.elements.inputObjectRotation.value);
    const targetRotation = Number.isFinite(parsedRotation) ? this.roundToFourDecimals(parsedRotation) : parsedRotation;
    const selectedNodes = this.stateManager.getSelectedNodes();
    if (this.editingNodeIds) {
      if (
        selectedNodes.length !== this.editingNodeIds.length ||
        !selectedNodes.every((n) => this.editingNodeIds!.includes(n.id))
      ) {
        this.clearSnapshot();
        this.syncPropertiesPanel();
        return;
      }
    }
    const leafShapes = getLeafShapes(selectedNodes);
    const bounds = getSelectionBounds(selectedNodes);
    if (!Number.isFinite(targetRotation) || leafShapes.length === 0 || !bounds) {
      this.syncPropertiesPanel();
      return;
    }

    const delta = normalizeAngle(targetRotation - (leafShapes[0].rotation ?? 0));
    const pivot = {
      x: bounds.minX + bounds.width / 2,
      y: bounds.minY + bounds.height / 2,
    };
    const rotatedEntries = rotateShapesAboutPivot(leafShapes, pivot, delta);
    if (rotatedEntries.length === 0) return;

    const shapesById = new Map(leafShapes.map((shape) => [shape.id, shape]));
    const entries = rotatedEntries.map((entry) => {
      const shape = shapesById.get(entry.id);
      if (!shape) {
        throw new Error(`No se encontró la figura ${entry.id} para registrar la rotación.`);
      }
      return {
        id: entry.id,
        before: getShapeDimensions(shape),
        after: entry.dimensions,
      };
    });
    const transformCommand = new TransformShapesCommand(this.stateManager, entries);
    const command = leafShapes.length > 1
      ? new BatchCommand([transformCommand], 'Rotate Selection')
      : transformCommand;
    command.execute();
    this.commandManager.recordCommand(command);
    this.clearSnapshot();
  };

  private onCornerRadiusFocus = () => {
    this.captureInitialCornerRadius();
  };

  private onCornerRadiusInput = () => {
    if (!this.elements.inputCornerRadius) return;
    const parsed = parseFloat(this.elements.inputCornerRadius.value);
    if (isNaN(parsed) || parsed < 0) return;
    const selectedNodes = this.stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes);
    const cornerShapes = leafShapes.filter((s): s is Rectangle | Polygon | Star | Path =>
      s.type === 'rectangle' || s.type === 'polygon' || s.type === 'star' || s.type === 'path'
    );
    if (cornerShapes.length === 0) return;

    if (!this.initialCornerRadiusSnapshots) {
      this.captureInitialCornerRadius();
    }

    const targetRadius = Math.max(0, parsed);
    this.stateManager.updateShapesDimensions(
      cornerShapes.map((r) => ({
        id: r.id,
        dimensions: { cornerRadius: targetRadius },
      }))
    );
  };

  private onCornerRadiusChange = () => {
    if (!this.elements.inputCornerRadius) return;
    const parsed = parseFloat(this.elements.inputCornerRadius.value);
    const selectedNodes = this.stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes);
    const cornerShapes = leafShapes.filter((s): s is Rectangle | Polygon | Star | Path =>
      s.type === 'rectangle' || s.type === 'polygon' || s.type === 'star' || s.type === 'path'
    );
    if (cornerShapes.length === 0) {
      this.clearSnapshot();
      this.syncPropertiesPanel();
      return;
    }

    if (this.editingNodeIds) {
      if (
        cornerShapes.length !== this.editingNodeIds.length ||
        !cornerShapes.every((s) => this.editingNodeIds!.includes(s.id))
      ) {
        this.clearSnapshot();
        this.syncPropertiesPanel();
        return;
      }
    }
    if (this.initialCornerRadiusSnapshots) {
      if (
        cornerShapes.length !== this.initialCornerRadiusSnapshots.size ||
        !cornerShapes.every((s) => this.initialCornerRadiusSnapshots!.has(s.id))
      ) {
        this.clearSnapshot();
        this.syncPropertiesPanel();
        return;
      }
    }

    const targetRadius = isNaN(parsed) || parsed < 0 ? 0 : this.roundToFourDecimals(parsed);
    this.elements.inputCornerRadius.value = String(targetRadius);

    const entries: ShapeTransformEntry[] = cornerShapes.map((r) => {
      const initialRadius = this.initialCornerRadiusSnapshots?.get(r.id) ?? r.cornerRadius ?? 0;
      return {
        id: r.id,
        before: {
          ...getShapeDimensions(r),
          cornerRadius: initialRadius,
        },
        after: {
          ...getShapeDimensions(r),
          cornerRadius: targetRadius,
        },
      };
    });

    const transformCommand = new TransformShapesCommand(this.stateManager, entries);
    if (!transformCommand.isAlreadyAtTarget) {
      const command = leafShapes.length > 1
        ? new BatchCommand([transformCommand], 'Change Corner Radius')
        : transformCommand;
      command.execute();
      this.commandManager.recordCommand(command);
    }
    this.clearSnapshot();
  };

  private onCornerRadiusBlur = () => {
    this.syncPropertiesPanel();
  };

  public sync(
    selectedNodes: readonly SelectableNode[],
    leafShapes: readonly Shape[],
    selectionBounds: AABB | null,
    firstLeafRotation: number | null
  ): void {
    if (this.editingNodeIds) {
      const currentIds = selectedNodes.map((n) => n.id);
      if (
        this.editingNodeIds.length !== currentIds.length ||
        !this.editingNodeIds.every((id, i) => id === currentIds[i])
      ) {
        this.clearSnapshot();
      }
    }

    const hasSelection = selectedNodes.length > 0;
    if (this.elements.sectionTransform) {
      this.elements.sectionTransform.style.display = hasSelection ? 'block' : 'none';
    }

    if (!hasSelection) {
      if (this.elements.groupCornerRadius) {
        this.elements.groupCornerRadius.style.display = 'none';
      }
      this.clearSnapshot();
      return;
    }


    if (selectionBounds) {
      if (this.elements.inputObjectX && (typeof document === 'undefined' || document.activeElement !== this.elements.inputObjectX)) {
        this.elements.inputObjectX.value = String(this.roundToFourDecimals(selectionBounds.minX));
      }
      if (this.elements.inputObjectY && (typeof document === 'undefined' || document.activeElement !== this.elements.inputObjectY)) {
        this.elements.inputObjectY.value = String(this.roundToFourDecimals(selectionBounds.minY));
      }
      if (this.elements.inputObjectWidth && (typeof document === 'undefined' || document.activeElement !== this.elements.inputObjectWidth)) {
        this.elements.inputObjectWidth.value = String(this.roundToFourDecimals(selectionBounds.width));
      }
      if (this.elements.inputObjectHeight && (typeof document === 'undefined' || document.activeElement !== this.elements.inputObjectHeight)) {
        this.elements.inputObjectHeight.value = String(this.roundToFourDecimals(selectionBounds.height));
      }
      if (this.elements.inputObjectRotation && firstLeafRotation !== null &&
          (typeof document === 'undefined' || document.activeElement !== this.elements.inputObjectRotation)) {
        this.elements.inputObjectRotation.value = String(this.roundToFourDecimals(firstLeafRotation));
      }
    }

    const cornerLeafs = leafShapes.filter((s): s is Rectangle | Polygon | Star | Path =>
      s.type === 'rectangle' || s.type === 'polygon' || s.type === 'star' || s.type === 'path'
    );
    if (this.elements.groupCornerRadius) {
      if (cornerLeafs.length > 0) {
        this.elements.groupCornerRadius.style.display = 'flex';
        if (this.elements.inputCornerRadius && (typeof document === 'undefined' || document.activeElement !== this.elements.inputCornerRadius)) {
          if (cornerLeafs.length === 1) {
            this.elements.inputCornerRadius.value = String(this.roundToFourDecimals(cornerLeafs[0].cornerRadius ?? 0));
            this.elements.inputCornerRadius.placeholder = '';
          } else {
            const firstRadius = cornerLeafs[0].cornerRadius ?? 0;
            const allSame = cornerLeafs.every((r) => (r.cornerRadius ?? 0) === firstRadius);
            if (allSame) {
              this.elements.inputCornerRadius.value = String(this.roundToFourDecimals(firstRadius));
              this.elements.inputCornerRadius.placeholder = '';
            } else {
              this.elements.inputCornerRadius.value = '';
              this.elements.inputCornerRadius.placeholder = 'Mixto';
            }
          }
        }
      } else {
        this.elements.groupCornerRadius.style.display = 'none';
      }
    }
  }

  public bind(): void {
    this.elements.inputObjectX?.addEventListener('focus', this.onTransformFocus);
    this.elements.inputObjectX?.addEventListener('change', this.onObjectXChange);
    this.elements.inputObjectY?.addEventListener('focus', this.onTransformFocus);
    this.elements.inputObjectY?.addEventListener('change', this.onObjectYChange);
    this.elements.inputObjectWidth?.addEventListener('focus', this.onTransformFocus);
    this.elements.inputObjectWidth?.addEventListener('change', this.onObjectWidthChange);
    this.elements.inputObjectHeight?.addEventListener('focus', this.onTransformFocus);
    this.elements.inputObjectHeight?.addEventListener('change', this.onObjectHeightChange);
    this.elements.inputObjectRotation?.addEventListener('focus', this.onTransformFocus);
    this.elements.inputObjectRotation?.addEventListener('change', this.onObjectRotationChange);
    this.elements.inputObjectX?.addEventListener('blur', this.onObjectGeometryBlur);
    this.elements.inputObjectY?.addEventListener('blur', this.onObjectGeometryBlur);
    this.elements.inputObjectWidth?.addEventListener('blur', this.onObjectGeometryBlur);
    this.elements.inputObjectHeight?.addEventListener('blur', this.onObjectGeometryBlur);
    this.elements.inputObjectRotation?.addEventListener('blur', this.onObjectGeometryBlur);

    this.elements.inputCornerRadius?.addEventListener('focus', this.onCornerRadiusFocus);
    this.elements.inputCornerRadius?.addEventListener('input', this.onCornerRadiusInput);
    this.elements.inputCornerRadius?.addEventListener('change', this.onCornerRadiusChange);
    this.elements.inputCornerRadius?.addEventListener('blur', this.onCornerRadiusBlur);
  }

  public cleanup(): void {
    this.elements.inputObjectX?.removeEventListener('focus', this.onTransformFocus);
    this.elements.inputObjectX?.removeEventListener('change', this.onObjectXChange);
    this.elements.inputObjectY?.removeEventListener('focus', this.onTransformFocus);
    this.elements.inputObjectY?.removeEventListener('change', this.onObjectYChange);
    this.elements.inputObjectWidth?.removeEventListener('focus', this.onTransformFocus);
    this.elements.inputObjectWidth?.removeEventListener('change', this.onObjectWidthChange);
    this.elements.inputObjectHeight?.removeEventListener('focus', this.onTransformFocus);
    this.elements.inputObjectHeight?.removeEventListener('change', this.onObjectHeightChange);
    this.elements.inputObjectRotation?.removeEventListener('focus', this.onTransformFocus);
    this.elements.inputObjectRotation?.removeEventListener('change', this.onObjectRotationChange);
    this.elements.inputObjectX?.removeEventListener('blur', this.onObjectGeometryBlur);
    this.elements.inputObjectY?.removeEventListener('blur', this.onObjectGeometryBlur);
    this.elements.inputObjectWidth?.removeEventListener('blur', this.onObjectGeometryBlur);
    this.elements.inputObjectHeight?.removeEventListener('blur', this.onObjectGeometryBlur);
    this.elements.inputObjectRotation?.removeEventListener('blur', this.onObjectGeometryBlur);

    this.elements.inputCornerRadius?.removeEventListener('focus', this.onCornerRadiusFocus);
    this.elements.inputCornerRadius?.removeEventListener('input', this.onCornerRadiusInput);
    this.elements.inputCornerRadius?.removeEventListener('change', this.onCornerRadiusChange);
    this.elements.inputCornerRadius?.removeEventListener('blur', this.onCornerRadiusBlur);
  }
}
