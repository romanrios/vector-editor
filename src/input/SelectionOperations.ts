import type { StateManager } from '../state/StateManager.ts';
import { getLeafShapes } from '../state/StateManager.ts';
import {
  isGroup,
  isLayer,
  isSelectable,
  isShape,
  type Group,
  type Layer,
  type SelectableNode,
  type Shape,
} from '../types/scene-graph.ts';
import { cloneNode } from '../utils/cloneShape.ts';
import {
  computeNodesAlignment,
  computeNodesDistribution,
  type AlignmentMode,
  type DistributionAxis,
} from '../utils/geometry.ts';
import type { CommandManager } from '../commands/CommandManager.ts';
import { TranslateCommand } from '../commands/TranslateCommand.ts';
import { BatchCommand } from '../commands/BatchCommand.ts';
import { DeleteCommand } from '../commands/DeleteCommand.ts';
import { AddShapeCommand } from '../commands/AddShapeCommand.ts';
import { ReorderCommand } from '../commands/ReorderCommand.ts';
import { GroupCommand } from '../commands/GroupCommand.ts';
import { UngroupCommand } from '../commands/UngroupCommand.ts';
import { StyleCommand } from '../commands/StyleCommand.ts';

/**
 * Portapapeles que almacena una lista de nodos seleccionables preservando compatibilidad con .id
 */
export interface ClipboardList extends ReadonlyArray<SelectableNode> {
  readonly id?: string;
}

export interface ClipboardEntry {
  readonly node: SelectableNode;
  readonly parentId: string;
  readonly layerId: string;
  readonly layerIndex: number;
  readonly nodeIndex: number;
  readonly shape?: Shape;
}

export function createClipboardList(nodes: readonly SelectableNode[]): ClipboardList {
  const list = [...nodes] as SelectableNode[] & { id?: string };
  Object.defineProperty(list, 'id', {
    get: () => list[0]?.id,
    enumerable: false,
    configurable: true,
  });
  return Object.freeze(list) as unknown as ClipboardList;
}

export function asShapeArray(shapes: readonly SelectableNode[]): Shape[] & Shape {
  const arr = [...shapes] as unknown as Shape[] & Shape;
  if (arr.length > 0) {
    const first = arr[0];
    Object.defineProperties(arr, {
      id: { get: () => arr[0]?.id, configurable: true },
      name: { get: () => arr[0]?.name, configurable: true },
      type: { get: () => arr[0]?.type, configurable: true },
      x: { get: () => (isShape(first) ? first.x : undefined), configurable: true },
      y: { get: () => (isShape(first) ? first.y : undefined), configurable: true },
      stroke: { get: () => (isShape(first) ? first.stroke : undefined), configurable: true },
      fill: { get: () => (isShape(first) ? first.fill : undefined), configurable: true },
      strokeWidth: { get: () => (isShape(first) ? first.strokeWidth : undefined), configurable: true },
      visible: { get: () => arr[0]?.visible, configurable: true },
      locked: { get: () => arr[0]?.locked, configurable: true },
      rotation: { get: () => (isShape(first) ? first.rotation : undefined), configurable: true },
    });
  }
  return arr;
}

/**
 * Encapsula todas las operaciones que actúan directamente sobre la selección de figuras y grupos:
 * reordenamiento (bringToFront, sendToBack), duplicación, portapapeles en memoria (copy, paste),
 * eliminación (deleteSelected), traslación por teclado/desplazamiento (moveSelection),
 * agrupación/desagrupación (groupSelection, ungroupSelection), alineación/distribución geométrica
 * y aplicación de estilos sobre hojas.
 */
export class SelectionOperations {
  private readonly stateManager: StateManager;
  private readonly commandManager: CommandManager;

  // Portapapeles interno en memoria
  private _clipboard: ClipboardList | null = null;
  private _clipboardEntries: readonly ClipboardEntry[] | null = null;
  private _pasteCount: number = 0;

  constructor(stateManager: StateManager, commandManager: CommandManager) {
    this.stateManager = stateManager;
    this.commandManager = commandManager;
  }

  public get clipboard(): (readonly Shape[] & { readonly id?: string }) | null {
    return this._clipboard as unknown as (readonly Shape[] & { readonly id?: string }) | null;
  }

  public get pasteCount(): number {
    return this._pasteCount;
  }

