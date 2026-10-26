import type { StateManager } from '../../state/StateManager.ts';
import type { CommandManager } from '../../commands/CommandManager.ts';
import { AddArtboardCommand } from '../../commands/AddArtboardCommand.ts';
import { DeleteArtboardCommand } from '../../commands/DeleteArtboardCommand.ts';
import { UpdateArtboardCommand } from '../../commands/UpdateArtboardCommand.ts';
import type { ViewportManager } from '../../utils/viewport.ts';
import type { Artboard, Vector2D, AABB } from '../../types/scene-graph.ts';
import type { SnapGuide } from '../../types/engine.ts';
import { calculateSnapping, calculateAnchoredSnapping } from '../../utils/geometry.ts';
import type { ToolHandler } from './ToolHandler.ts';
import type { ToolMode } from '../InputController.ts';

export type ArtboardHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export interface ArtboardBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Estrategia de herramienta para gestión interactiva de Mesas de Trabajo (Artboards).
 * Permite seleccionar, mover, redimensionar con tiradores y crear nuevas mesas interactivamente,
 * con soporte para guías inteligentes (Smart Guides / Snapping).
 */
export class ArtboardToolHandler implements ToolHandler {
  private readonly stateManager: StateManager;
  private readonly commandManager: CommandManager;
  private readonly canvas: HTMLCanvasElement;
  private readonly getViewportManager: () => ViewportManager;
  private readonly isSmartGuidesEnabled?: () => boolean;
  private readonly setActiveGuides?: (guides: SnapGuide[]) => void;

  // Estados de interacción
  private _isCreating: boolean = false;
  private _createStart: Vector2D | null = null;
  private _createCurrent: Vector2D | null = null;

  private _isMoving: boolean = false;
  private _moveStart: Vector2D | null = null;
  private _moveArtboardId: string | null = null;
  private _moveInitialBounds: ArtboardBounds | null = null;

  private _isResizing: boolean = false;
  private _resizeHandle: ArtboardHandle | null = null;
  private _resizeStart: Vector2D | null = null;
  private _resizeArtboardId: string | null = null;
  private _resizeInitialBounds: ArtboardBounds | null = null;

  constructor(
    stateManager: StateManager,
    commandManager: CommandManager,
    canvas: HTMLCanvasElement,
    getViewportManager: () => ViewportManager,
    isSmartGuidesEnabled?: () => boolean,
    setActiveGuides?: (guides: SnapGuide[]) => void
  ) {
    this.stateManager = stateManager;
    this.commandManager = commandManager;
    this.canvas = canvas;
    this.getViewportManager = getViewportManager;
    this.isSmartGuidesEnabled = isSmartGuidesEnabled;
    this.setActiveGuides = setActiveGuides;
  }

  public get isCreating(): boolean {
    return this._isCreating;
  }

  public get isMoving(): boolean {
    return this._isMoving;
  }

  public get isResizing(): boolean {
    return this._isResizing;
  }

  public get creationBox(): ArtboardBounds | null {
    if (!this._isCreating || !this._createStart || !this._createCurrent) {
      return null;
    }
    const minX = Math.min(this._createStart.x, this._createCurrent.x);
    const minY = Math.min(this._createStart.y, this._createCurrent.y);
    const width = Math.abs(this._createCurrent.x - this._createStart.x);
    const height = Math.abs(this._createCurrent.y - this._createStart.y);
    return { x: minX, y: minY, width, height };
  }

  public onActivate(): void {
    this.resetState();
    this.canvas.style.cursor = 'crosshair';
  }

  public onDeactivate(_nextTool: ToolMode): void {
    this.setActiveGuides?.([]);
    this.resetState();
  }

