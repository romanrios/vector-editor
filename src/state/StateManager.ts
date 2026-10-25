import type {
  Document,
  Group,
  Layer,
  LayerChildNode,
  ParentNode,
  SceneNode,
  PathPoint,
  PathPointType,
  SelectableNode,
  Shape,
  AssetData,
  Guide,
  Artboard,
} from '../types/scene-graph.ts';
import type { ShapeDimensions } from '../commands/ResizeCommand.ts';
import type { CommandManager } from '../commands/CommandManager.ts';
import { isDropShadowEqual, isLayer, isSelectable } from '../types/scene-graph.ts';
import { deepFreeze } from '../utils/immutable.ts';
import { SpatialIndex } from '../spatial/SpatialIndex.ts';

import type {
  StateListener,
  ShapePositionEntry,
  ShapeDimensionsEntry,
  ShapeStyleUpdate,
  ShapeStyleEntry,
  DocumentIndex,
  DrawingStyle,
} from './operations/types.ts';
import {
  documentIndexCache,
  isPaintEqual,
  getLeafShapes,
  buildDocumentIndex,
  getDocumentIndex,
  hasCachedDocumentIndex,
  isDescendantOf,
} from './operations/documentIndex.ts';
import {
  addNodeToDocument,
  removeNodeFromDocument,
  reorderNodesInDocument,
  reorderNodeStepInDocument,
  bringNodeToFront,
  sendNodeToBack,
  getEmptiedAncestors,
  isEffectivelyVisible as checkEffectivelyVisible,
  isEffectivelyLocked as checkEffectivelyLocked,
} from './operations/treeOperations.ts';
import {
  applyShapesPosition,
  applyShapesDimensions,
  applyShapesStyle,
  applyShapeUpdate,
  applyNodeUpdate,
} from './operations/shapeTransformOperations.ts';
import {
  insertPathPointInDocument,
  deletePathPointsInDocument,
  setPathPointTypeInDocument,
  setPathPointCornerRadiusInDocument,
} from './operations/pathOperations.ts';
import {
  getArtboardsFromDocument,
  getActiveArtboardIdFromDocument,
  getActiveArtboardFromDocument,
  addArtboardToDocument,
  updateArtboardInDocument,
  removeArtboardFromDocument,
  getArtboardAtCoordinates,
  setDocumentSizeInDocument,
} from './operations/artboardOperations.ts';
import {
  normalizeSelection,
  toggleSelection,
  selectAllNodes,
} from './operations/selectionOperations.ts';
import {
  addGuideToDocument,
  removeGuideFromDocument,
  updateGuideInDocument,
  clearGuidesFromDocument,
  setGuidesInDocument,
} from './operations/guidesOperations.ts';

export type {
  StateListener,
  ShapePositionEntry,
  ShapeDimensionsEntry,
  ShapeStyleUpdate,
  ShapeStyleEntry,
  DocumentIndex,
  DrawingStyle,
};

export {
  documentIndexCache,
  isPaintEqual,
  getLeafShapes,
  buildDocumentIndex,
  getDocumentIndex,
  hasCachedDocumentIndex,
};

/**
 * Gestor de estado inmutable para el Scene Graph de un editor vectorial.
 * Toda modificación produce un nuevo estado a través de persistencia estructural,
 * garantizando que los objetos anteriores nunca sean mutados.
 */
export class StateManager {
  private _state: Readonly<Document>;
  private _selectedIds: readonly string[] = [];
  private _selectedSet: ReadonlySet<string> = new Set();
  private _listeners: Set<StateListener> = new Set();
  private _isDirty: boolean = true;
  private _activeLayerId: string | null = null;
  private commandManager: CommandManager | null = null;
  private _drawingStyle: DrawingStyle = {
    fill: '#38bdf8',
    stroke: '#0284c7',
    strokeWidth: 2,
    opacity: 1,
    blendMode: 'normal',
    dropShadow: null,
    strokeDashArray: undefined,
    strokeLineCap: 'butt',
    strokeLineJoin: 'miter',
  };
  private _rulersVisible: boolean = true;
  private _guidesVisible: boolean = true;
  private _guidesLocked: boolean = false;
  private _guideSnappingEnabled: boolean = true;
  private _spatialIndex: SpatialIndex | null = null;