  /**
   * Resuelve la capa contenedora raíz de cualquier nodo subiendo por la cadena de padres.
   */
  private findParentLayer(nodeId: string): Layer | null {
    let current = this.stateManager.findParent(nodeId);
    while (current) {
      if (isLayer(current)) {
        return current;
      }
      current = this.stateManager.findParent(current.id);
    }
    return null;
  }

  /**
   * Encuentra el hijo directo de la capa que contiene al nodo especificado.
   */
  private findTopChildInLayer(layer: Layer, descendantId: string): SelectableNode | null {
    let currentId = descendantId;
    while (currentId) {
      const p = this.stateManager.findParent(currentId);
      if (!p) break;
      if (p.id === layer.id) {
        const node = this.stateManager.findNode(currentId);
        return node && isSelectable(node) ? node : null;
      }
      currentId = p.id;
    }
    return null;
  }

  /**
   * Agrupa una colección de figuras (por defecto las hojas de la selección activa)
   * por su capa contenedora raíz, subiendo por la jerarquía de padres si están dentro de grupos.
   */
  public getSelectedShapesGroupedByLayer(
    shapes?: readonly Shape[]
  ): Map<string, { shape: Shape; index: number }[]> {
    const targetShapes =
      shapes ?? getLeafShapes(this.stateManager.getSelectedNodes());

    const layerMap = new Map<string, { shape: Shape; index: number }[]>();
    if (targetShapes.length === 0) {
      return layerMap;
    }

    for (const shape of targetShapes) {
      const layer = this.findParentLayer(shape.id);
      if (layer) {
        let list = layerMap.get(layer.id);
        if (!list) {
          list = [];
          layerMap.set(layer.id, list);
        }
        const topChild = this.findTopChildInLayer(layer, shape.id);
        const index = topChild
          ? layer.children.findIndex((c) => c.id === topChild.id)
          : 0;
        list.push({ shape, index });
      }
    }

    for (const items of layerMap.values()) {
      items.sort((a, b) => a.index - b.index);
    }

    return layerMap;
  }

  /**
   * Trae los elementos seleccionados al frente dentro de sus respectivos contenedores padres
   * (capa o grupo) conservando su orden relativo.
   * Registra UNA sola entrada en el historial de comandos (ReorderCommand o BatchCommand).
   */
  public bringToFront(nodeId?: string): boolean {
    if (nodeId) {
      const command = new ReorderCommand(this.stateManager, nodeId, 'bringToFront');
      if (command.isAlreadyAtTarget) {
        return false;
      }
      this.commandManager.executeCommand(command);
      return true;
    }

    const selectedNodes = this.stateManager.getSelectedNodes();
    if (selectedNodes.length === 0) {
      return false;
    }

    if (selectedNodes.length === 1) {
      const command = new ReorderCommand(this.stateManager, selectedNodes[0].id, 'bringToFront');
      if (command.isAlreadyAtTarget) {
        return false;
      }
      this.commandManager.executeCommand(command);
      return true;
    }

    // Varias figuras o grupos seleccionados: agrupar por contenedor padre directo (Layer o Group)
    const parentMap = new Map<string, { node: SelectableNode; index: number }[]>();
    for (const node of selectedNodes) {
      const parent = this.stateManager.findParent(node.id);
      if (parent && 'children' in parent) {
        let list = parentMap.get(parent.id);
        if (!list) {
          list = [];
          parentMap.set(parent.id, list);
        }
        const index = (parent.children as readonly SelectableNode[]).findIndex((c) => c.id === node.id);
        list.push({ node, index });
      }
    }

    for (const items of parentMap.values()) {
      items.sort((a, b) => a.index - b.index);
    }

    let anyNeedsMove = false;
    for (const [parentId, items] of parentMap.entries()) {
      const parent = this.stateManager.findNode(parentId);
      if (parent && 'children' in parent) {
        const total = (parent.children as readonly SelectableNode[]).length;
        const k = items.length;
        const alreadyAtTop = items.every((it, idx) => it.index === total - k + idx);
        if (!alreadyAtTop) {
          anyNeedsMove = true;
        }
      }
    }

    if (!anyNeedsMove) {
      return false;
    }

    const commands: ReorderCommand[] = [];

    for (const [parentId, items] of parentMap.entries()) {
      for (const item of items) {
        const parent = this.stateManager.findNode(parentId);
        if (parent && 'children' in parent) {
          const currentIndex = (parent.children as readonly SelectableNode[]).findIndex((s) => s.id === item.node.id);
          const cmd = new ReorderCommand(this.stateManager, item.node.id, 'bringToFront', currentIndex);
          cmd.execute();
          commands.push(cmd);
        }
      }
    }

    if (commands.length === 0) {
      return false;
    }

    const batch = new BatchCommand(commands, 'Bring to Front');
    this.commandManager.recordCommand(batch);
    return true;
  }

