import type {
  Document,
  Group,
  Layer,
  LayerChildNode,
  ParentNode,
  SceneNode,
  SelectableNode,
  Shape,
} from '../types/scene-graph.ts';
import type { ShapeDimensions } from '../commands/ResizeCommand.ts';
import type { CommandManager } from '../commands/CommandManager.ts';
import { isDocument, isGroup, isLayer, isSelectable, isShape } from '../types/scene-graph.ts';
import {
  deepFreeze,
  insertAt,
  moveItem,
  removeAt,
} from '../utils/immutable.ts';

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
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
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
  private commandManager: CommandManager | null = null;

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
    this._selectedIds = Object.freeze([]);
    this._selectedSet = new Set();
    if (commandManager) {
      this.commandManager = commandManager;
    }
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
    const cloned = structuredClone(newState);
    this._state = deepFreeze(cloned);

    // Al cargar un documento nuevo, la selección queda siempre vacía
    this._selectedIds = Object.freeze([]);
    this._selectedSet = new Set();

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

    this.setState({
      ...this._state,
      children: nextLayers,
    });

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

            const pointsDiffer = dimensions.points !== undefined && dimensions.points !== child.points;

            if (
              nextX !== child.x ||
              nextY !== child.y ||
              nextRot !== child.rotation ||
              pointsDiffer
            ) {
              shapeChanged = true;
              newShape = {
                ...child,
                x: nextX,
                y: nextY,
                points: nextPoints,
                ...(nextRot !== undefined ? { rotation: nextRot } : {}),
              };
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

    this.setState({
      ...this._state,
      children: nextLayers,
    });

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

          const hasFillChange = targetStyle.fill !== undefined && targetStyle.fill !== child.fill;
          const hasStrokeChange = targetStyle.stroke !== undefined && targetStyle.stroke !== child.stroke;
          const hasStrokeWidthChange =
            targetStyle.strokeWidth !== undefined && targetStyle.strokeWidth !== child.strokeWidth;

          if (!hasFillChange && !hasStrokeChange && !hasStrokeWidthChange) {
            nextChildren[i] = child;
            continue;
          }

          changed = true;
          anyChanged = true;
          nextChildren[i] = {
            ...child,
            ...(targetStyle.fill !== undefined ? { fill: targetStyle.fill } : {}),
            ...(targetStyle.stroke !== undefined ? { stroke: targetStyle.stroke } : {}),
            ...(targetStyle.strokeWidth !== undefined ? { strokeWidth: targetStyle.strokeWidth } : {}),
          };
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
}

