import type { StateManager } from '../../state/StateManager.ts';
import { getLeafShapes } from '../../state/StateManager.ts';
import type { CommandManager } from '../../commands/CommandManager.ts';
import { StyleShapesCommand, type ShapeStyleChangeEntry } from '../../commands/StyleShapesCommand.ts';
import type { Shape, Vector2D, Gradient } from '../../types/scene-graph.ts';
import { isGradient } from '../../types/scene-graph.ts';
import type { ToolHandler } from './ToolHandler.ts';
import type { ToolMode } from '../InputController.ts';
import { sampleCanvasPixel, normalizeColor, NONE_PAINT } from '../../utils/color.ts';

export interface EyedropperSampleResult {
  readonly color: string | Gradient;
  readonly isGradient: boolean;
  readonly source: 'shape' | 'pixel' | 'none';
  readonly shapeId?: string;
  readonly targetProperty: 'fill' | 'stroke';
}

export interface EyedropperPreview {
  readonly screenX: number;
  readonly screenY: number;
  readonly color: string;
}

/**
 * Manejador especializado para la herramienta Cuentagotas (`eyedropper`).
 * Permite muestrear colores de relleno, contorno o degradados al hacer clic sobre cualquier
 * figura o píxel del canvas, aplicándolo automáticamente a la selección activa (con historial
 * reversible mediante StyleShapesCommand) o al estilo de dibujo activo (drawingStyle).
 */
export class EyedropperToolHandler implements ToolHandler {
  private readonly stateManager: StateManager;
  private readonly commandManager: CommandManager;
  private readonly canvas: HTMLCanvasElement;
  private readonly hitTest: (x: number, y: number) => Shape | null;
  private readonly emitEvent?: (event: 'colorSampled', data: EyedropperSampleResult) => void;

  private _preview: EyedropperPreview | null = null;
  private _lastSampledResult: EyedropperSampleResult | null = null;

  constructor(
    stateManager: StateManager,
    commandManager: CommandManager,
    canvas: HTMLCanvasElement,
    hitTest: (x: number, y: number) => Shape | null,
    emitEvent?: (event: 'colorSampled', data: EyedropperSampleResult) => void
  ) {
    this.stateManager = stateManager;
    this.commandManager = commandManager;
    this.canvas = canvas;
    this.hitTest = hitTest;
    this.emitEvent = emitEvent;
  }

  public get preview(): EyedropperPreview | null {
    return this._preview;
  }

  public get lastSampledResult(): EyedropperSampleResult | null {
    return this._lastSampledResult;
  }

  public onActivate(): void {
    this.canvas.style.cursor = 'crosshair';
  }

  public onDeactivate(_nextTool?: ToolMode): void {
    this._preview = null;
    this.stateManager.markDirty();
  }

  /**
   * Muestrea el color y estilo en las coordenadas especificadas (world y screen).
   * Prioriza la inspección de figuras del Scene Graph (conservando degradados y valores vectoriales exactos),
   * y recurre a la lectura directa de píxeles vía getImageData si no colisiona con figuras.
   */
  public sampleAt(
    worldCoords: Vector2D,
    screenX: number,
    screenY: number,
    shiftKey: boolean = false
  ): EyedropperSampleResult {
    const hitShape = this.hitTest(worldCoords.x, worldCoords.y);

    if (hitShape) {
      // Con Shift presionado, muestreamos el contorno (stroke)
      if (shiftKey) {
        const strokeColor = ('stroke' in hitShape && hitShape.stroke) ? hitShape.stroke : NONE_PAINT;
        return {
          color: strokeColor,
          isGradient: false,
          source: 'shape',
          shapeId: hitShape.id,
          targetProperty: 'stroke',
        };
      }

      // Sin Shift, muestreamos el relleno (fill)
      const fillPaint = hitShape.fill;
      if (isGradient(fillPaint)) {
        return {
          color: fillPaint,
          isGradient: true,
          source: 'shape',
          shapeId: hitShape.id,
          targetProperty: 'fill',
        };
      }

      if (fillPaint && fillPaint !== 'none' && fillPaint !== 'transparent') {
        return {
          color: fillPaint,
          isGradient: false,
          source: 'shape',
          shapeId: hitShape.id,
          targetProperty: 'fill',
        };
      }

      // Si la figura no tiene relleno o es 'none', muestreamos su contorno
      const strokePaint = ('stroke' in hitShape && hitShape.stroke) ? hitShape.stroke : NONE_PAINT;
      return {
        color: strokePaint,
        isGradient: false,
        source: 'shape',
        shapeId: hitShape.id,
        targetProperty: 'stroke',
      };
    }

    // Si no colisiona con figuras vectoriales, muestreamos el píxel renderizado en el canvas
    const ctx = typeof this.canvas.getContext === 'function' ? this.canvas.getContext('2d') : null;
    if (ctx && typeof ctx.getImageData === 'function') {
      const pixelColor = sampleCanvasPixel(ctx, screenX, screenY);
      return {
        color: pixelColor,
        isGradient: false,
        source: pixelColor === NONE_PAINT ? 'none' : 'pixel',
        targetProperty: shiftKey ? 'stroke' : 'fill',
      };
    }

    return {
      color: NONE_PAINT,
      isGradient: false,
      source: 'none',
      targetProperty: shiftKey ? 'stroke' : 'fill',
    };
  }

