import type { StateManager } from '../state/StateManager.ts';
import { isLayer, isShape, type Shape } from '../types/scene-graph.ts';
import { cloneShape } from '../utils/cloneShape.ts';
import {
  computeAlignment,
  computeDistribution,
  type AlignmentMode,
  type DistributionAxis,
} from '../utils/geometry.ts';
import type { CommandManager } from '../commands/CommandManager.ts';
import { TranslateCommand } from '../commands/TranslateCommand.ts';
import { BatchCommand } from '../commands/BatchCommand.ts';
import { DeleteCommand } from '../commands/DeleteCommand.ts';
import { AddShapeCommand } from '../commands/AddShapeCommand.ts';
import { ReorderCommand } from '../commands/ReorderCommand.ts';

/**
 * Portapapeles que almacena una lista de figuras preservando compatibilidad con .id
 */
export interface ClipboardList extends ReadonlyArray<Shape> {
  readonly id?: string;
}

export interface ClipboardEntry {
  readonly shape: Shape;
  readonly layerId: string;
  readonly layerIndex: number;
  readonly shapeIndex: number;
}

export function createClipboardList(shapes: readonly Shape[]): ClipboardList {
  const list = [...shapes] as Shape[] & { id?: string };
  Object.defineProperty(list, 'id', {
    get: () => list[0]?.id,
    enumerable: false,
    configurable: true,
  });
  return Object.freeze(list) as unknown as ClipboardList;
}

export function asShapeArray(shapes: readonly Shape[]): Shape[] & Shape {
  const arr = [...shapes] as unknown as Shape[] & Shape;
  if (arr.length > 0) {
    Object.defineProperties(arr, {
      id: { get: () => arr[0]?.id, configurable: true },
      name: { get: () => arr[0]?.name, configurable: true },
      type: { get: () => arr[0]?.type, configurable: true },
      x: { get: () => arr[0]?.x, configurable: true },
      y: { get: () => arr[0]?.y, configurable: true },
      stroke: { get: () => arr[0]?.stroke, configurable: true },
      fill: { get: () => arr[0]?.fill, configurable: true },
      strokeWidth: { get: () => arr[0]?.strokeWidth, configurable: true },
      visible: { get: () => arr[0]?.visible, configurable: true },
      locked: { get: () => arr[0]?.locked, configurable: true },
      rotation: { get: () => arr[0]?.rotation, configurable: true },
    });
  }
  return arr;
}