  /**
   * Envía los elementos seleccionados al fondo dentro de sus respectivos contenedores padres
   * (capa o grupo) conservando su orden relativo.
   * Registra UNA sola entrada en el historial de comandos (ReorderCommand o BatchCommand).
   */
  public sendToBack(nodeId?: string): boolean {
    if (nodeId) {
      const command = new ReorderCommand(this.stateManager, nodeId, 'sendToBack');
      if (command.isAlreadyAtTarget) {
        return false;
      }
      this.commandManager.executeCommand(command);
      return true;
    }

    const selectedNodes = this.stateManager.getSelectedNodes();
    if (selectedNodes.length === 0) {
      return false;
    }

    if (selectedNodes.length === 1) {
      const command = new ReorderCommand(this.stateManager, selectedNodes[0].id, 'sendToBack');
      if (command.isAlreadyAtTarget) {
        return false;
      }
      this.commandManager.executeCommand(command);
      return true;
    }

    // Varias figuras o grupos seleccionados: agrupar por contenedor padre directo (Layer o Group)
    const parentMap = new Map<string, { node: SelectableNode; index: number }[]>();
    for (const node of selectedNodes) {
      const parent = this.stateManager.findParent(node.id);
      if (parent && 'children' in parent) {
        let list = parentMap.get(parent.id);
        if (!list) {
          list = [];
          parentMap.set(parent.id, list);
        }
        const index = (parent.children as readonly SelectableNode[]).findIndex((c) => c.id === node.id);
        list.push({ node, index });
      }
    }

    for (const items of parentMap.values()) {
      items.sort((a, b) => a.index - b.index);
    }

    let anyNeedsMove = false;
    for (const [parentId, items] of parentMap.entries()) {
      const parent = this.stateManager.findNode(parentId);
      if (parent && 'children' in parent) {
        const alreadyAtBottom = items.every((it, idx) => it.index === idx);
        if (!alreadyAtBottom) {
          anyNeedsMove = true;
        }
      }
    }

    if (!anyNeedsMove) {
      return false;
    }

    const commands: ReorderCommand[] = [];

    for (const [parentId, items] of parentMap.entries()) {
      const reversed = [...items].reverse();

      for (const item of reversed) {
        const parent = this.stateManager.findNode(parentId);
        if (parent && 'children' in parent) {
          const currentIndex = (parent.children as readonly SelectableNode[]).findIndex((s) => s.id === item.node.id);
          const cmd = new ReorderCommand(this.stateManager, item.node.id, 'sendToBack', currentIndex);
          cmd.execute();
          commands.push(cmd);
        }
      }
    }

    if (commands.length === 0) {
      return false;
    }

    const batch = new BatchCommand(commands, 'Send to Back');
    this.commandManager.recordCommand(batch);
    return true;
  }