  constructor(initialState?: Document, commandManager?: CommandManager) {
    const defaultState: Document = {
      id: 'doc-root',
      type: 'document',
      name: 'Nuevo Documento',
      width: 1920,
      height: 1080,
      children: [
        {
          id: 'layer-default',
          type: 'layer',
          name: 'Capa Base',
          children: [],
        },
      ],
    };

    const initial = initialState ? structuredClone(initialState) : defaultState;
    this._isDirty = true;
    this._state = deepFreeze(initial);
    this._activeLayerId = initial.children[0]?.id ?? null;
    this._selectedIds = Object.freeze([]);
    this._selectedSet = new Set();
    if (commandManager) {
      this.commandManager = commandManager;
    }
  }

  public getDrawingStyle(): DrawingStyle {
    return { ...this._drawingStyle };
  }

  public setDrawingStyle(partial: Partial<DrawingStyle>): void {
    const nextStyle: DrawingStyle = {
      fill: partial.fill !== undefined ? partial.fill : this._drawingStyle.fill,
      stroke: partial.stroke !== undefined ? partial.stroke : this._drawingStyle.stroke,
      strokeWidth:
        partial.strokeWidth !== undefined ? partial.strokeWidth : this._drawingStyle.strokeWidth,
      opacity: partial.opacity !== undefined ? partial.opacity : this._drawingStyle.opacity,
      blendMode: partial.blendMode !== undefined ? partial.blendMode : this._drawingStyle.blendMode,
      dropShadow: 'dropShadow' in partial ? partial.dropShadow : this._drawingStyle.dropShadow,
      strokeDashArray:
        partial.strokeDashArray !== undefined ? partial.strokeDashArray : this._drawingStyle.strokeDashArray,
      strokeLineCap:
        partial.strokeLineCap !== undefined ? partial.strokeLineCap : this._drawingStyle.strokeLineCap,
      strokeLineJoin:
        partial.strokeLineJoin !== undefined ? partial.strokeLineJoin : this._drawingStyle.strokeLineJoin,
    };
    const isSameDash =
      (!nextStyle.strokeDashArray && !this._drawingStyle.strokeDashArray) ||
      (Array.isArray(nextStyle.strokeDashArray) &&
        Array.isArray(this._drawingStyle.strokeDashArray) &&
        nextStyle.strokeDashArray.length === this._drawingStyle.strokeDashArray.length &&
        nextStyle.strokeDashArray.every((v, i) => v === this._drawingStyle.strokeDashArray![i]));

    if (
      nextStyle.fill === this._drawingStyle.fill &&
      nextStyle.stroke === this._drawingStyle.stroke &&
      nextStyle.strokeWidth === this._drawingStyle.strokeWidth &&
      nextStyle.opacity === this._drawingStyle.opacity &&
      nextStyle.blendMode === this._drawingStyle.blendMode &&
      isDropShadowEqual(nextStyle.dropShadow, this._drawingStyle.dropShadow) &&
      nextStyle.strokeLineCap === this._drawingStyle.strokeLineCap &&
      nextStyle.strokeLineJoin === this._drawingStyle.strokeLineJoin &&
      isSameDash
    ) {
      return;
    }
    this._drawingStyle = nextStyle;
    this.markDirty();
    this.notify();
  }

  public get isDirty(): boolean {
    return this._isDirty;
  }

  public markDirty(): void {
    this._isDirty = true;
  }

  public clearDirty(): void {
    this._isDirty = false;
  }

  public getState(): Readonly<Document> {
    return this._state;
  }

  public getSpatialIndex(): SpatialIndex {
    if (!this._spatialIndex) {
      this._spatialIndex = new SpatialIndex();
      this._spatialIndex.buildFromDocument(this._state);
    }
    return this._spatialIndex;
  }

  public setDocumentSize(width: number, height: number): void {
    const nextState = setDocumentSizeInDocument(this._state, width, height);
    if (nextState !== this._state) {
      this.setState(nextState);
    }
  }

  public getArtboards(): readonly Artboard[] {
    return getArtboardsFromDocument(this._state);
  }

  public getActiveArtboardId(): string {
    return getActiveArtboardIdFromDocument(this._state);
  }

  public getActiveArtboard(): Artboard {
    return getActiveArtboardFromDocument(this._state);
  }

  public setActiveArtboard(id: string): void {
    if (this._state.activeArtboardId === id) {
      return;
    }
    this.setState({
      ...this._state,
      activeArtboardId: id,
    });
  }

  public addArtboard(artboard: Artboard): void {
    const nextState = addArtboardToDocument(this._state, artboard);
    this.setState(nextState);
  }

