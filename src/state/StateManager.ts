import type {
  Document,
  Group,
  Layer,
  LayerChildNode,
  ParentNode,
  SceneNode,
  Path,
  PathPoint,
  PathPointType,
  SelectableNode,
  Shape,
  Rectangle,
  Polygon,
  Star,
  Text,
  AssetData,
  FillType,
  StrokeLineCap,
  StrokeLineJoin,
  Guide,
  Artboard,
  BlendMode,
  DropShadow,
} from '../types/scene-graph.ts';
import type { ShapeDimensions } from '../commands/ResizeCommand.ts';
import type { CommandManager } from '../commands/CommandManager.ts';
import { isDocument, isGroup, isLayer, isSelectable, isShape, isDropShadowEqual } from '../types/scene-graph.ts';
import {
  deepFreeze,
  insertAt,
  moveItem,
  removeAt,
} from '../utils/immutable.ts';
import {
  splitPathSegment,
  deletePathPointsFromPath,
  applyPointType,
} from '../utils/geometry.ts';
import { SpatialIndex } from '../spatial/SpatialIndex.ts';

export type StateListener = (state: Readonly<Document>) => void;

export interface ShapePositionEntry {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

export interface ShapeDimensionsEntry {
  readonly id: string;
  readonly dimensions: ShapeDimensions;
}

export interface ShapeStyleUpdate {
  readonly fill?: FillType;
  readonly stroke?: FillType;
  readonly strokeWidth?: number;
  readonly opacity?: number;
  readonly blendMode?: BlendMode;
  readonly dropShadow?: DropShadow | null;
  readonly strokeDashArray?: readonly number[];
  readonly strokeLineCap?: StrokeLineCap;
  readonly strokeLineJoin?: StrokeLineJoin;
}

export interface ShapeStyleEntry {
  readonly id: string;
  readonly style: ShapeStyleUpdate;
}

export interface DocumentIndex {
  readonly nodeMap: Map<string, SceneNode>;
  readonly parentMap: Map<string, ParentNode>;
}

export const documentIndexCache = new WeakMap<Document, DocumentIndex>();

export function isPaintEqual(a: FillType | undefined, b: FillType | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a === 'string') return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Helper puro que expande una colección de nodos seleccionables (figuras o grupos),
 * resolviendo recursivamente todos los grupos a sus figuras hoja (Shape),
 * eliminando duplicados y preservando el orden de apilado.
 */
export function getLeafShapes(nodes: readonly SelectableNode[]): Shape[] {
  const result: Shape[] = [];
  const seen = new Set<string>();

  function collect(node: SelectableNode) {
    if (isShape(node)) {
      if (!seen.has(node.id)) {
        seen.add(node.id);
        result.push(node);
      }
    } else if (isGroup(node)) {
      for (let i = 0; i < node.children.length; i++) {
        collect(node.children[i]);
      }
    }
  }

  for (let i = 0; i < nodes.length; i++) {
    collect(nodes[i]);
  }

  return result;
}

/**
 * Determina si un nodo childId es descendiente de potentialAncestorId en el árbol del documento.
 */
function isDescendantOf(
  childId: string,
  potentialAncestorId: string,
  parentMap: Map<string, ParentNode>
): boolean {
  let current: ParentNode | undefined = parentMap.get(childId);
  while (current && current.type !== 'document') {
    if (current.id === potentialAncestorId) {
      return true;
    }
    current = parentMap.get(current.id);
  }
  return false;
}

/**
 * Construye de forma recursiva el índice de búsqueda plana (id -> nodo e id -> padre)
 * para todo el Scene Graph (Document > Layer > Group* > Shape).
 */
export function buildDocumentIndex(doc: Document): DocumentIndex {
  const nodeMap = new Map<string, SceneNode>();
  const parentMap = new Map<string, ParentNode>();

  nodeMap.set(doc.id, doc);

  function indexChildren(parent: ParentNode, children: readonly LayerChildNode[]) {
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      nodeMap.set(child.id, child);
      parentMap.set(child.id, parent);
      if (isGroup(child)) {
        indexChildren(child, child.children);
      }
    }
  }

  for (let i = 0; i < doc.children.length; i++) {
    const layer = doc.children[i];
    nodeMap.set(layer.id, layer);
    parentMap.set(layer.id, doc);
    indexChildren(layer, layer.children);
  }

  return { nodeMap, parentMap };
}

export function getDocumentIndex(doc: Document): DocumentIndex {
  let index = documentIndexCache.get(doc);
  if (!index) {
    index = buildDocumentIndex(doc);
    documentIndexCache.set(doc, index);
  }
  return index;
}

export function hasCachedDocumentIndex(doc: Document): boolean {
  return documentIndexCache.has(doc);
}