  /**
   * Duplica los nodos seleccionados (figuras o grupos) con un desplazamiento de 10 px,
   * conservando sus posiciones relativas y su orden de apilado relativo,
   * en su contenedor padre de origen, con IDs y nombres nuevos.
   * Las copias quedan seleccionadas.
   * Registra UNA sola entrada en el historial de comandos (AddShapeCommand o BatchCommand).
   */
  public duplicate(): (Shape[] & Shape) | null {
    const selectedNodes = this.stateManager.getSelectedNodes();
    if (selectedNodes.length === 0) {
      return null;
    }

    const parentMap = new Map<string, { node: SelectableNode; index: number }[]>();
    for (const node of selectedNodes) {
      const parent = this.stateManager.findParent(node.id);
      if (parent && 'children' in parent) {
        let list = parentMap.get(parent.id);
        if (!list) {
          list = [];
          parentMap.set(parent.id, list);
        }
        const index = (parent.children as readonly SelectableNode[]).findIndex((c) => c.id === node.id);
        list.push({ node, index });
      }
    }

    for (const items of parentMap.values()) {
      items.sort((a, b) => a.index - b.index);
    }

    const clonedNodes: SelectableNode[] = [];
    const commands: AddShapeCommand[] = [];

    for (const [parentId, items] of parentMap.entries()) {
      const maxIndex = Math.max(...items.map((it) => it.index));

      items.forEach((item, k) => {
        const targetIndex = maxIndex + 1 + k;
        const cloned = cloneNode(item.node, { dx: 10, dy: 10 });
        clonedNodes.push(cloned);
        commands.push(new AddShapeCommand(this.stateManager, parentId, cloned, targetIndex));
      });
    }

    if (commands.length === 0) {
      return null;
    }

    if (commands.length === 1) {
      this.commandManager.executeCommand(commands[0]);
    } else {
      const batch = new BatchCommand(commands, 'Duplicate Nodes');
      this.commandManager.executeCommand(batch);
    }

    this.stateManager.setSelection(clonedNodes.map((s) => s.id));
    return asShapeArray(clonedNodes);
  }

  /**
   * Guarda una copia de los nodos seleccionados (figuras o grupos) en el portapapeles interno.
   * Reinicia el contador de desplazamientos de pegados consecutivos.
   */
  public copy(): boolean {
    const selectedNodes = this.stateManager.getSelectedNodes();
    if (selectedNodes.length === 0) {
      return false;
    }

    const doc = this.stateManager.getState();
    const entries: ClipboardEntry[] = [];

    for (const node of selectedNodes) {
      const parent = this.stateManager.findParent(node.id);
      const layer = this.findParentLayer(node.id);
      const layerId = layer ? layer.id : (doc.children[0]?.id ?? '');
      const layerIndex = doc.children.findIndex((l) => l.id === layerId);
      const nodeIndex =
        parent && 'children' in parent
          ? (parent.children as readonly SelectableNode[]).findIndex((c) => c.id === node.id)
          : 0;

      entries.push({
        node,
        parentId: parent ? parent.id : layerId,
        layerId,
        layerIndex,
        nodeIndex,
        ...(isShape(node) ? { shape: node } : {}),
      });
    }

    entries.sort((a, b) => {
      if (a.layerIndex !== b.layerIndex) {
        return a.layerIndex - b.layerIndex;
      }
      return a.nodeIndex - b.nodeIndex;
    });

    this._clipboardEntries = entries;
    this._clipboard = createClipboardList(selectedNodes);
    this._pasteCount = 0;
    return true;
  }

  /**
   * Crea copias de los elementos del portapapeles conservando sus posiciones relativas
   * y orden de apilado relativo, desplazadas 10 px de forma acumulada en pegados consecutivos.
   * Las copias se insertan en su contenedor de origen y quedan seleccionadas.
   * Registra UNA sola entrada en el historial de comandos (AddShapeCommand o BatchCommand).
   */
  public paste(): (Shape[] & Shape) | null {
    if (!this._clipboard || !this._clipboardEntries || this._clipboardEntries.length === 0) {
      return null;
    }

    this._pasteCount++;
    const offset = this._pasteCount * 10;
    const doc = this.stateManager.getState();
    const defaultLayerId = doc.children[0]?.id;

    const clonedNodes: SelectableNode[] = [];
    const commands: AddShapeCommand[] = [];

    for (const entry of this._clipboardEntries) {
      let targetParentId = entry.parentId;
      if (!this.stateManager.findNode(targetParentId)) {
        targetParentId = entry.layerId;
        if (!this.stateManager.findNode(targetParentId)) {
          targetParentId = defaultLayerId;
        }
      }
      if (!targetParentId) {
        continue;
      }

      const cloned = cloneNode(entry.node, { dx: offset, dy: offset });
      clonedNodes.push(cloned);
      commands.push(new AddShapeCommand(this.stateManager, targetParentId, cloned));
    }

    if (commands.length === 0) {
      return null;
    }

    if (commands.length === 1) {
      this.commandManager.executeCommand(commands[0]);
    } else {
      const batch = new BatchCommand(commands, 'Paste Nodes');
      this.commandManager.executeCommand(batch);
    }

    this.stateManager.setSelection(clonedNodes.map((s) => s.id));
    return asShapeArray(clonedNodes);
  }