/**
 * Encapsula todas las operaciones que actúan directamente sobre la selección de figuras:
 * reordenamiento (bringToFront, sendToBack), duplicación, portapapeles en memoria (copy, paste),
 * eliminación (deleteSelected), traslación por teclado/desplazamiento (moveSelection)
 * y alineación/distribución geométrica.
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
    return this._clipboard;
  }

  public get pasteCount(): number {
    return this._pasteCount;
  }

  /**
   * Agrupa una colección de figuras (por defecto la selección activa) por capa contenedora,
   * indexando su posición dentro de cada capa y ordenando los elementos por índice de forma ascendente.
   * Reutilizado uniformemente por bringToFront, sendToBack, duplicate, copy, paste y deleteSelected.
   */
  public getSelectedShapesGroupedByLayer(
    shapes: readonly Shape[] = this.stateManager.getSelectedNodes().filter(isShape)
  ): Map<string, { shape: Shape; index: number }[]> {
    const layerMap = new Map<string, { shape: Shape; index: number }[]>();
    if (shapes.length === 0) {
      return layerMap;
    }

    for (const shape of shapes) {
      const parent = this.stateManager.findParent(shape.id);
      if (parent && isLayer(parent)) {
        let list = layerMap.get(parent.id);
        if (!list) {
          list = [];
          layerMap.set(parent.id, list);
        }
        const index = parent.children.findIndex((s) => s.id === shape.id);
        list.push({ shape, index });
      }
    }

    for (const items of layerMap.values()) {
      items.sort((a, b) => a.index - b.index);
    }

    return layerMap;
  }

  /**
   * Trae las figuras seleccionadas al frente de sus capas contenedoras conservando su orden relativo,
   * registrando una sola entrada en el historial de comandos (ReorderCommand o BatchCommand).
   */
  public bringToFront(shapeId?: string): boolean {
    if (shapeId) {
      const command = new ReorderCommand(this.stateManager, shapeId, 'bringToFront');
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

    // Varias figuras seleccionadas:
    const layerMap = this.getSelectedShapesGroupedByLayer(selectedNodes.filter(isShape));
    if (layerMap.size === 0) {
      return false;
    }

    let anyNeedsMove = false;
    for (const [layerId, items] of layerMap.entries()) {
      const parent = this.stateManager.findNode(layerId);
      if (parent && isLayer(parent)) {
        const total = parent.children.length;
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

    for (const [layerId, items] of layerMap.entries()) {
      for (const item of items) {
        const parent = this.stateManager.findNode(layerId);
        if (parent && isLayer(parent)) {
          const currentIndex = parent.children.findIndex((s) => s.id === item.shape.id);
          const cmd = new ReorderCommand(this.stateManager, item.shape.id, 'bringToFront', currentIndex);
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
   * Envía las figuras seleccionadas al fondo de sus capas contenedoras conservando su orden relativo,
   * registrando una sola entrada en el historial de comandos (ReorderCommand o BatchCommand).
   */
  public sendToBack(shapeId?: string): boolean {
    if (shapeId) {
      const command = new ReorderCommand(this.stateManager, shapeId, 'sendToBack');
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

    // Varias figuras seleccionadas:
    const layerMap = this.getSelectedShapesGroupedByLayer(selectedNodes.filter(isShape));
    if (layerMap.size === 0) {
      return false;
    }

    let anyNeedsMove = false;
    for (const [layerId, items] of layerMap.entries()) {
      const parent = this.stateManager.findNode(layerId);
      if (parent && isLayer(parent)) {
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

    for (const [layerId, items] of layerMap.entries()) {
      const reversed = [...items].reverse();

      for (const item of reversed) {
        const parent = this.stateManager.findNode(layerId);
        if (parent && isLayer(parent)) {
          const currentIndex = parent.children.findIndex((s) => s.id === item.shape.id);
          const cmd = new ReorderCommand(this.stateManager, item.shape.id, 'sendToBack', currentIndex);
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
   * Duplica las figuras seleccionadas con un desplazamiento de 10 px,
   * conservando sus posiciones relativas y su orden de apilado relativo,
   * en su capa de origen, con IDs y nombres nuevos.
   * Las copias quedan seleccionadas.
   * Registra UNA sola entrada en el historial de comandos (AddShapeCommand o BatchCommand).
   */
  public duplicate(): (Shape[] & Shape) | null {
    const layerMap = this.getSelectedShapesGroupedByLayer();
    if (layerMap.size === 0) {
      return null;
    }

    const clonedShapes: Shape[] = [];
    const commands: AddShapeCommand[] = [];

    for (const [layerId, items] of layerMap.entries()) {
      const maxIndex = Math.max(...items.map((it) => it.index));

      items.forEach((item, k) => {
        const targetIndex = maxIndex + 1 + k;
        const cloned = cloneShape(item.shape, { dx: 10, dy: 10 });
        clonedShapes.push(cloned);
        commands.push(new AddShapeCommand(this.stateManager, layerId, cloned, targetIndex));
      });
    }

    if (commands.length === 0) {
      return null;
    }

    if (commands.length === 1) {
      this.commandManager.executeCommand(commands[0]);
    } else {
      const batch = new BatchCommand(commands, 'Duplicate Shapes');
      this.commandManager.executeCommand(batch);
    }

    this.stateManager.setSelection(clonedShapes.map((s) => s.id));
    return asShapeArray(clonedShapes);
  }

  /**
   * Guarda una copia de las figuras seleccionadas en el portapapeles interno en memoria.
   * Reinicia el contador de desplazamientos de pegados consecutivos.
   * Retorna true si se copió con éxito o false si no había figuras seleccionadas.
   */
  public copy(): boolean {
    const layerMap = this.getSelectedShapesGroupedByLayer();
    if (layerMap.size === 0) {
      return false;
    }

    const doc = this.stateManager.getState();
    const entries: ClipboardEntry[] = [];

    for (const [layerId, items] of layerMap.entries()) {
      const layerIndex = doc.children.findIndex((l) => l.id === layerId);
      for (const item of items) {
        entries.push({
          shape: item.shape,
          layerId,
          layerIndex,
          shapeIndex: item.index,
        });
      }
    }

    entries.sort((a, b) => {
      if (a.layerIndex !== b.layerIndex) {
        return a.layerIndex - b.layerIndex;
      }
      return a.shapeIndex - b.shapeIndex;
    });

    this._clipboardEntries = entries;
    this._clipboard = createClipboardList(entries.map((e) => e.shape));
    this._pasteCount = 0;
    return true;
  }

  /**
   * Crea copias de las figuras del portapapeles conservando sus posiciones relativas
   * y orden de apilado relativo, desplazadas 10 px de forma acumulada en pegados consecutivos.
   * Las figuras se insertan en su capa de origen y quedan seleccionadas.
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

    const clonedShapes: Shape[] = [];
    const commands: AddShapeCommand[] = [];

    for (const entry of this._clipboardEntries) {
      let targetLayerId = entry.layerId;
      if (!this.stateManager.findNode(targetLayerId)) {
        targetLayerId = defaultLayerId;
      }
      if (!targetLayerId) {
        continue;
      }

      const cloned = cloneShape(entry.shape, { dx: offset, dy: offset });
      clonedShapes.push(cloned);
      commands.push(new AddShapeCommand(this.stateManager, targetLayerId, cloned));
    }

    if (commands.length === 0) {
      return null;
    }

    if (commands.length === 1) {
      this.commandManager.executeCommand(commands[0]);
    } else {
      const batch = new BatchCommand(commands, 'Paste Shapes');
      this.commandManager.executeCommand(batch);
    }

    this.stateManager.setSelection(clonedShapes.map((s) => s.id));
    return asShapeArray(clonedShapes);
  }

  /**
   * Elimina todas las figuras seleccionadas del Scene Graph mediante DeleteCommand.
   * Al deshacer, las restaura en sus posiciones e índices originales dentro de su capa.
   * Registra UNA sola entrada en el historial de comandos (DeleteCommand o BatchCommand).
   *
   * @returns true si se eliminaron figuras, false si no había selección
   */
  public deleteSelected(): boolean {
    const layerMap = this.getSelectedShapesGroupedByLayer();
    if (layerMap.size === 0) {
      return false;
    }

    const commands: DeleteCommand[] = [];

    for (const [layerId, items] of layerMap.entries()) {
      // Orden descendente de índice para que la eliminación no altere los índices inferiores
      const reversed = [...items].reverse();
      for (const item of reversed) {
        commands.push(new DeleteCommand(this.stateManager, item.shape, layerId, item.index));
      }
    }

    if (commands.length === 0) {
      return false;
    }

    if (commands.length === 1) {
      this.commandManager.executeCommand(commands[0]);
    } else {
      const batch = new BatchCommand(commands, 'Delete Shapes');
      this.commandManager.executeCommand(batch);
    }

    this.stateManager.setSelection([]);
    return true;
  }

  /**
   * Mueve todas las figuras seleccionadas por un desplazamiento relativo (dx, dy).
   * Omite figuras bloqueadas (locked).
   * Fusiona comandos consecutivos en el CommandManager (BatchCommand.mergeWith) dentro de un intervalo corto (400 ms).
   *
   * @param dx Desplazamiento horizontal en píxeles
   * @param dy Desplazamiento vertical en píxeles
   * @param timestamp Marca temporal opcional (para pruebas deterministas o repetición)
   * @returns true si las figuras fueron movidas, false en caso contrario
   */
  public moveSelection(dx: number, dy: number, timestamp?: number): boolean {
    if (dx === 0 && dy === 0) {
      return false;
    }

    const selectedShapes = this.stateManager.getSelectedNodes().filter((s): s is Shape => isShape(s) && !s.locked);
    if (selectedShapes.length === 0) {
      return false;
    }

    const now = timestamp ?? Date.now();

    if (selectedShapes.length === 1) {
      const shape = selectedShapes[0];
      const command = new TranslateCommand(
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
      this.commandManager.executeCommand(command);
      return true;
    }

    const commands = selectedShapes.map((shape) => {
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

    const batch = new BatchCommand(commands, 'Translate Shapes');
    this.commandManager.executeCommand(batch);
    return true;
  }

  /**
   * Alinea las figuras actualmente seleccionadas según el modo indicado.
   * Si hay menos de 2 figuras seleccionadas y no bloqueadas, o si ninguna figura cambia de posición,
   * no ejecuta nada ni registra historial.
   * Toda la operación se encapsula en UN solo BatchCommand de TranslateCommand.
   *
   * @param mode Modo de alineación ('left', 'center-h', 'right', 'top', 'center-v', 'bottom')
   * @returns true si se ejecutó y registró la alineación, false si no hubo cambios
   */
  public alignSelection(mode: AlignmentMode): boolean {
    const selectedShapes = this.stateManager.getSelectedNodes().filter((s): s is Shape => isShape(s) && !s.locked);
    if (selectedShapes.length < 2) {
      return false;
    }

    const entries = computeAlignment(selectedShapes, mode);
    if (entries.length === 0) {
      return false;
    }

    const shapeMap = new Map(selectedShapes.map((s) => [s.id, s]));
    const commands: TranslateCommand[] = [];

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const shape = shapeMap.get(entry.id);
      if (!shape) continue;

      commands.push(
        new TranslateCommand(
          this.stateManager,
          entry.id,
          shape.x,
          shape.y,
          entry.x,
          entry.y,
          { mergeTimeout: 0 }
        )
      );
    }

    if (commands.length === 0) {
      return false;
    }

    const batch = new BatchCommand(commands, `Alinear (${mode})`);
    this.commandManager.executeCommand(batch);
    return true;
  }

  /**
   * Distribuye las figuras actualmente seleccionadas uniformemente a lo largo del eje indicado,
   * manteniendo iguales los espacios libres entre figuras contiguas y fijas la primera y última figura.
   * Si hay menos de 3 figuras seleccionadas y no bloqueadas, o si ninguna figura cambia de posición,
   * no ejecuta nada ni registra historial.
   * Toda la operación se encapsula en UN solo BatchCommand de TranslateCommand.
   *
   * @param axis Eje de distribución ('horizontal' o 'vertical')
   * @returns true si se ejecutó y registró la distribución, false si no hubo cambios
   */
  public distributeSelection(axis: DistributionAxis): boolean {
    const selectedShapes = this.stateManager.getSelectedNodes().filter((s): s is Shape => isShape(s) && !s.locked);
    if (selectedShapes.length < 3) {
      return false;
    }

    const entries = computeDistribution(selectedShapes, axis);
    if (entries.length === 0) {
      return false;
    }

    const shapeMap = new Map(selectedShapes.map((s) => [s.id, s]));
    const commands: TranslateCommand[] = [];

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const shape = shapeMap.get(entry.id);
      if (!shape) continue;

      commands.push(
        new TranslateCommand(
          this.stateManager,
          entry.id,
          shape.x,
          shape.y,
          entry.x,
          entry.y,
          { mergeTimeout: 0 }
        )
      );
    }

    if (commands.length === 0) {
      return false;
    }

    const batch = new BatchCommand(commands, `Distribuir (${axis})`);
    this.commandManager.executeCommand(batch);
    return true;
  }
}