  public updateArtboard(id: string, updates: Partial<Omit<Artboard, 'id'>>): void {
    const nextState = updateArtboardInDocument(this._state, id, updates);
    if (nextState !== this._state) {
      this.setState(nextState);
    }
  }

  public removeArtboard(id: string): void {
    const nextState = removeArtboardFromDocument(this._state, id);
    if (nextState !== this._state) {
      this.setState(nextState);
    }
  }

  public getArtboardAt(worldX: number, worldY: number): Artboard | null {
    return getArtboardAtCoordinates(this._state, worldX, worldY);
  }

  public setCommandManager(commandManager: CommandManager | null): void {
    this.commandManager = commandManager;
  }

  public loadState(newState: Document, commandManager?: CommandManager): void {
    if (!newState || newState.type !== 'document') {
      throw new Error(
        `[StateManager] loadState requiere un objeto Document válido con type 'document'.`
      );
    }

    const cm = commandManager ?? this.commandManager;
    if (cm) {
      cm.clear();
    }

    this._isDirty = true;
    this._spatialIndex = null;
    const cloned = structuredClone(newState);
    this._state = deepFreeze(cloned);

    this._selectedIds = Object.freeze([]);
    this._selectedSet = new Set();
    this._activeLayerId = this._state.children[0]?.id ?? null;

    this.notify();
  }