  public resetState(): void {
    this.setActiveGuides?.([]);
    this._isCreating = false;
    this._createStart = null;
    this._createCurrent = null;
    this._isMoving = false;
    this._moveStart = null;
    this._moveArtboardId = null;
    this._moveInitialBounds = null;
    this._isResizing = false;
    this._resizeHandle = null;
    this._resizeStart = null;
    this._resizeArtboardId = null;
    this._resizeInitialBounds = null;
    this.stateManager.markDirty();
  }

  private getArtboardSnapTargets(excludedArtboardId: string | null): AABB[] {
    const targets: AABB[] = [];
    const artboards = this.stateManager.getArtboards();
    for (const ab of artboards) {
      if (excludedArtboardId && ab.id === excludedArtboardId) continue;
      targets.push({
        minX: ab.x,
        minY: ab.y,
        maxX: ab.x + ab.width,
        maxY: ab.y + ab.height,
        width: ab.width,
        height: ab.height,
      });
    }

    if (this.stateManager.isGuidesVisible() && this.stateManager.isGuideSnappingEnabled()) {
      const userGuides = this.stateManager.getGuides();
      for (const g of userGuides) {
        if (g.axis === 'x') {
          targets.push({
            minX: g.position,
            maxX: g.position,
            minY: -100000,
            maxY: 100000,
            width: 0,
            height: 200000,
          });
        } else {
          targets.push({
            minX: -100000,
            maxX: 100000,
            minY: g.position,
            maxY: g.position,
            width: 200000,
            height: 0,
          });
        }
      }
    }
    return targets;
  }

  public onMouseDown(event: MouseEvent, coords: Vector2D): void {
    if (event.button !== 0 && event.button !== undefined) {
      return;
    }

    const zoom = this.getViewportManager().zoom || 1;
    const activeArtboard = this.stateManager.getActiveArtboard();

    // 1. Hit-test en los tiradores de redimensionado de la mesa activa
    if (activeArtboard) {
      const handle = this.getHandleUnderCursor(coords.x, coords.y, activeArtboard, zoom);
      if (handle) {
        this._isResizing = true;
        this._resizeHandle = handle;
        this._resizeStart = { ...coords };
        this._resizeArtboardId = activeArtboard.id;
        this._resizeInitialBounds = {
          x: activeArtboard.x,
          y: activeArtboard.y,
          width: activeArtboard.width,
          height: activeArtboard.height,
        };
        this.updateResizeCursor(handle);
        return;
      }
    }

    // 2. Hit-test para seleccionar o iniciar movimiento de una mesa existente
    const hitArtboard = this.stateManager.getArtboardAt(coords.x, coords.y);
    if (hitArtboard) {
      this.stateManager.setActiveArtboard(hitArtboard.id);
      this._isMoving = true;
      this._moveStart = { ...coords };
      this._moveArtboardId = hitArtboard.id;
      this._moveInitialBounds = {
        x: hitArtboard.x,
        y: hitArtboard.y,
        width: hitArtboard.width,
        height: hitArtboard.height,
      };
      this.canvas.style.cursor = 'move';
      this.stateManager.markDirty();
      return;
    }

    // 3. Clic en espacio vacío: iniciar creación interactiva de mesa de trabajo
    this._isCreating = true;
    this._createStart = { ...coords };
    this._createCurrent = { ...coords };
    this.canvas.style.cursor = 'crosshair';
    this.stateManager.markDirty();
  }