export interface DrawingStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  blendMode?: BlendMode;
  dropShadow?: DropShadow | null;
  strokeDashArray?: readonly number[];
  strokeLineCap?: StrokeLineCap;
  strokeLineJoin?: StrokeLineJoin;
}

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

  /**
   * Obtiene una copia del estilo de dibujo actual para nuevas figuras.
   */
  public getDrawingStyle(): DrawingStyle {
    return { ...this._drawingStyle };
  }

  /**
   * Actualiza el estilo de dibujo actual y notifica a los suscriptores.
   */
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

  /**
   * Indica si el estado ha cambiado y requiere redibujado (flag isDirty).
   */
  public get isDirty(): boolean {
    return this._isDirty;
  }

  /**
   * Marca explícitamente el estado como "sucio" para forzar un nuevo renderizado.
   * NO modifica la referencia del Documento (getState() preserva su identidad).
   */
  public markDirty(): void {
    this._isDirty = true;
  }

  /**
   * Limpia el flag isDirty tras completar un ciclo de dibujado.
   * NO modifica la referencia del Documento (getState() preserva su identidad).
   */
  public clearDirty(): void {
    this._isDirty = false;
  }

  /**
   * Obtiene el estado actual inmutable del Documento.
   */
  public getState(): Readonly<Document> {
    return this._state;
  }

  /**
   * Obtiene el índice espacial (Árbol-R / BVH) acelerado del Scene Graph.
   * Acelera el hit-testing de puntos y consultas de ventana en O(log n).
   */
  public getSpatialIndex(): SpatialIndex {
    if (!this._spatialIndex) {
      this._spatialIndex = new SpatialIndex();
      this._spatialIndex.buildFromDocument(this._state);
    }
    return this._spatialIndex;
  }

  /**
   * Actualiza las dimensiones de la Mesa de Trabajo / Documento (Document.width y Document.height).
   * Acepta únicamente números finitos positivos (> 0).
   * Genera un nuevo estado inmutable conservando capas y figuras intactas, marca isDirty y notifica a los suscriptores.
   */
  public setDocumentSize(width: number, height: number): void {
    if (!Number.isFinite(width) || width <= 0) {
      throw new Error(`[StateManager] El ancho del documento debe ser un número finito mayor a 0: ${width}`);
    }
    if (!Number.isFinite(height) || height <= 0) {
      throw new Error(`[StateManager] El alto del documento debe ser un número finito mayor a 0: ${height}`);
    }

    if (this._state.width === width && this._state.height === height) {
      return;
    }

    const nextState: Document = {
      ...this._state,
      width,
      height,
    };

    // Si hay mesas de trabajo definidas, sincronizar también la primera si está en el origen
    if (this._state.artboards && this._state.artboards.length > 0) {
      const first = this._state.artboards[0];
      if (first.x === 0 && first.y === 0) {
        const updatedArtboards = [
          {
            ...first,
            width,
            height,
          },
          ...this._state.artboards.slice(1),
        ];
        this.setState({
          ...nextState,
          artboards: updatedArtboards,
        });
        return;
      }
    }

    this.setState(nextState);
  }

  /**
   * Obtiene la lista inmutable de todas las Mesas de Trabajo (Artboards).
   * Si el documento no tiene mesas de trabajo explícitas, devuelve una mesa por defecto
   * correspondiente al lienzo base (0, 0, width, height).
   */
  public getArtboards(): readonly Artboard[] {
    if (this._state.artboards && this._state.artboards.length > 0) {
      return this._state.artboards;
    }

    return Object.freeze([
      Object.freeze({
        id: 'artboard-default',
        name: this._state.name || 'Mesa 1',
        x: 0,
        y: 0,
        width: this._state.width || 1920,
        height: this._state.height || 1080,
        backgroundColor: '#ffffff',
      }),
    ]);
  }

  /**
   * Retorna el identificador de la Mesa de Trabajo activa.
   */
  public getActiveArtboardId(): string {
    const list = this.getArtboards();
    if (this._state.activeArtboardId && list.some((a) => a.id === this._state.activeArtboardId)) {
      return this._state.activeArtboardId;
    }
    return list[0]?.id ?? 'artboard-default';
  }

  /**
   * Retorna la Mesa de Trabajo activa.
   */
  public getActiveArtboard(): Artboard {
    const activeId = this.getActiveArtboardId();
    const list = this.getArtboards();
    return list.find((a) => a.id === activeId) ?? list[0];
  }

  /**
   * Establece la Mesa de Trabajo activa por su identificador.
   */
  public setActiveArtboard(id: string): void {
    if (this._state.activeArtboardId === id) {
      return;
    }
    this.setState({
      ...this._state,
      activeArtboardId: id,
    });
  }

  /**
   * Agrega una nueva Mesa de Trabajo al documento.
   * Si el documento solo poseía la mesa implícita por defecto, migra la inicial explícitamente.
   */
  public addArtboard(artboard: Artboard): void {
    if (!artboard || typeof artboard !== 'object') {
      throw new Error('[StateManager] addArtboard requiere un objeto Artboard válido.');
    }
    if (!artboard.id || typeof artboard.id !== 'string') {
      throw new Error('[StateManager] El Artboard debe tener un id de tipo string no vacío.');
    }
    if (!Number.isFinite(artboard.width) || artboard.width <= 0) {
      throw new Error(`[StateManager] Artboard width debe ser positivo: ${artboard.width}`);
    }
    if (!Number.isFinite(artboard.height) || artboard.height <= 0) {
      throw new Error(`[StateManager] Artboard height debe ser positivo: ${artboard.height}`);
    }

    const currentArtboards = this.getArtboards();
    const nextArtboards = [...currentArtboards, Object.freeze({ ...artboard })];

    this.setState({
      ...this._state,
      artboards: nextArtboards,
      activeArtboardId: artboard.id,
    });
  }

  /**
   * Actualiza propiedades (nombre, coordenadas, dimensiones, fondo) de una Mesa de Trabajo.
   */
  public updateArtboard(id: string, updates: Partial<Omit<Artboard, 'id'>>): void {
    const currentArtboards = this.getArtboards();
    const index = currentArtboards.findIndex((a) => a.id === id);
    if (index === -1) {
      return;
    }

    if (updates.width !== undefined && (!Number.isFinite(updates.width) || updates.width <= 0)) {
      throw new Error(`[StateManager] Artboard width debe ser positivo: ${updates.width}`);
    }
    if (updates.height !== undefined && (!Number.isFinite(updates.height) || updates.height <= 0)) {
      throw new Error(`[StateManager] Artboard height debe ser positivo: ${updates.height}`);
    }

    const updatedArtboard: Artboard = Object.freeze({
      ...currentArtboards[index],
      ...updates,
    });

    const nextArtboards = [
      ...currentArtboards.slice(0, index),
      updatedArtboard,
      ...currentArtboards.slice(index + 1),
    ];

    // Si se actualizó la mesa en (0,0) y es la principal, mantener sincronizado el ancho/alto del documento
    const isPrimary = updatedArtboard.x === 0 && updatedArtboard.y === 0 && index === 0;
    const docWidth = isPrimary && updates.width ? updates.width : this._state.width;
    const docHeight = isPrimary && updates.height ? updates.height : this._state.height;

    this.setState({
      ...this._state,
      width: docWidth,
      height: docHeight,
      artboards: nextArtboards,
    });
  }

  /**
   * Elimina una Mesa de Trabajo. No permite eliminar si solo queda una mesa.
   */
  public removeArtboard(id: string): void {
    const currentArtboards = this.getArtboards();
    if (currentArtboards.length <= 1) {
      throw new Error('[StateManager] No se puede eliminar la única Mesa de Trabajo existente.');
    }

    const index = currentArtboards.findIndex((a) => a.id === id);
    if (index === -1) {
      return;
    }

    const nextArtboards = [
      ...currentArtboards.slice(0, index),
      ...currentArtboards.slice(index + 1),
    ];

    const nextActiveId = this._state.activeArtboardId === id
      ? nextArtboards[0]?.id
      : this._state.activeArtboardId;

    this.setState({
      ...this._state,
      artboards: nextArtboards,
      activeArtboardId: nextActiveId,
    });
  }

  /**
   * Localiza qué Mesa de Trabajo contiene las coordenadas del mundo especificadas (worldX, worldY).
   */
  public getArtboardAt(worldX: number, worldY: number): Artboard | null {
    const artboards = this.getArtboards();
    for (let i = artboards.length - 1; i >= 0; i--) {
      const ab = artboards[i];
      if (
        worldX >= ab.x &&
        worldX <= ab.x + ab.width &&
        worldY >= ab.y &&
        worldY <= ab.y + ab.height
      ) {
        return ab;
      }
    }
    return null;
  }

  /**
   * Vincula una instancia de CommandManager para permitir la invalidación automática
   * del historial de operaciones al cargar un nuevo estado.
   */
  public setCommandManager(commandManager: CommandManager | null): void {
    this.commandManager = commandManager;
  }

  /**
   * Reemplaza por completo el árbol de estado actual (_state) con el newState provisto.
   * Limpia completamente la selección dejándola vacía, marca la bandera _isDirty = true,
   * invalida el historial de comandos en CommandManager y llama a notify() para forzar
   * la actualización de suscriptores y el repintado.
   *
   * @param newState Nuevo Document raíz a cargar
   * @param commandManager Opcional: instancia de CommandManager a invalidar si no fue inyectada previamente
   */
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

    // Al cargar un documento nuevo, la selección queda siempre vacía
    this._selectedIds = Object.freeze([]);
    this._selectedSet = new Set();
    this._activeLayerId = this._state.children[0]?.id ?? null;

    this.notify();
  }

  /**
   * Suscribe un listener a los cambios de estado.
   * Retorna una función para cancelar la suscripción.
   */
  public subscribe(listener: StateListener): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  /**
   * Notifica a todos los oyentes registrados con el nuevo estado.
   */
  private notify(): void {
    for (const listener of this._listeners) {
      listener(this._state);
    }
  }

  /**
   * Actualiza el estado de forma inmutable y notifica a los suscriptores.
   */
  private setState(nextState: Document): void {
    this._isDirty = true;
    this._state = deepFreeze(nextState);

    // Si el índice espacial estaba instanciado pero no se sincronizó incrementalmente con este documento
    if (this._spatialIndex && this._spatialIndex.lastDocument !== this._state) {
      this._spatialIndex = null;
    }

    // Purgar IDs seleccionados que ya no existan en nextState
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

  /**
   * Busca un nodo por su identificador único en O(1).
   */
  public findNode(id: string): SceneNode | null {
    const index = getDocumentIndex(this._state);
    return index.nodeMap.get(id) ?? null;
  }

  /**
   * Encuentra el nodo contenedor padre del elemento solicitado en O(1).
   */
  public findParent(childId: string): ParentNode | null {
    const index = getDocumentIndex(this._state);
    return index.parentMap.get(childId) ?? null;
  }

  /**
   * Helper privado para reconstrucción inmutable de la jerarquía de grupos/capas.
   * Aplica una transformación sobre los hijos de `targetParentId`, preservando
   * la identidad estructural de todas las ramas no modificadas.
   */
  private updateHierarchy(
    targetParentId: string,
    action: (children: readonly LayerChildNode[]) => readonly LayerChildNode[]
  ): Document | null {
    function updateChildren(
      containerId: string,
      children: readonly LayerChildNode[]
    ): { updatedChildren: readonly LayerChildNode[]; changed: boolean } {
      if (containerId === targetParentId) {
        const next = action(children);
        return { updatedChildren: next, changed: next !== children };
      }

      let changed = false;
      const nextChildren: LayerChildNode[] = [];
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (isGroup(child)) {
          const res = updateChildren(child.id, child.children);
          if (res.changed) {
            changed = true;
            nextChildren.push({ ...child, children: res.updatedChildren });
            continue;
          }
        }
        nextChildren.push(child);
      }

      return { updatedChildren: changed ? nextChildren : children, changed };
    }

    let docChanged = false;
    const nextLayers: Layer[] = [];
    for (let i = 0; i < this._state.children.length; i++) {
      const layer = this._state.children[i];
      const res = updateChildren(layer.id, layer.children);
      if (res.changed) {
        docChanged = true;
        nextLayers.push({ ...layer, children: res.updatedChildren });
      } else {
        nextLayers.push(layer);
      }
    }

    return docChanged ? { ...this._state, children: nextLayers } : null;
  }

  /**
   * Agrega un nodo hijo (Layer, Group o Shape) dentro del nodo padre especificado.
   * Mantiene la inmutabilidad creando nuevas referencias solo en el camino afectado.
   *
   * @param parentId ID del nodo padre contenedor (Document para Layers; Layer o Group para Shapes/Groups)
   * @param node Nodo a agregar
   * @param index Posición opcional en el array de hijos (por defecto al final)
   */
  public addNode(parentId: string, node: Layer | LayerChildNode, index?: number): void {
    const parent = this.findNode(parentId);

    if (!parent) {
      throw new Error(`[StateManager] Nodo padre con id "${parentId}" no fue encontrado.`);
    }

    // Regla 1: Un Document solo puede tener Layers como hijos directos
    if (isDocument(parent)) {
      if (!isLayer(node)) {
        throw new Error(
          `[StateManager] Un nodo de tipo "${node.type}" no puede agregarse directamente al Document. Solo se admiten capas (Layer).`
        );
      }

      const updatedChildren = insertAt(parent.children, node, index);
      const nextState: Document = {
        ...parent,
        children: updatedChildren,
      };

      this.setState(nextState);
      return;
    }

    // Regla 2: Un Layer o Group puede tener Shapes o Groups como hijos directos
    if (isLayer(parent) || isGroup(parent)) {
      if (!isSelectable(node)) {
        throw new Error(
          `[StateManager] Un nodo de tipo "${node.type}" no puede agregarse a un contenedor ${parent.type}. Solo se admiten figuras (Shape) o grupos (Group).`
        );
      }

      const nextState = this.updateHierarchy(parent.id, (children) => insertAt(children, node, index));
      if (nextState) {
        if (this._spatialIndex) {
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
      return;
    }

    throw new Error(
      `[StateManager] El nodo "${parentId}" es de tipo "${parent.type}" y no admite nodos hijos.`
    );
  }

  /**
   * Elimina un nodo (Layer, Group o Shape) a partir de su ID.
   * NO poda grupos por sí mismo (ajuste de diseño 1).
   * Retorna true si el elemento fue encontrado y eliminado, o false en caso contrario.
   *
   * @param nodeId ID del nodo a eliminar
   */
  public removeNode(nodeId: string): boolean {
    if (nodeId === this._state.id) {
      throw new Error('[StateManager] No se puede eliminar el nodo raíz Document.');
    }

    const parent = this.findParent(nodeId);
    if (!parent) {
      return false;
    }

    if (isDocument(parent)) {
      const index = parent.children.findIndex((layer) => layer.id === nodeId);
      if (index === -1) return false;

      const nextLayers = removeAt(parent.children, index);
      const nextState: Document = {
        ...parent,
        children: nextLayers,
      };

      this.setState(nextState);
      return true;
    }

    const nextState = this.updateHierarchy(parent.id, (children) => {
      const index = children.findIndex((c) => c.id === nodeId);
      if (index === -1) return children;
      return removeAt(children, index);
    });

    if (nextState) {
      if (this._spatialIndex) {
        this._spatialIndex.removeNode(nodeId, nextState);
      }
      this.setState(nextState);
      return true;
    }

    return false;
  }

  /**
   * Atajo para agregar una capa al Documento.
   */
  public addLayer(layer: Layer, index?: number): void {
    this.addNode(this._state.id, layer, index);
  }

  /**
   * Atajo para eliminar una capa del Documento por ID.
   */
  public removeLayer(layerId: string): boolean {
    return this.removeNode(layerId);
  }

  /**
   * Atajo para reordenar capas en el Documento.
   */
  public reorderLayers(fromIndex: number, toIndex: number): void {
    this.reorderNodes(this._state.id, fromIndex, toIndex);
  }

  /**
   * Reordena los nodos hijos dentro del array del contenedor padre (Document, Layer o Group).
   *
   * @param parentId ID del contenedor padre
   * @param fromIndex Posición de origen del elemento
   * @param toIndex Posición de destino deseada
   */
  public reorderNodes(parentId: string, fromIndex: number, toIndex: number): void {
    const parent = this.findNode(parentId);

    if (!parent) {
      throw new Error(`[StateManager] Nodo padre con id "${parentId}" no encontrado.`);
    }

    if (isDocument(parent)) {
      const reorderedLayers = moveItem(parent.children, fromIndex, toIndex);
      if (reorderedLayers === parent.children) {
        return;
      }

      const nextState: Document = {
        ...parent,
        children: reorderedLayers,
      };

      this.setState(nextState);
      return;
    }

    const nextState = this.updateHierarchy(parent.id, (children) => moveItem(children, fromIndex, toIndex));
    if (nextState) {
      this.setState(nextState);
    }
  }

  /**
   * Mueve un nodo (Layer, Group o Shape) a un nuevo contenedor padre o posición.
   *
   * @param nodeId ID del nodo a mover
   * @param targetParentId ID del nuevo contenedor padre
   * @param targetIndex Índice opcional donde insertar el nodo
   */
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

  /**
   * Determina la lista de grupos que quedarían completamente vacíos al retirar los IDs especificados.
   * Retorna los grupos en orden ascendente (de abajo hacia arriba en la jerarquía).
   * No muta el estado del Scene Graph.
   */
  public getEmptiedAncestors(removedIds: readonly string[]): Group[] {
    const docIndex = getDocumentIndex(this._state);
    const removedSet = new Set(removedIds);
    const emptiedGroups: Group[] = [];
    const emptiedSet = new Set<string>();

    let progress = true;
    while (progress) {
      progress = false;
      for (const [id, node] of docIndex.nodeMap.entries()) {
        if (isGroup(node) && !removedSet.has(id) && !emptiedSet.has(id)) {
          const allChildrenRemoved =
            node.children.length > 0 &&
            node.children.every((c) => removedSet.has(c.id) || emptiedSet.has(c.id));
          if (allChildrenRemoved) {
            emptiedGroups.push(node);
            emptiedSet.add(id);
            progress = true;
          }
        }
      }
    }

    return emptiedGroups;
  }

  /**
   * Determina si un nodo es efectivamente visible considerando su propio flag y el de todos sus ancestros.
   */
  public isEffectivelyVisible(id: string): boolean {
    const docIndex = getDocumentIndex(this._state);
    let current: SceneNode | null = docIndex.nodeMap.get(id) ?? null;
    while (current) {
      if (current.visible === false) {
        return false;
      }
      current = docIndex.parentMap.get(current.id) ?? null;
    }
    return true;
  }

  /**
   * Determina si un nodo está efectivamente bloqueado considerando su propio flag y el de todos sus ancestros.
   */
  public isEffectivelyLocked(id: string): boolean {
    const docIndex = getDocumentIndex(this._state);
    let current: SceneNode | null = docIndex.nodeMap.get(id) ?? null;
    while (current) {
      if (current.locked === true) {
        return true;
      }
      current = docIndex.parentMap.get(current.id) ?? null;
    }
    return false;
  }

  /**
   * Modifica la visibilidad de cualquier nodo (Layer, Group o Shape) en el Scene Graph de forma inmutable.
   * Retorna true si cambió el valor de visibilidad, false si no hubo cambios o el nodo no existe.
   */
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

  /**
   * Modifica el estado de bloqueo de cualquier nodo (Layer, Group o Shape) en el Scene Graph de forma inmutable.
   * Si el nodo pasa a estar bloqueado y estaba en la selección activa (o contenía descendientes seleccionados),
   * estos son removidos de la selección.
   * Retorna true si cambió el valor de bloqueo, false si no hubo cambios o el nodo no existe.
   */
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

  /**
   * Modifica el nombre de cualquier nodo (Document, Layer, Group o Shape) en el Scene Graph de forma inmutable.
   * Retorna true si cambió el nombre, false si no hubo cambios o el nodo no existe.
   */
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

  /**
   * Obtiene el ID de la capa activa donde se insertarán nuevas figuras.
   * Si la capa activa registrada ya no existe, recae en la primera capa del documento.
   */
  public getActiveLayerId(): string {
    const doc = this._state;
    if (this._activeLayerId && doc.children.some((l) => l.id === this._activeLayerId)) {
      return this._activeLayerId;
    }
    const fallbackId = doc.children[0]?.id ?? '';
    this._activeLayerId = fallbackId || null;
    return fallbackId;
  }

  /**
   * Obtiene la capa activa del documento, o null si el documento no tiene capas.
   */
  public getActiveLayer(): Layer | null {
    const activeId = this.getActiveLayerId();
    if (!activeId) return null;
    const node = this.findNode(activeId);
    return node && isLayer(node) ? node : null;
  }

  /**
   * Establece la capa activa para la creación de elementos.
   * Retorna true si la capa existe y se configuró correctamente.
   */
  public setActiveLayerId(layerId: string): boolean {
    const node = this.findNode(layerId);
    if (!node || !isLayer(node)) {
      return false;
    }
    if (this._activeLayerId !== layerId) {
      this._activeLayerId = layerId;
      this.markDirty();
      this.notify();
    }
    return true;
  }

  /**
   * Localiza la capa raíz contenedora a la que pertenece un nodo (o retorna el mismo nodo si ya es Layer).
   */
  public findLayerOfNode(nodeId: string): Layer | null {
    const node = this.findNode(nodeId);
    if (!node) return null;
    if (isLayer(node)) return node;
    let current: ParentNode | null = this.findParent(nodeId);
    while (current) {
      if (isLayer(current)) return current;
      if (isDocument(current)) return null;
      current = this.findParent(current.id);
    }
    return null;
  }

  /**
   * Desplaza un nodo (Layer, Group o Shape) un paso hacia arriba o hacia abajo
   * en el orden de apilamiento dentro de su contenedor padre.
   * 'up': se desplaza hacia el frente (incrementa su índice).
   * 'down': se desplaza hacia el fondo (decrementa su índice).
   * Retorna true si fue desplazado, o false si ya estaba en el extremo o no se encontró.
   */
  public reorderNodeStep(nodeId: string, direction: 'up' | 'down'): boolean {
    const parent = this.findParent(nodeId);
    if (!parent) {
      return false;
    }
    let children: readonly { id: string }[] = [];
    if (isDocument(parent)) {
      children = parent.children;
    } else if (isLayer(parent) || isGroup(parent)) {
      children = parent.children;
    }
    const fromIndex = children.findIndex((c) => c.id === nodeId);
    if (fromIndex === -1) {
      return false;
    }
    const toIndex = direction === 'up' ? fromIndex + 1 : fromIndex - 1;
    if (toIndex < 0 || toIndex >= children.length) {
      return false;
    }
    this.reorderNodes(parent.id, fromIndex, toIndex);
    return true;
  }

  /**
   * Atajo para añadir una figura a una capa o grupo.
   */
  public addShape(layerOrGroupId: string, shape: Shape, index?: number): void {
    this.addNode(layerOrGroupId, shape, index);
  }

  /**
   * Atajo para eliminar una figura o grupo del Scene Graph.
   */
  public removeShape(shapeId: string): boolean {
    return this.removeNode(shapeId);
  }

  /**
   * Atajo para reordenar elementos dentro de una capa o grupo.
   */
  public reorderShapes(layerId: string, fromIndex: number, toIndex: number): void {
    this.reorderNodes(layerId, fromIndex, toIndex);
  }

  /**
   * Mueve un elemento (figura, grupo o capa) al frente de su contenedor.
   */
  public bringToFront(shapeId: string): boolean {
    const parent = this.findParent(shapeId);
    if (!parent) {
      return false;
    }

    if (isLayer(parent) || isGroup(parent)) {
      const children = parent.children;
      const currentIndex = children.findIndex((s) => s.id === shapeId);
      if (currentIndex === -1) {
        return false;
      }

      const targetChild = children[currentIndex];
      const filtered = children.filter((_, idx) => idx !== currentIndex);
      const reordered = [...filtered, targetChild];

      const updatedChildren = reordered.map((child, index) => ({
        ...child,
        zIndex: index,
      }));

      const nextState = this.updateHierarchy(parent.id, () => updatedChildren);
      if (nextState) {
        this.setState(nextState);
        return true;
      }
      return false;
    }

    if (isDocument(parent)) {
      const layers = parent.children;
      const currentIndex = layers.findIndex((l) => l.id === shapeId);
      if (currentIndex === -1) {
        return false;
      }

      const targetLayer = layers[currentIndex];
      const filtered = layers.filter((_, idx) => idx !== currentIndex);
      const reordered = [...filtered, targetLayer];

      const updatedLayers = reordered.map((layer, index) => ({
        ...layer,
        zIndex: index,
      }));

      this.setState({
        ...this._state,
        children: updatedLayers,
      });

      return true;
    }

    return false;
  }

  /**
   * Mueve un elemento (figura, grupo o capa) al fondo de su contenedor.
   */
  public sendToBack(shapeId: string): boolean {
    const parent = this.findParent(shapeId);
    if (!parent) {
      return false;
    }

    if (isLayer(parent) || isGroup(parent)) {
      const children = parent.children;
      const currentIndex = children.findIndex((s) => s.id === shapeId);
      if (currentIndex === -1) {
        return false;
      }

      const targetChild = children[currentIndex];
      const filtered = children.filter((_, idx) => idx !== currentIndex);
      const reordered = [targetChild, ...filtered];

      const updatedChildren = reordered.map((child, index) => ({
        ...child,
        zIndex: index,
      }));

      const nextState = this.updateHierarchy(parent.id, () => updatedChildren);
      if (nextState) {
        this.setState(nextState);
        return true;
      }
      return false;
    }

    if (isDocument(parent)) {
      const layers = parent.children;
      const currentIndex = layers.findIndex((l) => l.id === shapeId);
      if (currentIndex === -1) {
        return false;
      }

      const targetLayer = layers[currentIndex];
      const filtered = layers.filter((_, idx) => idx !== currentIndex);
      const reordered = [targetLayer, ...filtered];

      const updatedLayers = reordered.map((layer, index) => ({
        ...layer,
        zIndex: index,
      }));

      this.setState({
        ...this._state,
        children: updatedLayers,
      });

      return true;
    }

    return false;
  }

  /**
   * Retorna una lista inmutable con los IDs de los nodos (figuras o grupos) actualmente seleccionados.
   */
  public getSelection(): readonly string[] {
    if (this._selectedIds.length > 0) {
      const index = getDocumentIndex(this._state);
      const sanitized = this._selectedIds.filter((id) => {
        const node = index.nodeMap.get(id);
        return node !== null && node !== undefined && isSelectable(node);
      });
      if (sanitized.length !== this._selectedIds.length) {
        this._selectedIds = Object.freeze(sanitized);
        this._selectedSet = new Set(sanitized);
      }
    }
    return this._selectedIds;
  }

  /**
   * Retorna un array con los nodos seleccionables (Shape | Group) actualmente seleccionados.
   */
  public getSelectedNodes(): SelectableNode[] {
    const index = getDocumentIndex(this._state);
    const nodes: SelectableNode[] = [];
    for (const id of this._selectedIds) {
      const node = index.nodeMap.get(id);
      if (node && isSelectable(node)) {
        nodes.push(node);
      }
    }
    return nodes;
  }

  /**
   * Comprueba si un nodo con el ID dado está actualmente seleccionado.
   */
  public isSelected(id: string): boolean {
    return this._selectedSet.has(id);
  }

  /**
   * Establece la selección a partir de un array de IDs (figuras o grupos).
   *
   * Normalización de jerarquía (Ajuste de diseño 2):
   * Garantiza que no coexistan un nodo y alguno de sus ancestros.
   * Si en el conjunto coexisten un ancestro y un descendiente, el ancestro prevalece
   * y el descendiente es descartado de la selección.
   * Si se intenta seleccionar un descendiente cuyo ancestro ya está seleccionado, se ignora.
   */
  public setSelection(ids: readonly string[]): void {
    const seen = new Set<string>();
    const validIds: string[] = [];
    const index = getDocumentIndex(this._state);

    for (const id of ids) {
      if (!seen.has(id)) {
        seen.add(id);
        const node = index.nodeMap.get(id);
        if (node && isSelectable(node)) {
          validIds.push(id);
        }
      }
    }

    // Normalización: descartar descendientes si alguno de sus ancestros está en la selección
    const normalizedIds = validIds.filter(
      (id) => !validIds.some((otherId) => otherId !== id && isDescendantOf(id, otherId, index.parentMap))
    );

    // Verificar si la selección cambió
    const isSame =
      normalizedIds.length === this._selectedIds.length &&
      normalizedIds.every((id, idx) => id === this._selectedIds[idx]);

    if (isSame) {
      return;
    }

    this._selectedIds = Object.freeze(normalizedIds);
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

  /**
   * Wrapper de compatibilidad para selección única.
   */
  public selectNode(targetNodeId: string | null): void {
    this.setSelection(targetNodeId ? [targetNodeId] : []);
  }

  /**
   * Wrapper de compatibilidad: retorna el primer nodo seleccionado o null si no hay ninguno.
   */
  public getSelectedNode(): SelectableNode | null {
    return this.getSelectedNodes()[0] ?? null;
  }

  /**
   * Conmuta la presencia de un nodo (figura o grupo) en la selección activa.
   * Si ya está seleccionado, lo remueve.
   * Si no está seleccionado:
   * - Si un ancestro ya está seleccionado, se ignora (comportamiento normalizado).
   * - Si el nodo es ancestro de elementos seleccionados, se descartan esos descendientes y se añade el ancestro.
   */
  public toggleInSelection(id: string): void {
    const index = getDocumentIndex(this._state);
    const node = index.nodeMap.get(id);
    if (!node || !isSelectable(node)) {
      return;
    }

    if (this.isSelected(id)) {
      this.setSelection(this._selectedIds.filter((selId) => selId !== id));
      return;
    }

    // Si un ancestro de este nodo ya está seleccionado, se ignora
    const hasSelectedAncestor = this._selectedIds.some((selId) =>
      isDescendantOf(id, selId, index.parentMap)
    );
    if (hasSelectedAncestor) {
      return;
    }

    // Si este nodo es ancestro de elementos actualmente seleccionados, descartar esos descendientes
    const remaining = this._selectedIds.filter(
      (selId) => !isDescendantOf(selId, id, index.parentMap)
    );
    this.setSelection([...remaining, id]);
  }

  /**
   * Añade una lista de IDs a la selección actual, respetando la normalización de ancestros/descendientes.
   */
  public addToSelection(ids: readonly string[]): void {
    this.setSelection([...this._selectedIds, ...ids]);
  }

  /**
   * Remueve una lista de IDs de la selección actual.
   */
  public removeFromSelection(ids: readonly string[]): void {
    const toRemove = new Set(ids);
    this.setSelection(this._selectedIds.filter((id) => !toRemove.has(id)));
  }

  /**
   * Selecciona los elementos de primer nivel de cada capa (un grupo cuenta como una unidad),
   * excluyendo aquellos efectivamente ocultos o bloqueados (Ajuste de diseño 3).
   */
  public selectAll(): void {
    const selectableIds: string[] = [];
    for (const layer of this._state.children) {
      if (layer.visible === false || layer.locked === true) {
        continue;
      }
      for (const child of layer.children) {
        if (!this.isEffectivelyVisible(child.id) || this.isEffectivelyLocked(child.id)) {
          continue;
        }
        selectableIds.push(child.id);
      }
    }
    this.setSelection(selectableIds);
  }

  /**
   * Actualiza la posición de múltiples figuras hoja en UNA sola actualización de estado
   * y emite UNA sola notificación a los suscriptores.
   * Recibe posiciones absolutas SOLO de figuras hoja (Shape). Reconstruye de forma inmutable
   * toda la cadena de grupos hacia arriba compartiendo referencias de lo no modificado.
   *
   * @param entries Array de actualizaciones { id, x, y } de figuras hoja
   * @returns true si al menos una figura cambió de posición, false en caso contrario
   */
  public updateShapesPosition(entries: readonly ShapePositionEntry[]): boolean {
    if (!entries || entries.length === 0) {
      return false;
    }

    const posMap = new Map<string, { x: number; y: number }>();
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      posMap.set(entry.id, { x: entry.x, y: entry.y });
    }

    const docIndex = getDocumentIndex(this._state);
    const affectedLayerIds = new Set<string>();

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      let current: ParentNode | undefined = docIndex.parentMap.get(entry.id);
      while (current && current.type !== 'layer') {
        current = docIndex.parentMap.get(current.id);
      }
      if (current && isLayer(current)) {
        affectedLayerIds.add(current.id);
      }
    }

    if (affectedLayerIds.size === 0) {
      return false;
    }

    let anyMoved = false;

    function updateTree(children: readonly LayerChildNode[]): { updated: readonly LayerChildNode[]; changed: boolean } {
      let changed = false;
      const nextChildren: LayerChildNode[] = new Array(children.length);

      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (isGroup(child)) {
          const res = updateTree(child.children);
          if (res.changed) {
            changed = true;
            nextChildren[i] = {
              ...child,
              children: res.updated,
            };
          } else {
            nextChildren[i] = child;
          }
        } else if (isShape(child)) {
          const targetPos = posMap.get(child.id);
          if (!targetPos || (child.x === targetPos.x && child.y === targetPos.y)) {
            nextChildren[i] = child;
            continue;
          }

          changed = true;
          anyMoved = true;

          if (child.type === 'path') {
            const dx = targetPos.x - child.x;
            const dy = targetPos.y - child.y;
            const pts = child.points;
            const pLen = pts.length;
            const updatedPoints = new Array(pLen);
            for (let p = 0; p < pLen; p++) {
              const pt = pts[p];
              updatedPoints[p] = {
                ...pt,
                x: pt.x + dx,
                y: pt.y + dy,
                handleIn: pt.handleIn ? { x: pt.handleIn.x + dx, y: pt.handleIn.y + dy } : undefined,
                handleOut: pt.handleOut ? { x: pt.handleOut.x + dx, y: pt.handleOut.y + dy } : undefined,
              };
            }
            nextChildren[i] = {
              ...child,
              x: targetPos.x,
              y: targetPos.y,
              points: updatedPoints,
            };
          } else {
            nextChildren[i] = {
              ...child,
              x: targetPos.x,
              y: targetPos.y,
            };
          }
        } else {
          nextChildren[i] = child;
        }
      }

      return { updated: changed ? nextChildren : children, changed };
    }

    const layers = this._state.children;
    const nextLayers: Layer[] = new Array(layers.length);

    for (let l = 0; l < layers.length; l++) {
      const layer = layers[l];
      if (!affectedLayerIds.has(layer.id)) {
        nextLayers[l] = layer;
        continue;
      }

      const res = updateTree(layer.children);
      if (res.changed) {
        nextLayers[l] = {
          ...layer,
          children: res.updated,
        };
      } else {
        nextLayers[l] = layer;
      }
    }

    if (!anyMoved) {
      return false;
    }

    const nextState: Document = {
      ...this._state,
      children: nextLayers,
    };

    if (this._spatialIndex) {
      this._spatialIndex.updateShapesPositions(entries, nextState);
    }

    this.setState(nextState);

    return true;
  }

  /**
   * Actualiza la posición (x, y) de una figura en el Scene Graph de forma inmutable.
   */
  public updateShapePosition(shapeId: string, x: number, y: number): boolean {
    return this.updateShapesPosition([{ id: shapeId, x, y }]);
  }

  /**
   * Actualiza las dimensiones espaciales, radios, rotación y/o puntos de múltiples figuras
   * en UNA sola actualización inmutable y emite UNA sola notificación a los suscriptores.
   * Utiliza estructura compartida (structural sharing) para ramas y capas no afectadas.
   *
   * @param entries Colección de { id, dimensions } para figuras hoja
   * @returns true si al menos una figura cambió efectivamente, false en caso contrario
   */
  public updateShapesDimensions(entries: readonly ShapeDimensionsEntry[]): boolean {
    if (!entries || entries.length === 0) {
      return false;
    }

    const dimMap = new Map<string, ShapeDimensions>();
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      dimMap.set(entry.id, entry.dimensions);
    }

    const docIndex = getDocumentIndex(this._state);
    const affectedLayerIds = new Set<string>();

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      let current: ParentNode | undefined = docIndex.parentMap.get(entry.id);
      while (current && current.type !== 'layer') {
        current = docIndex.parentMap.get(current.id);
      }
      if (current && isLayer(current)) {
        affectedLayerIds.add(current.id);
      }
    }

    if (affectedLayerIds.size === 0) {
      return false;
    }

    let anyChanged = false;

    function updateTree(children: readonly LayerChildNode[]): { updated: readonly LayerChildNode[]; changed: boolean } {
      let changed = false;
      const nextChildren: LayerChildNode[] = new Array(children.length);

      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (isGroup(child)) {
          const res = updateTree(child.children);
          if (res.changed) {
            changed = true;
            nextChildren[i] = { ...child, children: res.updated };
          } else {
            nextChildren[i] = child;
          }
        } else if (isShape(child)) {
          const dimensions = dimMap.get(child.id);
          if (!dimensions) {
            nextChildren[i] = child;
            continue;
          }

          let shapeChanged = false;
          let newShape: Shape = child;

          if (child.type === 'rectangle') {
            const nextX = dimensions.x !== undefined ? dimensions.x : child.x;
            const nextY = dimensions.y !== undefined ? dimensions.y : child.y;
            const nextW =
              dimensions.width !== undefined
                ? dimensions.width
                : dimensions.radiusX !== undefined
                ? dimensions.radiusX * 2
                : child.width;
            const nextH =
              dimensions.height !== undefined
                ? dimensions.height
                : dimensions.radiusY !== undefined
                ? dimensions.radiusY * 2
                : child.height;
            const nextRot = dimensions.rotation !== undefined ? dimensions.rotation : child.rotation;
            const hasCornerRadius = 'cornerRadius' in dimensions;
            const nextCornerRadius = hasCornerRadius ? dimensions.cornerRadius : child.cornerRadius;

            if (
              nextX !== child.x ||
              nextY !== child.y ||
              nextW !== child.width ||
              nextH !== child.height ||
              nextRot !== child.rotation ||
              (hasCornerRadius && nextCornerRadius !== child.cornerRadius)
            ) {
              shapeChanged = true;
              const rectBase: Rectangle = {
                ...child,
                x: nextX,
                y: nextY,
                width: nextW,
                height: nextH,
                ...(nextRot !== undefined ? { rotation: nextRot } : {}),
              };
              if (hasCornerRadius) {
                if (nextCornerRadius !== undefined) {
                  newShape = { ...rectBase, cornerRadius: nextCornerRadius };
                } else {
                  const { cornerRadius: _, ...rest } = rectBase;
                  newShape = rest as Rectangle;
                }
              } else {
                newShape = rectBase;
              }
            }
          } else if (child.type === 'ellipse') {
            const nextX = dimensions.x !== undefined ? dimensions.x : child.x;
            const nextY = dimensions.y !== undefined ? dimensions.y : child.y;
            const nextRx =
              dimensions.radiusX !== undefined
                ? dimensions.radiusX
                : dimensions.width !== undefined
                ? dimensions.width / 2
                : child.radiusX;
            const nextRy =
              dimensions.radiusY !== undefined
                ? dimensions.radiusY
                : dimensions.height !== undefined
                ? dimensions.height / 2
                : child.radiusY;
            const nextRot = dimensions.rotation !== undefined ? dimensions.rotation : child.rotation;

            if (
              nextX !== child.x ||
              nextY !== child.y ||
              nextRx !== child.radiusX ||
              nextRy !== child.radiusY ||
              nextRot !== child.rotation
            ) {
              shapeChanged = true;
              newShape = {
                ...child,
                x: nextX,
                y: nextY,
                radiusX: nextRx,
                radiusY: nextRy,
                ...(nextRot !== undefined ? { rotation: nextRot } : {}),
              };
            }
          } else if (child.type === 'path') {
            const nextX = dimensions.x !== undefined ? dimensions.x : child.x;
            const nextY = dimensions.y !== undefined ? dimensions.y : child.y;
            const nextPoints = dimensions.points !== undefined ? dimensions.points : child.points;
            const nextRot = dimensions.rotation !== undefined ? dimensions.rotation : child.rotation;
            const hasCornerRadius = 'cornerRadius' in dimensions;
            const nextCornerRadius = hasCornerRadius ? dimensions.cornerRadius : child.cornerRadius;

            const pointsDiffer = dimensions.points !== undefined && dimensions.points !== child.points;

            if (
              nextX !== child.x ||
              nextY !== child.y ||
              nextRot !== child.rotation ||
              pointsDiffer ||
              (hasCornerRadius && nextCornerRadius !== child.cornerRadius)
            ) {
              shapeChanged = true;
              const pathBase: Path = {
                ...child,
                x: nextX,
                y: nextY,
                points: nextPoints,
                ...(nextRot !== undefined ? { rotation: nextRot } : {}),
              };
              if (hasCornerRadius) {
                if (nextCornerRadius !== undefined) {
                  newShape = { ...pathBase, cornerRadius: nextCornerRadius };
                } else {
                  const { cornerRadius: _, ...rest } = pathBase;
                  newShape = rest as Path;
                }
              } else {
                newShape = pathBase;
              }
            }
          } else if (child.type === 'text') {
            const nextX = dimensions.x !== undefined ? dimensions.x : child.x;
            const nextY = dimensions.y !== undefined ? dimensions.y : child.y;
            const nextRot = dimensions.rotation !== undefined ? dimensions.rotation : child.rotation;
            const nextFontSize = dimensions.fontSize !== undefined ? dimensions.fontSize : child.fontSize;
            const nextLineHeight = dimensions.lineHeight !== undefined ? dimensions.lineHeight : child.lineHeight;
            const nextLetterSpacing = dimensions.letterSpacing !== undefined ? dimensions.letterSpacing : child.letterSpacing;
            const hasBoxWidth = 'boxWidth' in dimensions;
            const nextBoxWidth = hasBoxWidth ? dimensions.boxWidth : child.boxWidth;

            if (
              nextX !== child.x ||
              nextY !== child.y ||
              nextRot !== child.rotation ||
              (dimensions.fontSize !== undefined && nextFontSize !== child.fontSize) ||
              (dimensions.lineHeight !== undefined && nextLineHeight !== child.lineHeight) ||
              (dimensions.letterSpacing !== undefined && nextLetterSpacing !== child.letterSpacing) ||
              (hasBoxWidth && nextBoxWidth !== child.boxWidth)
            ) {
              shapeChanged = true;
              const textBase = {
                ...child,
                x: nextX,
                y: nextY,
                ...(nextRot !== undefined ? { rotation: nextRot } : {}),
                ...(nextFontSize !== undefined ? { fontSize: nextFontSize } : {}),
                ...(nextLineHeight !== undefined ? { lineHeight: nextLineHeight } : {}),
                ...(nextLetterSpacing !== undefined ? { letterSpacing: nextLetterSpacing } : {}),
              };
              if (hasBoxWidth) {
                if (nextBoxWidth !== undefined) {
                  newShape = { ...textBase, boxWidth: nextBoxWidth };
                } else {
                  const { boxWidth: _, ...withoutBoxWidth } = textBase;
                  newShape = withoutBoxWidth as Text;
                }
              } else {
                newShape = textBase;
              }
            }
          } else if (child.type === 'image') {
            const nextX = dimensions.x !== undefined ? dimensions.x : child.x;
            const nextY = dimensions.y !== undefined ? dimensions.y : child.y;
            const nextW = dimensions.width !== undefined ? dimensions.width : child.width;
            const nextH = dimensions.height !== undefined ? dimensions.height : child.height;
            const nextRot = dimensions.rotation !== undefined ? dimensions.rotation : child.rotation;

            if (
              nextX !== child.x ||
              nextY !== child.y ||
              nextW !== child.width ||
              nextH !== child.height ||
              nextRot !== child.rotation
            ) {
              shapeChanged = true;
              newShape = {
                ...child,
                x: nextX,
                y: nextY,
                width: nextW,
                height: nextH,
                ...(nextRot !== undefined ? { rotation: nextRot } : {}),
              };
            }
          } else if (child.type === 'polygon') {
            const nextX = dimensions.x !== undefined ? dimensions.x : child.x;
            const nextY = dimensions.y !== undefined ? dimensions.y : child.y;
            const nextRadius =
              dimensions.radius !== undefined
                ? dimensions.radius
                : dimensions.width !== undefined
                ? dimensions.width / 2
                : dimensions.radiusX !== undefined
                ? dimensions.radiusX
                : child.radius;
            const nextSides = dimensions.sides !== undefined ? dimensions.sides : child.sides;
            const nextRot = dimensions.rotation !== undefined ? dimensions.rotation : child.rotation;
            const hasCornerRadius = 'cornerRadius' in dimensions;
            const nextCornerRadius = hasCornerRadius ? dimensions.cornerRadius : child.cornerRadius;

            if (
              nextX !== child.x ||
              nextY !== child.y ||
              nextRadius !== child.radius ||
              nextSides !== child.sides ||
              nextRot !== child.rotation ||
              (hasCornerRadius && nextCornerRadius !== child.cornerRadius)
            ) {
              shapeChanged = true;
              const polyBase: Polygon = {
                ...child,
                x: nextX,
                y: nextY,
                radius: nextRadius,
                sides: nextSides,
                ...(nextRot !== undefined ? { rotation: nextRot } : {}),
              };
              if (hasCornerRadius) {
                if (nextCornerRadius !== undefined) {
                  newShape = { ...polyBase, cornerRadius: nextCornerRadius };
                } else {
                  const { cornerRadius: _, ...rest } = polyBase;
                  newShape = rest as Polygon;
                }
              } else {
                newShape = polyBase;
              }
            }
          } else if (child.type === 'star') {
            const nextX = dimensions.x !== undefined ? dimensions.x : child.x;
            const nextY = dimensions.y !== undefined ? dimensions.y : child.y;
            const nextOuter =
              dimensions.outerRadius !== undefined
                ? dimensions.outerRadius
                : dimensions.width !== undefined
                ? dimensions.width / 2
                : dimensions.radiusX !== undefined
                ? dimensions.radiusX
                : child.outerRadius;
            const ratio = child.outerRadius > 0 ? child.innerRadius / child.outerRadius : 0.5;
            const nextInner =
              dimensions.innerRadius !== undefined
                ? dimensions.innerRadius
                : (dimensions.outerRadius !== undefined || dimensions.width !== undefined || dimensions.radiusX !== undefined)
                ? nextOuter * ratio
                : child.innerRadius;
            const nextPoints = dimensions.starPoints !== undefined ? dimensions.starPoints : child.points;
            const nextRot = dimensions.rotation !== undefined ? dimensions.rotation : child.rotation;
            const hasCornerRadius = 'cornerRadius' in dimensions;
            const nextCornerRadius = hasCornerRadius ? dimensions.cornerRadius : child.cornerRadius;
            const hasInnerCornerRadius = 'innerCornerRadius' in dimensions;
            const nextInnerCornerRadius = hasInnerCornerRadius ? dimensions.innerCornerRadius : child.innerCornerRadius;

            if (
              nextX !== child.x ||
              nextY !== child.y ||
              nextOuter !== child.outerRadius ||
              nextInner !== child.innerRadius ||
              nextPoints !== child.points ||
              nextRot !== child.rotation ||
              (hasCornerRadius && nextCornerRadius !== child.cornerRadius) ||
              (hasInnerCornerRadius && nextInnerCornerRadius !== child.innerCornerRadius)
            ) {
              shapeChanged = true;
              const starBase: Star = {
                ...child,
                x: nextX,
                y: nextY,
                outerRadius: nextOuter,
                innerRadius: nextInner,
                points: nextPoints,
                ...(nextRot !== undefined ? { rotation: nextRot } : {}),
              };
              let sTemp = starBase;
              if (hasCornerRadius) {
                if (nextCornerRadius !== undefined) {
                  sTemp = { ...sTemp, cornerRadius: nextCornerRadius };
                } else {
                  const { cornerRadius: _, ...rest } = sTemp;
                  sTemp = rest as Star;
                }
              }
              if (hasInnerCornerRadius) {
                if (nextInnerCornerRadius !== undefined) {
                  sTemp = { ...sTemp, innerCornerRadius: nextInnerCornerRadius };
                } else {
                  const { innerCornerRadius: _, ...rest } = sTemp;
                  sTemp = rest as Star;
                }
              }
              newShape = sTemp;
            }
          }

          if (shapeChanged) {
            changed = true;
            anyChanged = true;
            nextChildren[i] = newShape;
          } else {
            nextChildren[i] = child;
          }
        } else {
          nextChildren[i] = child;
        }
      }

      return { updated: changed ? nextChildren : children, changed };
    }

    const layers = this._state.children;
    const nextLayers: Layer[] = new Array(layers.length);

    for (let l = 0; l < layers.length; l++) {
      const layer = layers[l];
      if (!affectedLayerIds.has(layer.id)) {
        nextLayers[l] = layer;
        continue;
      }

      const res = updateTree(layer.children);
      if (res.changed) {
        nextLayers[l] = {
          ...layer,
          children: res.updated,
        };
      } else {
        nextLayers[l] = layer;
      }
    }

    if (!anyChanged) {
      return false;
    }

    const nextState: Document = {
      ...this._state,
      children: nextLayers,
    };

    if (this._spatialIndex) {
      this._spatialIndex.updateShapesDimensions(entries, nextState);
    }

    this.setState(nextState);

    return true;
  }

  /**
   * Actualiza el estilo (fill, stroke, strokeWidth) de múltiples figuras en el Scene Graph
   * en UNA sola actualización inmutable y emite UNA sola notificación a los suscriptores.
   * Utiliza persistencia estructural (recorrido único) para ramas y capas no afectadas.
   * Funciona con figuras dentro de grupos anidados.
   *
   * @param entries Array de { id, style } con estilo parcial
   * @returns true si al menos una figura cambió efectivamente de estilo, false si nada cambia
   */
  public updateShapesStyle(entries: readonly ShapeStyleEntry[]): boolean {
    if (!entries || entries.length === 0) {
      return false;
    }

    const styleMap = new Map<string, ShapeStyleUpdate>();
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      styleMap.set(entry.id, entry.style);
    }

    const docIndex = getDocumentIndex(this._state);
    const affectedLayerIds = new Set<string>();

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      let current: ParentNode | undefined = docIndex.parentMap.get(entry.id);
      while (current && current.type !== 'layer') {
        current = docIndex.parentMap.get(current.id);
      }
      if (current && isLayer(current)) {
        affectedLayerIds.add(current.id);
      }
    }

    if (affectedLayerIds.size === 0) {
      return false;
    }

    let anyChanged = false;

    function updateTree(children: readonly LayerChildNode[]): { updated: readonly LayerChildNode[]; changed: boolean } {
      let changed = false;
      const nextChildren: LayerChildNode[] = new Array(children.length);

      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (isGroup(child)) {
          const res = updateTree(child.children);
          if (res.changed) {
            changed = true;
            nextChildren[i] = { ...child, children: res.updated };
          } else {
            nextChildren[i] = child;
          }
        } else if (isShape(child)) {
          const targetStyle = styleMap.get(child.id);
          if (!targetStyle) {
            nextChildren[i] = child;
            continue;
          }

          const isDashEqual = (a?: readonly number[], b?: readonly number[]) => {
            if (!a && !b) return true;
            if (!a || !b) return false;
            if (a.length !== b.length) return false;
            return a.every((v, idx) => v === b[idx]);
          };

          const hasFillChange = targetStyle.fill !== undefined && !isPaintEqual(targetStyle.fill, child.fill);
          const childStroke = 'stroke' in child ? (child as { stroke?: FillType }).stroke : undefined;
          const childStrokeWidth = 'strokeWidth' in child ? (child as { strokeWidth?: number }).strokeWidth : undefined;
          const hasStrokeChange = targetStyle.stroke !== undefined && !isPaintEqual(targetStyle.stroke, childStroke);
          const hasStrokeWidthChange =
            targetStyle.strokeWidth !== undefined && targetStyle.strokeWidth !== childStrokeWidth;
          const hasOpacityChange = targetStyle.opacity !== undefined && targetStyle.opacity !== child.opacity;
          const hasDashChange = 'strokeDashArray' in targetStyle && !isDashEqual(targetStyle.strokeDashArray, child.strokeDashArray);
          const hasCapChange = 'strokeLineCap' in targetStyle && targetStyle.strokeLineCap !== child.strokeLineCap;
          const hasJoinChange = 'strokeLineJoin' in targetStyle && targetStyle.strokeLineJoin !== child.strokeLineJoin;
          const hasBlendModeChange = 'blendMode' in targetStyle && targetStyle.blendMode !== child.blendMode;
          const hasShadowChange = 'dropShadow' in targetStyle && !isDropShadowEqual(targetStyle.dropShadow, child.dropShadow);

          if (
            !hasFillChange &&
            !hasStrokeChange &&
            !hasStrokeWidthChange &&
            !hasOpacityChange &&
            !hasDashChange &&
            !hasCapChange &&
            !hasJoinChange &&
            !hasBlendModeChange &&
            !hasShadowChange
          ) {
            nextChildren[i] = child;
            continue;
          }

          changed = true;
          anyChanged = true;
          let styledChild: Shape = {
            ...child,
            ...(targetStyle.fill !== undefined ? { fill: targetStyle.fill } : {}),
            ...(targetStyle.stroke !== undefined ? { stroke: targetStyle.stroke } : {}),
            ...(targetStyle.strokeWidth !== undefined ? { strokeWidth: targetStyle.strokeWidth } : {}),
            ...(targetStyle.opacity !== undefined ? { opacity: targetStyle.opacity } : {}),
            ...('blendMode' in targetStyle ? { blendMode: targetStyle.blendMode } : {}),
            ...('strokeDashArray' in targetStyle ? { strokeDashArray: targetStyle.strokeDashArray } : {}),
            ...('strokeLineCap' in targetStyle ? { strokeLineCap: targetStyle.strokeLineCap } : {}),
            ...('strokeLineJoin' in targetStyle ? { strokeLineJoin: targetStyle.strokeLineJoin } : {}),
          };

          if ('dropShadow' in targetStyle) {
            if (targetStyle.dropShadow === null) {
              const { dropShadow: _, ...withoutShadow } = styledChild;
              styledChild = withoutShadow as Shape;
            } else if (targetStyle.dropShadow !== undefined) {
              styledChild = { ...styledChild, dropShadow: targetStyle.dropShadow };
            }
          }

          nextChildren[i] = styledChild;
        } else {
          nextChildren[i] = child;
        }
      }

      return { updated: changed ? nextChildren : children, changed };
    }

    const layers = this._state.children;
    const nextLayers: Layer[] = new Array(layers.length);

    for (let l = 0; l < layers.length; l++) {
      const layer = layers[l];
      if (!affectedLayerIds.has(layer.id)) {
        nextLayers[l] = layer;
        continue;
      }

      const res = updateTree(layer.children);
      if (res.changed) {
        nextLayers[l] = {
          ...layer,
          children: res.updated,
        };
      } else {
        nextLayers[l] = layer;
      }
    }

    if (!anyChanged) {
      return false;
    }

    this.setState({
      ...this._state,
      children: nextLayers,
    });

    return true;
  }

  /**
   * Actualiza las dimensiones espaciales y/o radios de una figura existente (incluso dentro de grupos).
   */
  public updateShapeDimensions(shapeId: string, dimensions: ShapeDimensions): boolean {
    return this.updateShapesDimensions([{ id: shapeId, dimensions }]);
  }

  /**
   * Actualiza propiedades de una figura existente en el Scene Graph de forma inmutable.
   */
  public updateShape(shapeId: string, updater: Partial<Shape>): boolean;
  public updateShape<T extends Shape>(shapeId: string, updater: Partial<T> | ((current: T) => T)): boolean;
  public updateShape<T extends Shape>(shapeId: string, updater: Partial<Shape> | Partial<T> | ((current: T) => T)): boolean {
    let updated = false;

    function updateTree(children: readonly LayerChildNode[]): { updated: readonly LayerChildNode[]; changed: boolean } {
      let changed = false;
      const nextChildren: LayerChildNode[] = new Array(children.length);

      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (isGroup(child)) {
          const res = updateTree(child.children);
          if (res.changed) {
            changed = true;
            nextChildren[i] = { ...child, children: res.updated };
          } else {
            nextChildren[i] = child;
          }
        } else if (isShape(child) && child.id === shapeId) {
          changed = true;
          updated = true;
          const nextVal = (typeof updater === 'function' ? updater(child as T) : { ...child, ...updater }) as Shape;
          nextChildren[i] = nextVal;
        } else {
          nextChildren[i] = child;
        }
      }

      return { updated: changed ? nextChildren : children, changed };
    }

    const nextLayers = this._state.children.map((layer) => {
      const res = updateTree(layer.children);
      if (res.changed) {
        return {
          ...layer,
          children: res.updated,
        };
      }
      return layer;
    });

    if (updated) {
      this.setState({
        ...this._state,
        children: nextLayers,
      });
    }

    return updated;
  }

  /**
   * Inserta un nuevo punto de ancla en un segmento de un trazado existente subdividiéndolo con De Casteljau.
   */
  public insertPathPoint(
    pathId: string,
    segmentIndex: number,
    t: number
  ): { pointIndex: number; newPoint: PathPoint } | null {
    const target = this.findNode(pathId);
    if (!target || target.type !== 'path') {
      return null;
    }
    const path = target as Path;
    const nextPoints = splitPathSegment(path, segmentIndex, t);
    if (nextPoints === path.points) {
      return null;
    }
    const insertedIndex = segmentIndex < path.points.length - 1 ? segmentIndex + 1 : nextPoints.length - 1;
    this.updateShape<Path>(pathId, { points: nextPoints });
    return {
      pointIndex: insertedIndex,
      newPoint: nextPoints[insertedIndex],
    };
  }

  /**
   * Elimina uno o más vértices de un trazado existente y reconecta los segmentos adyacentes.
   */
  public deletePathPoints(pathId: string, indices: readonly number[]): boolean {
    const target = this.findNode(pathId);
    if (!target || target.type !== 'path') {
      return false;
    }
    const path = target as Path;
    const nextPoints = deletePathPointsFromPath(path, indices);
    if (!nextPoints) {
      return false;
    }
    return this.updateShape<Path>(pathId, { points: nextPoints });
  }

  /**
   * Actualiza el tipo de vértice (corner, smooth, symmetric) de uno o varios puntos de ancla de un trazado.
   */
  public setPathPointType(
    pathId: string,
    indices: readonly number[],
    pointType: PathPointType
  ): boolean {
    const target = this.findNode(pathId);
    if (!target || target.type !== 'path') {
      return false;
    }
    const path = target as Path;
    const indicesSet = new Set(indices);
    const n = path.points.length;
    const nextPoints = path.points.map((pt, i) => {
      if (!indicesSet.has(i)) {
        return pt;
      }
      const prev = path.closed ? path.points[(i - 1 + n) % n] : (i > 0 ? path.points[i - 1] : undefined);
      const next = path.closed ? path.points[(i + 1) % n] : (i < n - 1 ? path.points[i + 1] : undefined);
      return applyPointType(pt, pointType, prev, next);
    });
    return this.updateShape<Path>(pathId, { points: nextPoints });
  }

  /**
   * Actualiza el radio de redondeo (cornerRadius) de uno o varios puntos de ancla de un trazado.
   */
  public setPathPointCornerRadius(
    pathId: string,
    indices: readonly number[],
    cornerRadius?: number
  ): boolean {
    const target = this.findNode(pathId);
    if (!target || target.type !== 'path') {
      return false;
    }
    const path = target as Path;
    const indicesSet = new Set(indices);
    const radiusVal = cornerRadius !== undefined && cornerRadius > 0 ? cornerRadius : undefined;
    let anyChanged = false;
    const nextPoints = path.points.map((pt, i) => {
      if (!indicesSet.has(i)) {
        return pt;
      }
      if (pt.cornerRadius === radiusVal) {
        return pt;
      }
      anyChanged = true;
      const updated: PathPoint = { ...pt };
      if (radiusVal !== undefined) {
        return { ...updated, cornerRadius: radiusVal };
      } else {
        const { cornerRadius: _, ...withoutCR } = updated;
        return withoutCR as PathPoint;
      }
    });
    if (!anyChanged) {
      return false;
    }
    return this.updateShape<Path>(pathId, { points: nextPoints });
  }

  /**
   * Actualiza propiedades de cualquier nodo (Layer, Group o Shape) existente en el Scene Graph de forma inmutable.
   */
  public updateNode(nodeId: string, updater: Partial<SceneNode> | Record<string, unknown>): boolean {
    const docIndex = getDocumentIndex(this._state);
    const target = docIndex.nodeMap.get(nodeId);
    if (!target) {
      return false;
    }

    if (isDocument(target)) {
      this.setState({ ...this._state, ...updater } as Document);
      return true;
    }

    if (isLayer(target)) {
      const nextLayers = this._state.children.map((layer) => {
        if (layer.id === nodeId) {
          return { ...layer, ...updater } as Layer;
        }
        return layer;
      });
      this.setState({ ...this._state, children: nextLayers });
      return true;
    }

    let updated = false;

    function updateTree(children: readonly LayerChildNode[]): { updated: readonly LayerChildNode[]; changed: boolean } {
      let changed = false;
      const nextChildren: LayerChildNode[] = new Array(children.length);

      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child.id === nodeId) {
          changed = true;
          updated = true;
          nextChildren[i] = { ...child, ...updater } as LayerChildNode;
        } else if (isGroup(child)) {
          const res = updateTree(child.children);
          if (res.changed) {
            changed = true;
            nextChildren[i] = { ...child, children: res.updated };
          } else {
            nextChildren[i] = child;
          }
        } else {
          nextChildren[i] = child;
        }
      }

      return { updated: changed ? nextChildren : children, changed };
    }

    const nextLayers = this._state.children.map((layer) => {
      const res = updateTree(layer.children);
      if (res.changed) {
        return {
          ...layer,
          children: res.updated,
        };
      }
      return layer;
    });

    if (updated) {
      this.setState({
        ...this._state,
        children: nextLayers,
      });
    }

    return updated;
  }

  /**
   * Registra un recurso AssetData a nivel de documento inmutable.
   * Si ya existe un activo con el mismo id y datos, no dispara mutación innecesaria.
   */
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

  /**
   * Obtiene un recurso AssetData registrado en el documento por su assetId.
   */
  public getAsset(assetId: string): AssetData | undefined {
    return this._state.assets?.[assetId];
  }

  /**
   * Obtiene todos los recursos registrados en el documento.
   */
  public getAssets(): Readonly<Record<string, AssetData>> {
    return this._state.assets ?? {};
  }

  // --- Gestión de Guías de Usuario y Reglas ---

  /**
   * Indica si las reglas graduadas están visibles.
   */
  public isRulersVisible(): boolean {
    return this._rulersVisible;
  }

  /**
   * Alterna o establece la visibilidad de las reglas graduadas.
   */
  public setRulersVisible(visible: boolean): void {
    if (this._rulersVisible === visible) return;
    this._rulersVisible = visible;
    this._isDirty = true;
    this.notify();
  }

  /**
   * Indica si las guías de usuario están visibles.
   */
  public isGuidesVisible(): boolean {
    return this._guidesVisible;
  }

  /**
   * Alterna o establece la visibilidad de las guías de usuario.
   */
  public setGuidesVisible(visible: boolean): void {
    if (this._guidesVisible === visible) return;
    this._guidesVisible = visible;
    this._isDirty = true;
    this.notify();
  }

  /**
   * Indica si las guías de usuario están bloqueadas contra selección o arrastre.
   */
  public isGuidesLocked(): boolean {
    return this._guidesLocked;
  }

  /**
   * Bloquea o desbloquea las guías de usuario.
   */
  public setGuidesLocked(locked: boolean): void {
    if (this._guidesLocked === locked) return;
    this._guidesLocked = locked;
    this._isDirty = true;
    this.notify();
  }

  /**
   * Indica si la imantación (snapping) a guías de usuario está habilitada.
   */
  public isGuideSnappingEnabled(): boolean {
    return this._guideSnappingEnabled;
  }

  /**
   * Activa o desactiva la imantación (snapping) a guías de usuario.
   */
  public setGuideSnappingEnabled(enabled: boolean): void {
    if (this._guideSnappingEnabled === enabled) return;
    this._guideSnappingEnabled = enabled;
    this._isDirty = true;
    this.notify();
  }

  /**
   * Obtiene la colección inmutable de guías de usuario registradas en el Documento actual.
   */
  public getGuides(): readonly Guide[] {
    return this._state.guides ?? [];
  }

  /**
   * Agrega una guía de usuario al Documento de forma inmutable.
   */
  public addGuide(guide: Guide): void {
    const currentGuides = this._state.guides ?? [];
    if (currentGuides.some((g) => g.id === guide.id)) {
      return;
    }
    const frozenGuide = Object.freeze({ ...guide });
    const nextGuides = Object.freeze([...currentGuides, frozenGuide]);
    this.setState({
      ...this._state,
      guides: nextGuides,
    });
  }

  /**
   * Elimina una guía de usuario por su identificador. Retorna la guía eliminada si existía.
   */
  public removeGuide(guideId: string): Guide | undefined {
    const currentGuides = this._state.guides ?? [];
    const index = currentGuides.findIndex((g) => g.id === guideId);
    if (index === -1) return undefined;
    const removed = currentGuides[index];
    const nextGuides = Object.freeze(removeAt(currentGuides, index));
    this.setState({
      ...this._state,
      guides: nextGuides,
    });
    return removed;
  }

  /**
   * Actualiza la posición de una guía de usuario existente. Retorna la posición previa si existía.
   */
  public updateGuide(guideId: string, position: number): number | undefined {
    const currentGuides = this._state.guides ?? [];
    const index = currentGuides.findIndex((g) => g.id === guideId);
    if (index === -1) return undefined;
    const oldGuide = currentGuides[index];
    if (oldGuide.position === position) return oldGuide.position;
    const updatedGuide = Object.freeze({ ...oldGuide, position });
    const nextGuides = Object.freeze([
      ...currentGuides.slice(0, index),
      updatedGuide,
      ...currentGuides.slice(index + 1),
    ]);
    this.setState({
      ...this._state,
      guides: nextGuides,
    });
    return oldGuide.position;
  }

  /**
   * Elimina todas las guías de usuario del Documento. Retorna la colección de guías previas.
   */
  public clearGuides(): readonly Guide[] {
    const currentGuides = this._state.guides ?? [];
    if (currentGuides.length === 0) return currentGuides;
    this.setState({
      ...this._state,
      guides: Object.freeze([]),
    });
    return currentGuides;
  }

  /**
   * Reemplaza la colección completa de guías de usuario en el Documento.
   */
  public setGuides(guides: readonly Guide[]): void {
    const frozenGuides = Object.freeze(guides.map((g) => Object.freeze({ ...g })));
    this.setState({
      ...this._state,
      guides: frozenGuides,
    });
  }
}