  public subscribe(listener: StateListener): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this._listeners) {
      listener(this._state);
    }
  }

  private setState(nextState: Document): void {
    this._isDirty = true;
    this._state = deepFreeze(nextState);

    if (this._spatialIndex && this._spatialIndex.lastDocument !== this._state) {
      this._spatialIndex = null;
    }

    if (this._selectedIds.length > 0) {
      const index = getDocumentIndex(this._state);
      let needsPurge = false;
      for (let i = 0; i < this._selectedIds.length; i++) {
        const node = index.nodeMap.get(this._selectedIds[i]);
        if (!node || !isSelectable(node)) {
          needsPurge = true;
          break;
        }
      }

      if (needsPurge) {
        const validSelectedIds = this._selectedIds.filter((id) => {
          const node = index.nodeMap.get(id);
          return node !== null && node !== undefined && isSelectable(node);
        });
        this._selectedIds = Object.freeze(validSelectedIds);
        this._selectedSet = new Set(validSelectedIds);
      }
    }

    this.notify();
  }

  public findNode(id: string): SceneNode | null {
    return getDocumentIndex(this._state).nodeMap.get(id) ?? null;
  }

  public findParent(childId: string): ParentNode | null {
    return getDocumentIndex(this._state).parentMap.get(childId) ?? null;
  }

  public addNode(parentId: string, node: Layer | LayerChildNode, index?: number): void {
    const parent = this.findNode(parentId);

    if (!parent) {
      throw new Error(`[StateManager] Nodo padre con id "${parentId}" no fue encontrado.`);
    }

    const nextState = addNodeToDocument(this._state, parentId, node, index);
    if (this._spatialIndex && isSelectable(node) && (isLayer(parent) || parent.type === 'group')) {
      const docIndex = getDocumentIndex(this._state);
      let layerId = parent.id;
      let curr: ParentNode | undefined = parent;
      while (curr && curr.type !== 'layer' && curr.type !== 'document') {
        curr = docIndex.parentMap.get(curr.id);
      }
      if (curr && isLayer(curr)) {
        layerId = curr.id;
      }
      this._spatialIndex.insertNode(node, layerId);
      this._spatialIndex.setLastDocument(nextState);
    }
    this.setState(nextState);
  }

  public removeNode(nodeId: string): boolean {
    if (nodeId === this._state.id) {
      throw new Error('[StateManager] No se puede eliminar el nodo raíz Document.');
    }

    const { nextDoc, removed } = removeNodeFromDocument(this._state, nodeId);
    if (removed) {
      if (this._spatialIndex) {
        this._spatialIndex.removeNode(nodeId, nextDoc);
      }
      this.setState(nextDoc);
      return true;
    }
    return false;
  }

  public addLayer(layer: Layer, index?: number): void {
    this.addNode(this._state.id, layer, index);
  }

  public removeLayer(layerId: string): boolean {
    return this.removeNode(layerId);
  }

  public reorderLayers(fromIndex: number, toIndex: number): void {
    this.reorderNodes(this._state.id, fromIndex, toIndex);
  }

  public reorderNodes(parentId: string, fromIndex: number, toIndex: number): void {
    const nextState = reorderNodesInDocument(this._state, parentId, fromIndex, toIndex);
    if (nextState) {
      this.setState(nextState);
    }
  }

  public moveNode(nodeId: string, targetParentId: string, targetIndex?: number): void {
    const parent = this.findParent(nodeId);
    if (!parent) {
      throw new Error(`[StateManager] Nodo con id "${nodeId}" no tiene contenedor padre.`);
    }

    if (parent.id === targetParentId) {
      const fromIndex = (parent.children as readonly SceneNode[]).findIndex((c) => c.id === nodeId);
      if (fromIndex !== -1 && targetIndex !== undefined) {
        this.reorderNodes(parent.id, fromIndex, targetIndex);
      }
      return;
    }

    const node = this.findNode(nodeId);
    if (!node || node.type === 'document') {
      throw new Error(`[StateManager] Nodo "${nodeId}" no es válido para mover.`);
    }

    this.removeNode(nodeId);
    this.addNode(targetParentId, node as Layer | LayerChildNode, targetIndex);
  }

  public getEmptiedAncestors(removedIds: readonly string[]): Group[] {
    return getEmptiedAncestors(this._state, removedIds);
  }

  public isEffectivelyVisible(id: string): boolean {
    return checkEffectivelyVisible(this._state, id);
  }

  public isEffectivelyLocked(id: string): boolean {
    return checkEffectivelyLocked(this._state, id);
  }

  public setNodeVisibility(nodeId: string, visible: boolean): boolean {
    const node = this.findNode(nodeId);
    if (!node) {
      return false;
    }
    const current = node.visible ?? true;
    if (current === visible) {
      return false;
    }
    return this.updateNode(nodeId, { visible });
  }

  public setNodeLocked(nodeId: string, locked: boolean): boolean {
    const node = this.findNode(nodeId);
    if (!node) {
      return false;
    }
    const current = node.locked ?? false;
    if (current === locked) {
      return false;
    }
    const changed = this.updateNode(nodeId, { locked });
    if (changed && locked) {
      const selected = this.getSelection();
      if (selected.length > 0) {
        const docIndex = getDocumentIndex(this._state);
        const toRemove = selected.filter(
          (id) => id === nodeId || isDescendantOf(id, nodeId, docIndex.parentMap)
        );
        if (toRemove.length > 0) {
          this.removeFromSelection(toRemove);
        }
      }
    }
    return changed;
  }

  public setNodeName(nodeId: string, name: string): boolean {
    const node = this.findNode(nodeId);
    if (!node) {
      return false;
    }
    const trimmed = name.trim();
    if (!trimmed || node.name === trimmed) {
      return false;
    }
    return this.updateNode(nodeId, { name: trimmed });
  }

  public getActiveLayerId(): string {
    if (this._activeLayerId) {
      const layer = this.findNode(this._activeLayerId);
      if (layer && layer.type === 'layer') {
        return this._activeLayerId;
      }
    }

    const firstLayer = this._state.children[0];
    if (firstLayer) {
      this._activeLayerId = firstLayer.id;
      return firstLayer.id;
    }

    return '';
  }

  public getActiveLayer(): Layer | null {
    const layerId = this.getActiveLayerId();
    if (!layerId) return null;
    const node = this.findNode(layerId);
    return node && node.type === 'layer' ? node : null;
  }

  public setActiveLayerId(layerId: string): boolean {
    const node = this.findNode(layerId);
    if (!node || node.type !== 'layer') {
      return false;
    }
    if (this._activeLayerId === layerId) {
      return true;
    }
    this._activeLayerId = layerId;
    this.markDirty();
    this.notify();
    return true;
  }

  public findLayerOfNode(nodeId: string): Layer | null {
    const docIndex = getDocumentIndex(this._state);
    let current: ParentNode | undefined = docIndex.parentMap.get(nodeId);
    while (current) {
      if (current.type === 'layer') {
        return current;
      }
      current = docIndex.parentMap.get(current.id);
    }
    return null;
  }

  public reorderNodeStep(nodeId: string, direction: 'up' | 'down'): boolean {
    const nextState = reorderNodeStepInDocument(this._state, nodeId, direction);
    if (nextState) {
      this.setState(nextState);
      return true;
    }
    return false;
  }

  public addShape(layerOrGroupId: string, shape: Shape, index?: number): void {
    this.addNode(layerOrGroupId, shape, index);
  }

  public removeShape(shapeId: string): boolean {
    return this.removeNode(shapeId);
  }

  public reorderShapes(layerId: string, fromIndex: number, toIndex: number): void {
    this.reorderNodes(layerId, fromIndex, toIndex);
  }

  public bringToFront(shapeId: string): boolean {
    const nextState = bringNodeToFront(this._state, shapeId);
    if (nextState) {
      this.setState(nextState);
      return true;
    }
    return false;
  }

  public sendToBack(shapeId: string): boolean {
    const nextState = sendNodeToBack(this._state, shapeId);
    if (nextState) {
      this.setState(nextState);
      return true;
    }
    return false;
  }

  public getSelection(): readonly string[] {
    return this._selectedIds;
  }

  public getSelectedNodes(): SelectableNode[] {
    const docIndex = getDocumentIndex(this._state);
    const nodes: SelectableNode[] = [];
    for (const id of this._selectedIds) {
      const node = docIndex.nodeMap.get(id);
      if (node && isSelectable(node)) {
        nodes.push(node);
      }
    }
    return nodes;
  }

  public isSelected(id: string): boolean {
    return this._selectedSet.has(id);
  }

  public setSelection(ids: readonly string[]): void {
    const normalizedIds = normalizeSelection(ids, this._state);

    const isSame =
      normalizedIds.length === this._selectedIds.length &&
      normalizedIds.every((id, idx) => id === this._selectedIds[idx]);

    if (isSame) {
      return;
    }

    this._selectedIds = Object.freeze(normalizedIds as string[]);
    this._selectedSet = new Set(normalizedIds);
    if (normalizedIds.length > 0) {
      const containingLayer = this.findLayerOfNode(normalizedIds[0]);
      if (containingLayer) {
        this._activeLayerId = containingLayer.id;
      }
    }
    this.markDirty();
    this.notify();
  }

  public selectNode(targetNodeId: string | null): void {
    this.setSelection(targetNodeId ? [targetNodeId] : []);
  }

  public getSelectedNode(): SelectableNode | null {
    return this.getSelectedNodes()[0] ?? null;
  }

  public toggleInSelection(id: string): void {
    const nextSelection = toggleSelection(id, this._selectedIds, this._state);
    this.setSelection(nextSelection);
  }

  public addToSelection(ids: readonly string[]): void {
    this.setSelection([...this._selectedIds, ...ids]);
  }

  public removeFromSelection(ids: readonly string[]): void {
    const toRemove = new Set(ids);
    this.setSelection(this._selectedIds.filter((id) => !toRemove.has(id)));
  }

  public selectAll(): void {
    const nextSelection = selectAllNodes(
      this._state,
      (id) => this.isEffectivelyVisible(id),
      (id) => this.isEffectivelyLocked(id)
    );
    this.setSelection(nextSelection);
  }

  public updateShapesPosition(entries: readonly ShapePositionEntry[]): boolean {
    const { nextDoc, changed } = applyShapesPosition(this._state, entries);
    if (!changed) {
      return false;
    }
    if (this._spatialIndex) {
      this._spatialIndex.updateShapesPositions(entries, nextDoc);
    }
    this.setState(nextDoc);
    return true;
  }

  public updateShapePosition(shapeId: string, x: number, y: number): boolean {
    return this.updateShapesPosition([{ id: shapeId, x, y }]);
  }

  public updateShapesDimensions(entries: readonly ShapeDimensionsEntry[]): boolean {
    const { nextDoc, changed } = applyShapesDimensions(this._state, entries);
    if (!changed) {
      return false;
    }
    if (this._spatialIndex) {
      this._spatialIndex.updateShapesDimensions(entries, nextDoc);
    }
    this.setState(nextDoc);
    return true;
  }

  public updateShapesStyle(entries: readonly ShapeStyleEntry[]): boolean {
    const { nextDoc, changed } = applyShapesStyle(this._state, entries);
    if (!changed) {
      return false;
    }
    this.setState(nextDoc);
    return true;
  }

  public updateShapeDimensions(shapeId: string, dimensions: ShapeDimensions): boolean {
    return this.updateShapesDimensions([{ id: shapeId, dimensions }]);
  }

  public updateShape(shapeId: string, updater: Partial<Shape>): boolean;
  public updateShape<T extends Shape>(shapeId: string, updater: Partial<T> | ((current: T) => T)): boolean;
  public updateShape<T extends Shape>(
    shapeId: string,
    updater: Partial<Shape> | Partial<T> | ((current: T) => T)
  ): boolean {
    const { nextDoc, changed } = applyShapeUpdate(this._state, shapeId, updater);
    if (!changed) {
      return false;
    }
    this.setState(nextDoc);
    return true;
  }

  public insertPathPoint(
    pathId: string,
    segmentIndex: number,
    t: number
  ): { pointIndex: number; newPoint: PathPoint } | null {
    const { nextDoc, result } = insertPathPointInDocument(this._state, pathId, segmentIndex, t);
    if (!result) {
      return null;
    }
    this.setState(nextDoc);
    return result;
  }

  public deletePathPoints(pathId: string, indices: readonly number[]): boolean {
    const { nextDoc, changed } = deletePathPointsInDocument(this._state, pathId, indices);
    if (!changed) {
      return false;
    }
    this.setState(nextDoc);
    return true;
  }

  public setPathPointType(
    pathId: string,
    indices: readonly number[],
    pointType: PathPointType
  ): boolean {
    const { nextDoc, changed } = setPathPointTypeInDocument(this._state, pathId, indices, pointType);
    if (!changed) {
      return false;
    }
    this.setState(nextDoc);
    return true;
  }

  public setPathPointCornerRadius(
    pathId: string,
    indices: readonly number[],
    cornerRadius?: number
  ): boolean {
    const { nextDoc, changed } = setPathPointCornerRadiusInDocument(this._state, pathId, indices, cornerRadius);
    if (!changed) {
      return false;
    }
    this.setState(nextDoc);
    return true;
  }

  public updateNode(nodeId: string, updater: Partial<SceneNode> | Record<string, unknown>): boolean {
    const { nextDoc, changed } = applyNodeUpdate(this._state, nodeId, updater);
    if (!changed) {
      return false;
    }
    this.setState(nextDoc);
    return true;
  }

  public registerAsset(asset: AssetData): void {
    const currentAssets = this._state.assets ?? {};
    if (currentAssets[asset.id] === asset) {
      return;
    }
    const nextAssets = {
      ...currentAssets,
      [asset.id]: asset,
    };
    this.setState({
      ...this._state,
      assets: nextAssets,
    });
  }

  public getAsset(assetId: string): AssetData | undefined {
    return this._state.assets?.[assetId];
  }

  public getAssets(): Readonly<Record<string, AssetData>> {
    return this._state.assets ?? {};
  }

  public isRulersVisible(): boolean {
    return this._rulersVisible;
  }

  public setRulersVisible(visible: boolean): void {
    if (this._rulersVisible === visible) return;
    this._rulersVisible = visible;
    this._isDirty = true;
    this.notify();
  }

  public isGuidesVisible(): boolean {
    return this._guidesVisible;
  }

  public setGuidesVisible(visible: boolean): void {
    if (this._guidesVisible === visible) return;
    this._guidesVisible = visible;
    this._isDirty = true;
    this.notify();
  }

  public isGuidesLocked(): boolean {
    return this._guidesLocked;
  }

  public setGuidesLocked(locked: boolean): void {
    if (this._guidesLocked === locked) return;
    this._guidesLocked = locked;
    this._isDirty = true;
    this.notify();
  }

  public isGuideSnappingEnabled(): boolean {
    return this._guideSnappingEnabled;
  }

  public setGuideSnappingEnabled(enabled: boolean): void {
    if (this._guideSnappingEnabled === enabled) return;
    this._guideSnappingEnabled = enabled;
    this._isDirty = true;
    this.notify();
  }

  public getGuides(): readonly Guide[] {
    return this._state.guides ?? [];
  }

  public addGuide(guide: Guide): void {
    const nextState = addGuideToDocument(this._state, guide);
    if (nextState !== this._state) {
      this.setState(nextState);
    }
  }

  public removeGuide(guideId: string): Guide | undefined {
    const { nextDoc, removedGuide } = removeGuideFromDocument(this._state, guideId);
    if (removedGuide) {
      this.setState(nextDoc);
    }
    return removedGuide;
  }

  public updateGuide(guideId: string, position: number): number | undefined {
    const { nextDoc, oldPosition } = updateGuideInDocument(this._state, guideId, position);
    if (oldPosition !== undefined && nextDoc !== this._state) {
      this.setState(nextDoc);
    }
    return oldPosition;
  }

  public clearGuides(): readonly Guide[] {
    const { nextDoc, clearedGuides } = clearGuidesFromDocument(this._state);
    if (nextDoc !== this._state) {
      this.setState(nextDoc);
    }
    return clearedGuides;
  }

  public setGuides(guides: readonly Guide[]): void {
    const nextState = setGuidesInDocument(this._state, guides);
    this.setState(nextState);
  }
}