  public onMouseMove(_event: MouseEvent, coords: Vector2D): void {
    const zoom = this.getViewportManager().zoom || 1;

    // A. Redimensionado en curso con guías inteligentes
    if (this._isResizing && this._resizeInitialBounds && this._resizeStart && this._resizeArtboardId && this._resizeHandle) {
      const dx = coords.x - this._resizeStart.x;
      const dy = coords.y - this._resizeStart.y;
      const initial = this._resizeInitialBounds;

      let newX = initial.x;
      let newY = initial.y;
      let newWidth = initial.width;
      let newHeight = initial.height;

      let fixedXFeature: 0 | 2 | 'all' = 'all';
      let fixedYFeature: 0 | 2 | 'all' = 'all';

      switch (this._resizeHandle) {
        case 'nw':
          newX = initial.x + dx;
          newY = initial.y + dy;
          newWidth = initial.width - dx;
          newHeight = initial.height - dy;
          fixedXFeature = 2;
          fixedYFeature = 2;
          break;
        case 'n':
          newY = initial.y + dy;
          newHeight = initial.height - dy;
          fixedYFeature = 2;
          break;
        case 'ne':
          newY = initial.y + dy;
          newWidth = initial.width + dx;
          newHeight = initial.height - dy;
          fixedXFeature = 0;
          fixedYFeature = 2;
          break;
        case 'e':
          newWidth = initial.width + dx;
          fixedXFeature = 0;
          break;
        case 'se':
          newWidth = initial.width + dx;
          newHeight = initial.height + dy;
          fixedXFeature = 0;
          fixedYFeature = 0;
          break;
        case 's':
          newHeight = initial.height + dy;
          fixedYFeature = 0;
          break;
        case 'sw':
          newX = initial.x + dx;
          newWidth = initial.width - dx;
          newHeight = initial.height + dy;
          fixedXFeature = 2;
          fixedYFeature = 0;
          break;
        case 'w':
          newX = initial.x + dx;
          newWidth = initial.width - dx;
          fixedXFeature = 2;
          break;
      }

      if (this.isSmartGuidesEnabled?.()) {
        const rawAABB: AABB = {
          minX: newX,
          minY: newY,
          maxX: newX + newWidth,
          maxY: newY + newHeight,
          width: newWidth,
          height: newHeight,
        };
        const targets = this.getArtboardSnapTargets(this._resizeArtboardId);
        const tolerance = 6 / zoom;
        const snap = calculateAnchoredSnapping(rawAABB, targets, fixedXFeature, fixedYFeature, tolerance);
        if (fixedXFeature === 0) {
          newWidth += snap.dx;
        } else if (fixedXFeature === 2) {
          newX += snap.dx;
          newWidth -= snap.dx;
        }
        if (fixedYFeature === 0) {
          newHeight += snap.dy;
        } else if (fixedYFeature === 2) {
          newY += snap.dy;
          newHeight -= snap.dy;
        }
        this.setActiveGuides?.(snap.guides);
      } else {
        this.setActiveGuides?.([]);
      }

      if (newWidth < 20) {
        if (this._resizeHandle.includes('w')) {
          newX = initial.x + initial.width - 20;
        }
        newWidth = 20;
      }
      if (newHeight < 20) {
        if (this._resizeHandle.includes('n')) {
          newY = initial.y + initial.height - 20;
        }
        newHeight = 20;
      }

      this.stateManager.updateArtboard(this._resizeArtboardId, {
        x: Math.round(newX),
        y: Math.round(newY),
        width: Math.round(newWidth),
        height: Math.round(newHeight),
      });
      return;
    }

    // B. Desplazamiento en curso con guías inteligentes
    if (this._isMoving && this._moveInitialBounds && this._moveStart && this._moveArtboardId) {
      const dx = coords.x - this._moveStart.x;
      const dy = coords.y - this._moveStart.y;
      let finalX = this._moveInitialBounds.x + dx;
      let finalY = this._moveInitialBounds.y + dy;

      if (this.isSmartGuidesEnabled?.()) {
        const movingAABB: AABB = {
          minX: finalX,
          minY: finalY,
          maxX: finalX + this._moveInitialBounds.width,
          maxY: finalY + this._moveInitialBounds.height,
          width: this._moveInitialBounds.width,
          height: this._moveInitialBounds.height,
        };
        const targets = this.getArtboardSnapTargets(this._moveArtboardId);
        const tolerance = 6 / zoom;
        const snap = calculateSnapping(movingAABB, targets, tolerance);
        finalX += snap.dx;
        finalY += snap.dy;
        this.setActiveGuides?.(snap.guides);
      } else {
        this.setActiveGuides?.([]);
      }

      this.stateManager.updateArtboard(this._moveArtboardId, {
        x: Math.round(finalX),
        y: Math.round(finalY),
      });
      return;
    }

    // C. Creación en curso con guías inteligentes
    if (this._isCreating && this._createStart) {
      let currentX = coords.x;
      let currentY = coords.y;

      if (this.isSmartGuidesEnabled?.()) {
        const minX = Math.min(this._createStart.x, coords.x);
        const minY = Math.min(this._createStart.y, coords.y);
        const width = Math.abs(coords.x - this._createStart.x);
        const height = Math.abs(coords.y - this._createStart.y);

        const fixedXFeature: 0 | 2 = coords.x >= this._createStart.x ? 0 : 2;
        const fixedYFeature: 0 | 2 = coords.y >= this._createStart.y ? 0 : 2;

        const candidateAABB: AABB = {
          minX,
          minY,
          maxX: minX + width,
          maxY: minY + height,
          width,
          height,
        };
        const targets = this.getArtboardSnapTargets(null);
        const tolerance = 6 / zoom;
        const snap = calculateAnchoredSnapping(candidateAABB, targets, fixedXFeature, fixedYFeature, tolerance);
        currentX += snap.dx;
        currentY += snap.dy;
        this.setActiveGuides?.(snap.guides);
      } else {
        this.setActiveGuides?.([]);
      }

      this._createCurrent = { x: currentX, y: currentY };
      this.stateManager.markDirty();
      return;
    }

    // D. Cursor dinámico según hover
    this.setActiveGuides?.([]);
    const activeArtboard = this.stateManager.getActiveArtboard();
    if (activeArtboard) {
      const handle = this.getHandleUnderCursor(coords.x, coords.y, activeArtboard, zoom);
      if (handle) {
        this.updateResizeCursor(handle);
        return;
      }
    }

    const hitArtboard = this.stateManager.getArtboardAt(coords.x, coords.y);
    if (hitArtboard) {
      this.canvas.style.cursor = hitArtboard.id === activeArtboard?.id ? 'move' : 'pointer';
    } else {
      this.canvas.style.cursor = 'crosshair';
    }
  }