  /**
   * Elimina todos los elementos seleccionados (figuras o grupos) mediante DeleteCommand.
   * Al deshacer, restaura los nodos y cualquier grupo vaciado en sus posiciones exactas.
   * Registra UNA sola entrada en el historial de comandos (DeleteCommand o BatchCommand).
   */
  public deleteSelected(): boolean {
    const selectedNodes = this.stateManager.getSelectedNodes();
    if (selectedNodes.length === 0) {
      return false;
    }

    // Agrupar nodos por contenedor padre directo para ordenar por índice descendente
    const parentMap = new Map<string, { node: SelectableNode; index: number }[]>();
    for (const node of selectedNodes) {
      const parent = this.stateManager.findParent(node.id);
      if (parent && 'children' in parent) {
        let list = parentMap.get(parent.id);
        if (!list) {
          list = [];
          parentMap.set(parent.id, list);
        }
        const index = (parent.children as readonly SelectableNode[]).findIndex((c) => c.id === node.id);
        list.push({ node, index });
      }
    }

    const commands: DeleteCommand[] = [];

    for (const [parentId, items] of parentMap.entries()) {
      // Orden descendente de índice para que la eliminación no altere los índices inferiores
      items.sort((a, b) => b.index - a.index);
      for (const item of items) {
        commands.push(new DeleteCommand(this.stateManager, item.node, parentId, item.index));
      }
    }

    if (commands.length === 0) {
      return false;
    }

    if (commands.length === 1) {
      this.commandManager.executeCommand(commands[0]);
    } else {
      const batch = new BatchCommand(commands, 'Delete Nodes');
      this.commandManager.executeCommand(batch);
    }

    this.stateManager.setSelection([]);
    return true;
  }

  /**
   * Mueve todas las figuras de la selección (expandiendo grupos a figuras hoja)
   * por un desplazamiento relativo (dx, dy). Omite figuras efectivamente bloqueadas.
   * Con varias figuras u hojas de grupo, las encapsula en un BatchCommand;
   * los comandos de flechas consecutivos se fusionan en una sola entrada del historial.
   */
  public moveSelection(dx: number, dy: number, timestamp?: number): boolean {
    if (dx === 0 && dy === 0) {
      return false;
    }

    const selectedNodes = this.stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes).filter(
      (s) => !this.stateManager.isEffectivelyLocked(s.id)
    );

    if (leafShapes.length === 0) {
      return false;
    }

    const now = timestamp ?? Date.now();

    const commands = leafShapes.map((shape) => {
      return new TranslateCommand(
        this.stateManager,
        shape.id,
        shape.x,
        shape.y,
        shape.x + dx,
        shape.y + dy,
        {
          timestamp: now,
          mergeTimeout: 400,
        }
      );
    });