  public onMouseDown(event: MouseEvent, coords: Vector2D): void {
    if (event.button !== 0 && event.button !== undefined) {
      return;
    }

    const rect = typeof this.canvas.getBoundingClientRect === 'function'
      ? this.canvas.getBoundingClientRect()
      : { left: 0, top: 0 };
    const screenX = event.clientX !== undefined ? event.clientX - rect.left : coords.x;
    const screenY = event.clientY !== undefined ? event.clientY - rect.top : coords.y;

    const sample = this.sampleAt(coords, screenX, screenY, event.shiftKey);
    this._lastSampledResult = sample;

    this.applySampledColor(sample, event.shiftKey);
  }

  public onMouseMove(event: MouseEvent, coords: Vector2D): void {
    const rect = typeof this.canvas.getBoundingClientRect === 'function'
      ? this.canvas.getBoundingClientRect()
      : { left: 0, top: 0 };
    const screenX = event.clientX !== undefined ? event.clientX - rect.left : coords.x;
    const screenY = event.clientY !== undefined ? event.clientY - rect.top : coords.y;

    const sample = this.sampleAt(coords, screenX, screenY, event.shiftKey);

    let hexPreview = '#000000';
    if (sample.isGradient && isGradient(sample.color)) {
      hexPreview = sample.color.stops[0]?.color ?? '#38bdf8';
    } else if (typeof sample.color === 'string') {
      hexPreview = normalizeColor(sample.color) ?? (sample.color === NONE_PAINT ? 'transparent' : sample.color);
    }

    this._preview = {
      screenX,
      screenY,
      color: hexPreview,
    };

    this.stateManager.markDirty();
  }

  public onMouseUp(_event: MouseEvent, _coords: Vector2D): void {
    // El muestreo se aplica al hacer clic en onMouseDown
  }

  /**
   * Aplica el color muestreado a la selección activa (si existe) mediante StyleShapesCommand,
   * o bien actualiza el estilo de dibujo activo (drawingStyle) si no hay figuras seleccionadas.
   */
  public applySampledColor(sample: EyedropperSampleResult, shiftKey: boolean): void {
    const selectedNodes = this.stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes);

    if (leafShapes.length > 0) {
      const isTargetStroke = shiftKey || sample.targetProperty === 'stroke';

      const entries: ShapeStyleChangeEntry[] = leafShapes.map((shape) => {
        const beforeStyle = {
          fill: shape.fill,
          stroke: 'stroke' in shape ? shape.stroke : undefined,
          strokeWidth: 'strokeWidth' in shape ? shape.strokeWidth : undefined,
          opacity: shape.opacity,
        };

        const afterStyle = { ...beforeStyle };
        if (isTargetStroke) {
          afterStyle.stroke = typeof sample.color === 'string' ? sample.color : undefined;
        } else {
          afterStyle.fill = sample.color;
        }

        return {
          id: shape.id,
          before: beforeStyle,
          after: afterStyle,
        };
      });

      const cmd = new StyleShapesCommand(this.stateManager, entries);
      this.commandManager.executeCommand(cmd);
    } else {
      // Si no hay figuras seleccionadas, actualizar drawingStyle
      if (shiftKey || sample.targetProperty === 'stroke') {
        if (typeof sample.color === 'string') {
          this.stateManager.setDrawingStyle({ stroke: sample.color });
        }
      } else {
        const solidColor = isGradient(sample.color)
          ? (sample.color.stops[0]?.color ?? '#38bdf8')
          : sample.color;
        this.stateManager.setDrawingStyle({ fill: solidColor });
      }
    }

    this.emitEvent?.('colorSampled', sample);
  }
}