  public onMouseUp(_event: MouseEvent, coords: Vector2D): void {
    // 1. Finalizar redimensionado
    if (this._isResizing && this._resizeArtboardId && this._resizeInitialBounds) {
      const currentArtboard = this.stateManager.getArtboards().find((a) => a.id === this._resizeArtboardId);
      if (currentArtboard) {
        const initial = this._resizeInitialBounds;
        const hasChanged =
          initial.x !== currentArtboard.x ||
          initial.y !== currentArtboard.y ||
          initial.width !== currentArtboard.width ||
          initial.height !== currentArtboard.height;

        if (hasChanged) {
          const cmd = new UpdateArtboardCommand(
            this.stateManager,
            this._resizeArtboardId,
            { x: initial.x, y: initial.y, width: initial.width, height: initial.height },
            { x: currentArtboard.x, y: currentArtboard.y, width: currentArtboard.width, height: currentArtboard.height }
          );
          this.commandManager.recordCommand(cmd);
        }
      }
      this.resetState();
      return;
    }

    // 2. Finalizar desplazamiento
    if (this._isMoving && this._moveArtboardId && this._moveInitialBounds) {
      const currentArtboard = this.stateManager.getArtboards().find((a) => a.id === this._moveArtboardId);
      if (currentArtboard) {
        const initial = this._moveInitialBounds;
        const hasChanged = initial.x !== currentArtboard.x || initial.y !== currentArtboard.y;

        if (hasChanged) {
          const cmd = new UpdateArtboardCommand(
            this.stateManager,
            this._moveArtboardId,
            { x: initial.x, y: initial.y },
            { x: currentArtboard.x, y: currentArtboard.y }
          );
          this.commandManager.recordCommand(cmd);
        }
      }
      this.resetState();
      return;
    }

    // 3. Finalizar creación
    if (this._isCreating && this._createStart) {
      const current = this._createCurrent ?? coords;
      const width = Math.abs(current.x - this._createStart.x);
      const height = Math.abs(current.y - this._createStart.y);
      const minX = Math.min(this._createStart.x, current.x);
      const minY = Math.min(this._createStart.y, current.y);

      const allArtboards = this.stateManager.getArtboards();
      const nextIndex = allArtboards.length + 1;

      let finalArtboard: Artboard;
      if (width >= 20 && height >= 20) {
        finalArtboard = {
          id: `artboard-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          name: `Mesa de Trabajo ${nextIndex}`,
          x: Math.round(minX),
          y: Math.round(minY),
          width: Math.round(width),
          height: Math.round(height),
          backgroundColor: '#ffffff',
        };
      } else {
        // Clic simple en el vacío: crear mesa con tamaño estándar (800 × 600 px)
        finalArtboard = {
          id: `artboard-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          name: `Mesa de Trabajo ${nextIndex}`,
          x: Math.round(this._createStart.x),
          y: Math.round(this._createStart.y),
          width: 800,
          height: 600,
          backgroundColor: '#ffffff',
        };
      }

      this.commandManager.executeCommand(new AddArtboardCommand(this.stateManager, finalArtboard));
      this.resetState();
      return;
    }

    this.resetState();
  }

