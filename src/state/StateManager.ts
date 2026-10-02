import type {
  Document,
  Layer,
  ParentNode,
  SceneNode,
  Shape,
} from '../types/scene-graph.ts';
import type { ShapeDimensions } from '../commands/ResizeCommand.ts';
import type { CommandManager } from '../commands/CommandManager.ts';
import { isDocument, isLayer, isShape } from '../types/scene-graph.ts';
import {
  deepFreeze,
  findNodeById,
  findParentOfNode,
  insertAt,
  moveItem,
  removeAt,
} from '../utils/immutable.ts';

export type StateListener = (state: Readonly<Document>) => void;

/**
 * Gestor de estado inmutable para el Scene Graph de un editor vectorial.
 * Toda modificación produce un nuevo estado a través de persistencia estructural,
 * garantizando que los objetos anteriores nunca sean mutados.
 */
export class StateManager {
  private _state: Readonly<Document>;
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
      isDirty: true,
      children: [
        {
          id: 'layer-default',
          type: 'layer',
          name: 'Capa Base',
          children: [],
        },
      ],
    };

    const initial = initialState ? { ...structuredClone(initialState), isDirty: initialState.isDirty ?? true } : defaultState;
    this._isDirty = initial.isDirty ?? true;
    this._state = deepFreeze(initial);
    if (commandManager) {
      this.commandManager = commandManager;
    }
  }

  /**
   * Indica si el estado ha cambiado y requiere redibujado (flag isDirty).
   */
  public get isDirty(): boolean {
    return this._isDirty || Boolean(this._state.isDirty);
  }

  /**
   * Marca explícitamente el estado como "sucio" para forzar un nuevo renderizado.
   */
  public markDirty(): void {
    this._isDirty = true;
    if (!this._state.isDirty) {
      this._state = deepFreeze({
        ...this._state,
        isDirty: true,
      });
    }
  }

  /**
   * Limpia el flag isDirty tras completar un ciclo de dibujado.
   */
  public clearDirty(): void {
    this._isDirty = false;
    if (this._state.isDirty) {
      this._state = deepFreeze({
        ...this._state,
        isDirty: false,
      });
    }
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
   * Marca la bandera _isDirty = true, invalida el historial de comandos en CommandManager
   * y llama a notify() para forzar el repintado masivo y actualización de suscriptores.
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
    this._state = deepFreeze({
      ...cloned,
      isDirty: true,
    });

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
    this._state = deepFreeze({
      ...nextState,
      isDirty: true,
    });
    this.notify();
  }

  /**
   * Busca un nodo por su identificador único.
   */
  public findNode(id: string): SceneNode | null {
    return findNodeById(this._state, id);
  }

  /**
   * Encuentra el nodo contenedor padre del elemento solicitado.
   */
  public findParent(childId: string): ParentNode | null {
    return findParentOfNode(this._state, childId);
  }

  /**
   * Agrega un nodo hijo (Layer o Shape) dentro del nodo padre especificado.
   * Mantiene la inmutabilidad creando nuevas referencias solo en el camino afectado.
   *
   * @param parentId ID del nodo padre contenedor (Document para Layers, Layer para Shapes)
   * @param node Nodo a agregar
   * @param index Posición opcional en el array de hijos (por defecto al final)
   */
  public addNode(parentId: string, node: Layer | Shape, index?: number): void {
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

    // Regla 2: Un Layer solo puede tener Shapes como hijos directos
    if (isLayer(parent)) {
      if (!isShape(node)) {
        throw new Error(
          `[StateManager] Un nodo de tipo "${node.type}" no puede agregarse a una Layer. Solo se admiten figuras (Shape).`
        );
      }

      const updatedLayerChildren = insertAt(parent.children, node, index);
      const updatedLayer: Layer = {
        ...parent,
        children: updatedLayerChildren,
      };

      // Reconstrucción estructural del Documento
      const nextLayers = this._state.children.map((layer) =>
        layer.id === parent.id ? updatedLayer : layer
      );

      const nextState: Document = {
        ...this._state,
        children: nextLayers,
      };

      this.setState(nextState);
      return;
    }

    throw new Error(
      `[StateManager] El nodo "${parentId}" es de tipo "${parent.type}" y no admite nodos hijos.`
    );
  }

  /**
   * Elimina un nodo (Layer o Shape) a partir de su ID.
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
      // Eliminar una capa del Documento
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

    if (isLayer(parent)) {
      // Eliminar una figura de la capa
      const index = parent.children.findIndex((shape) => shape.id === nodeId);
      if (index === -1) return false;

      const updatedShapes = removeAt(parent.children, index);
      const updatedLayer: Layer = {
        ...parent,
        children: updatedShapes,
      };

      const nextLayers = this._state.children.map((layer) =>
        layer.id === parent.id ? updatedLayer : layer
      );

      const nextState: Document = {
        ...this._state,
        children: nextLayers,
      };

      this.setState(nextState);
      return true;
    }

    return false;
  }

  /**
   * Reordena los nodos hijos dentro del array del contenedor padre.
   *
   * @param parentId ID del contenedor padre (Document o Layer)
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
        return; // Sin cambios
      }

      const nextState: Document = {
        ...parent,
        children: reorderedLayers,
      };

      this.setState(nextState);
      return;
    }

    if (isLayer(parent)) {
      const reorderedShapes = moveItem(parent.children, fromIndex, toIndex);
      if (reorderedShapes === parent.children) {
        return; // Sin cambios
      }

      const updatedLayer: Layer = {
        ...parent,
        children: reorderedShapes,
      };

      const nextLayers = this._state.children.map((layer) =>
        layer.id === parent.id ? updatedLayer : layer
      );

      const nextState: Document = {
        ...this._state,
        children: nextLayers,
      };

      this.setState(nextState);
      return;
    }

    throw new Error(
      `[StateManager] El nodo "${parentId}" de tipo "${parent.type}" no posee una lista de nodos hijos reordenables.`
    );
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
   * Atajo para agregar una figura a una capa específica.
   */
  public addShape(layerId: string, shape: Shape, index?: number): void {
    this.addNode(layerId, shape, index);
  }

  /**
   * Atajo para eliminar una figura por su ID.
   */
  public removeShape(shapeId: string): boolean {
    return this.removeNode(shapeId);
  }

  /**
   * Atajo para reordenar figuras dentro de una capa.
   */
  public reorderShapes(layerId: string, fromIndex: number, toIndex: number): void {
    this.reorderNodes(layerId, fromIndex, toIndex);
  }

  /**
   * Mueve una figura (o capa) al frente de su contenedor (última posición visual en el array)
   * y recalcula un valor discreto de zIndex (0, 1, 2, ...) para todos los elementos hermanos
   * a fin de facilitar futuros cómputos asíncronos y ordenamientos independientes.
   *
   * @param shapeId ID de la figura o elemento a traer al frente
   * @returns true si el elemento fue encontrado y reordenado, false en caso contrario
   */
  public bringToFront(shapeId: string): boolean {
    const parent = this.findParent(shapeId);
    if (!parent) {
      return false;
    }

    if (isLayer(parent)) {
      const shapes = parent.children;
      const currentIndex = shapes.findIndex((s) => s.id === shapeId);
      if (currentIndex === -1) {
        return false;
      }

      // Mover al final del array
      const targetShape = shapes[currentIndex];
      const filtered = shapes.filter((_, idx) => idx !== currentIndex);
      const reordered = [...filtered, targetShape];

      // Recalcular valor discreto de zIndex para todos los elementos hermanos
      const updatedShapes = reordered.map((shape, index) => ({
        ...shape,
        zIndex: index,
      }));

      const updatedLayer: Layer = {
        ...parent,
        children: updatedShapes,
      };

      const nextLayers = this._state.children.map((layer) =>
        layer.id === parent.id ? updatedLayer : layer
      );

      this.setState({
        ...this._state,
        children: nextLayers,
      });

      return true;
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
   * Mueve una figura (o capa) al fondo de su contenedor (primera posición visual en el array)
   * y recalcula un valor discreto de zIndex (0, 1, 2, ...) para todos los elementos hermanos
   * a fin de facilitar futuros cómputos asíncronos y ordenamientos independientes.
   *
   * @param shapeId ID de la figura o elemento a enviar al fondo
   * @returns true si el elemento fue encontrado y reordenado, false en caso contrario
   */
  public sendToBack(shapeId: string): boolean {
    const parent = this.findParent(shapeId);
    if (!parent) {
      return false;
    }

    if (isLayer(parent)) {
      const shapes = parent.children;
      const currentIndex = shapes.findIndex((s) => s.id === shapeId);
      if (currentIndex === -1) {
        return false;
      }

      // Mover al inicio del array
      const targetShape = shapes[currentIndex];
      const filtered = shapes.filter((_, idx) => idx !== currentIndex);
      const reordered = [targetShape, ...filtered];

      // Recalcular valor discreto de zIndex para todos los elementos hermanos
      const updatedShapes = reordered.map((shape, index) => ({
        ...shape,
        zIndex: index,
      }));

      const updatedLayer: Layer = {
        ...parent,
        children: updatedShapes,
      };

      const nextLayers = this._state.children.map((layer) =>
        layer.id === parent.id ? updatedLayer : layer
      );

      this.setState({
        ...this._state,
        children: nextLayers,
      });

      return true;
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
   * Marca un nodo como seleccionado (selected: true) y deselecciona los demás en el Scene Graph de forma inmutable.
   * Si targetNodeId es null, deselecciona todos los nodos.
   *
   * @param targetNodeId ID de la figura a seleccionar, o null para deseleccionar todo
   */
  public selectNode(targetNodeId: string | null): void {
    let changed = false;

    const nextLayers = this._state.children.map((layer) => {
      let layerChanged = false;
      const nextShapes = layer.children.map((shape) => {
        const isTarget = shape.id === targetNodeId;
        const wasSelected = Boolean(shape.selected);
        if (isTarget !== wasSelected) {
          layerChanged = true;
          changed = true;
          return {
            ...shape,
            selected: isTarget,
          };
        }
        return shape;
      });

      if (layerChanged) {
        return {
          ...layer,
          children: nextShapes,
        };
      }
      return layer;
    });

    if (changed) {
      this.setState({
        ...this._state,
        children: nextLayers,
      });
    }
  }

  /**
   * Retorna la figura actualmente seleccionada en el Scene Graph, o null si ninguna lo está.
   */
  public getSelectedNode(): Shape | null {
    for (const layer of this._state.children) {
      for (const shape of layer.children) {
        if (shape.selected) {
          return shape;
        }
      }
    }
    return null;
  }

  /**
   * Actualiza la posición (x, y) de una figura en el Scene Graph de forma inmutable.
   * Produce una nueva copia estructural y marca el estado como sucio (isDirty = true).
   */
  public updateShapePosition(shapeId: string, x: number, y: number): boolean {
    let updated = false;

    const nextLayers = this._state.children.map((layer) => {
      let layerChanged = false;
      const nextShapes = layer.children.map((shape) => {
        if (shape.id === shapeId) {
          if (shape.x === x && shape.y === y) {
            return shape;
          }
          layerChanged = true;
          updated = true;

          if (shape.type === 'path') {
            const dx = x - shape.x;
            const dy = y - shape.y;
            const updatedPoints = shape.points.map((pt) => ({
              x: pt.x + dx,
              y: pt.y + dy,
              handleIn: pt.handleIn ? { x: pt.handleIn.x + dx, y: pt.handleIn.y + dy } : undefined,
              handleOut: pt.handleOut ? { x: pt.handleOut.x + dx, y: pt.handleOut.y + dy } : undefined,
            }));
            return {
              ...shape,
              x,
              y,
              points: updatedPoints,
            };
          }

          return {
            ...shape,
            x,
            y,
          };
        }
        return shape;
      });

      if (layerChanged) {
        return {
          ...layer,
          children: nextShapes,
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
   * Actualiza las dimensiones espaciales y/o radios de una figura (width/height para Rectangle,
   * radiusX/radiusY para Ellipse) de forma inmutable en el Scene Graph.
   * Produce una nueva copia estructural y marca el estado como sucio (isDirty = true).
   *
   * @param shapeId ID de la figura a redimensionar
   * @param dimensions Nuevas dimensiones espaciales y/o radios
   * @returns true si la figura fue encontrada y modificada, false en caso contrario
   */
  public updateShapeDimensions(shapeId: string, dimensions: ShapeDimensions): boolean {
    let updated = false;

    const nextLayers = this._state.children.map((layer) => {
      let layerChanged = false;
      const nextShapes = layer.children.map((shape) => {
        if (shape.id === shapeId) {
          if (shape.type === 'rectangle') {
            const nextX = dimensions.x !== undefined ? dimensions.x : shape.x;
            const nextY = dimensions.y !== undefined ? dimensions.y : shape.y;
            const nextW =
              dimensions.width !== undefined
                ? dimensions.width
                : dimensions.radiusX !== undefined
                ? dimensions.radiusX * 2
                : shape.width;
            const nextH =
              dimensions.height !== undefined
                ? dimensions.height
                : dimensions.radiusY !== undefined
                ? dimensions.radiusY * 2
                : shape.height;

            if (
              nextX === shape.x &&
              nextY === shape.y &&
              nextW === shape.width &&
              nextH === shape.height
            ) {
              return shape;
            }

            layerChanged = true;
            updated = true;
            return {
              ...shape,
              x: nextX,
              y: nextY,
              width: nextW,
              height: nextH,
            };
          }

          if (shape.type === 'ellipse') {
            const nextX = dimensions.x !== undefined ? dimensions.x : shape.x;
            const nextY = dimensions.y !== undefined ? dimensions.y : shape.y;
            const nextRx =
              dimensions.radiusX !== undefined
                ? dimensions.radiusX
                : dimensions.width !== undefined
                ? dimensions.width / 2
                : shape.radiusX;
            const nextRy =
              dimensions.radiusY !== undefined
                ? dimensions.radiusY
                : dimensions.height !== undefined
                ? dimensions.height / 2
                : shape.radiusY;

            if (
              nextX === shape.x &&
              nextY === shape.y &&
              nextRx === shape.radiusX &&
              nextRy === shape.radiusY
            ) {
              return shape;
            }

            layerChanged = true;
            updated = true;
            return {
              ...shape,
              x: nextX,
              y: nextY,
              radiusX: nextRx,
              radiusY: nextRy,
            };
          }
        }
        return shape;
      });

      if (layerChanged) {
        return {
          ...layer,
          children: nextShapes,
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
   * Actualiza propiedades de una figura existente en el Scene Graph de forma inmutable.
   */
  public updateShape<T extends Shape>(shapeId: string, updater: Partial<T> | ((current: T) => T)): boolean {
    let updated = false;

    const nextLayers = this._state.children.map((layer) => {
      let layerChanged = false;
      const nextShapes = layer.children.map((shape) => {
        if (shape.id === shapeId) {
          layerChanged = true;
          updated = true;
          const nextVal = typeof updater === 'function' ? updater(shape as T) : { ...shape, ...updater };
          return nextVal;
        }
        return shape;
      });

      if (layerChanged) {
        return {
          ...layer,
          children: nextShapes,
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