    if (commands.length === 1 && selectedNodes.length === 1 && isShape(selectedNodes[0])) {
      this.commandManager.executeCommand(commands[0]);
    } else {
      const batch = new BatchCommand(commands, 'Translate Shapes');
      this.commandManager.executeCommand(batch);
    }
    return true;
  }

  /**
   * Alinea los elementos seleccionados considerando cada grupo como una unidad indivisible (getNodeAABB).
   * El desplazamiento resultante se aplica a todas las figuras hoja de cada elemento.
   * Toda la operación se encapsula en UN solo BatchCommand de TranslateCommand.
   */
  public alignSelection(mode: AlignmentMode): boolean {
    const selectedNodes = this.stateManager.getSelectedNodes().filter(
      (n) => !this.stateManager.isEffectivelyLocked(n.id)
    );
    if (selectedNodes.length < 2) {
      return false;
    }

    const entries = computeNodesAlignment(selectedNodes, mode);
    if (entries.length === 0) {
      return false;
    }

    const commands: TranslateCommand[] = [];

    for (const entry of entries) {
      const leafShapes = getLeafShapes([entry.node]).filter(
        (s) => !this.stateManager.isEffectivelyLocked(s.id)
      );
      for (const shape of leafShapes) {
        commands.push(
          new TranslateCommand(
            this.stateManager,
            shape.id,
            shape.x,
            shape.y,
            shape.x + entry.dx,
            shape.y + entry.dy,
            { mergeTimeout: 0 }
          )
        );
      }
    }

    if (commands.length === 0) {
      return false;
    }

    const batch = new BatchCommand(commands, `Alinear (${mode})`);
    this.commandManager.executeCommand(batch);
    return true;
  }

  /**
   * Distribuye uniformemente los elementos seleccionados considerando cada grupo como una unidad (getNodeAABB).
   * El desplazamiento resultante se aplica a todas las figuras hoja de cada elemento.
   * Toda la operación se encapsula en UN solo BatchCommand de TranslateCommand.
   */
  public distributeSelection(axis: DistributionAxis): boolean {
    const selectedNodes = this.stateManager.getSelectedNodes().filter(
      (n) => !this.stateManager.isEffectivelyLocked(n.id)
    );
    if (selectedNodes.length < 3) {
      return false;
    }

    const entries = computeNodesDistribution(selectedNodes, axis);
    if (entries.length === 0) {
      return false;
    }

    const commands: TranslateCommand[] = [];

    for (const entry of entries) {
      const leafShapes = getLeafShapes([entry.node]).filter(
        (s) => !this.stateManager.isEffectivelyLocked(s.id)
      );
      for (const shape of leafShapes) {
        commands.push(
          new TranslateCommand(
            this.stateManager,
            shape.id,
            shape.x,
            shape.y,
            shape.x + entry.dx,
            shape.y + entry.dy,
            { mergeTimeout: 0 }
          )
        );
      }
    }

    if (commands.length === 0) {
      return false;
    }

    const batch = new BatchCommand(commands, `Distribuir (${axis})`);
    this.commandManager.executeCommand(batch);
    return true;
  }

  /**
   * Aplica estilos (relleno, borde, grosor) sobre todas las figuras hoja de la selección activa.
   * Registra UNA sola entrada en el historial de comandos (StyleCommand o BatchCommand).
   */
  public applyStyle(
    style: Partial<{ fill: string; stroke: string; strokeWidth: number }>
  ): boolean {
    const selectedNodes = this.stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes).filter(
      (s) => !this.stateManager.isEffectivelyLocked(s.id)
    );
    if (leafShapes.length === 0) {
      return false;
    }

    const commands: StyleCommand[] = [];

    for (const shape of leafShapes) {
      const oldStyle: Record<string, any> = {};
      const newStyle: Record<string, any> = {};
      let changed = false;

      if (style.fill !== undefined && shape.fill !== style.fill) {
        oldStyle.fill = shape.fill;
        newStyle.fill = style.fill;
        changed = true;
      }
      if (style.stroke !== undefined && shape.stroke !== style.stroke) {
        oldStyle.stroke = shape.stroke;
        newStyle.stroke = style.stroke;
        changed = true;
      }
      if (style.strokeWidth !== undefined && shape.strokeWidth !== style.strokeWidth) {
        oldStyle.strokeWidth = shape.strokeWidth;
        newStyle.strokeWidth = style.strokeWidth;
        changed = true;
      }

      if (changed) {
        commands.push(new StyleCommand(this.stateManager, shape.id, oldStyle, newStyle));
      }
    }

    if (commands.length === 0) {
      return false;
    }

    if (commands.length === 1) {
      this.commandManager.executeCommand(commands[0]);
    } else {
      const batch = new BatchCommand(commands, 'Apply Style');
      this.commandManager.executeCommand(batch);
    }

    return true;
  }

  /**
   * Agrupa los elementos actualmente seleccionados (requiere 2 o más nodos).
   * Registra UNA sola entrada en el historial mediante GroupCommand.
   */
  public groupSelection(): Group | null {
    const selectedNodes = this.stateManager.getSelectedNodes();
    if (selectedNodes.length < 2) {
      return null;
    }

    const command = new GroupCommand(this.stateManager, selectedNodes);
    this.commandManager.executeCommand(command);
    return command.newGroup;
  }

  /**
   * Desagrupa los grupos actualmente seleccionados (requiere al menos un grupo).
   * Registra UNA sola entrada en el historial mediante UngroupCommand.
   */
  public ungroupSelection(): boolean {
    const selectedGroups = this.stateManager.getSelectedNodes().filter(isGroup);
    if (selectedGroups.length === 0) {
      return false;
    }

    const command = new UngroupCommand(this.stateManager, selectedGroups);
    this.commandManager.executeCommand(command);
    return true;
  }
}