  public onKeyDown(event: KeyboardEvent): boolean {
    const key = event.key?.toLowerCase();

    if (key === 'delete' || key === 'backspace') {
      const activeArtboard = this.stateManager.getActiveArtboard();
      const artboards = this.stateManager.getArtboards();

      if (activeArtboard && artboards.length > 1) {
        event.preventDefault?.();
        this.commandManager.executeCommand(new DeleteArtboardCommand(this.stateManager, activeArtboard));
        return true;
      }
    }

    if (key === 'escape') {
      this.resetState();
      return true;
    }

    return false;
  }

  public destroy(): void {
    this.resetState();
  }

  /**
   * Determina si el cursor se encuentra posicionado sobre alguno de los 8 tiradores perimetrales
   */
  public getHandleUnderCursor(
    worldX: number,
    worldY: number,
    artboard: Artboard,
    zoom: number
  ): ArtboardHandle | null {
    const tolerance = Math.max(7, 9 / zoom);
    const { x, y, width, height } = artboard;
    const midX = x + width / 2;
    const midY = y + height / 2;
    const maxX = x + width;
    const maxY = y + height;

    const handles: Array<{ handle: ArtboardHandle; hx: number; hy: number }> = [
      { handle: 'nw', hx: x, hy: y },
      { handle: 'n', hx: midX, hy: y },
      { handle: 'ne', hx: maxX, hy: y },
      { handle: 'e', hx: maxX, hy: midY },
      { handle: 'se', hx: maxX, hy: maxY },
      { handle: 's', hx: midX, hy: maxY },
      { handle: 'sw', hx: x, hy: maxY },
      { handle: 'w', hx: x, hy: midY },
    ];

    for (const item of handles) {
      if (Math.hypot(worldX - item.hx, worldY - item.hy) <= tolerance) {
        return item.handle;
      }
    }

    return null;
  }

  private updateResizeCursor(handle: ArtboardHandle): void {
    switch (handle) {
      case 'nw':
      case 'se':
        this.canvas.style.cursor = 'nwse-resize';
        break;
      case 'ne':
      case 'sw':
        this.canvas.style.cursor = 'nesw-resize';
        break;
      case 'n':
      case 's':
        this.canvas.style.cursor = 'ns-resize';
        break;
      case 'e':
      case 'w':
        this.canvas.style.cursor = 'ew-resize';
        break;
    }
  }
}
