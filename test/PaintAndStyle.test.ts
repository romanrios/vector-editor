import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHexColor,
  isNonePaint,
  normalizeColor,
  getPaintState,
  NONE_PAINT,
} from '../src/utils/color.ts';
import { StateManager } from '../src/state/StateManager.ts';
import { RenderEngine } from '../src/render/RenderEngine.ts';
import { StyleShapesCommand } from '../src/commands/StyleShapesCommand.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { InputController } from '../src/input/InputController.ts';
import { toValidHexColor } from '../src/main.ts';
import type { Rectangle, Ellipse, Path, Layer, Group, Shape } from '../src/types/scene-graph.ts';

// Mock de Canvas y CanvasRenderingContext2D para testing headless
function createMockCanvas(): {
  canvas: HTMLCanvasElement;
  calls: string[];
  fillStyles: string[];
  strokeStyles: string[];
} {
  const calls: string[] = [];
  const fillStyles: string[] = [];
  const strokeStyles: string[] = [];

  let currentFillStyle = '';
  let currentStrokeStyle = '';

  const mockCtx: Partial<CanvasRenderingContext2D> = {
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    setTransform: () => calls.push('setTransform'),
    clearRect: () => calls.push('clearRect'),
    fillRect: () => calls.push('fillRect'),
    beginPath: () => calls.push('beginPath'),
    moveTo: () => calls.push('moveTo'),
    lineTo: () => calls.push('lineTo'),
    bezierCurveTo: () => calls.push('bezierCurveTo'),
    closePath: () => calls.push('closePath'),
    stroke: () => {
      calls.push('stroke');
      strokeStyles.push(currentStrokeStyle);
    },
    fill: () => {
      calls.push('fill');
      fillStyles.push(currentFillStyle);
    },
    arc: () => calls.push('arc'),
    rect: () => calls.push('rect'),
    roundRect: () => calls.push('roundRect'),
    strokeRect: () => calls.push('strokeRect'),
    ellipse: () => calls.push('ellipse'),
    translate: () => calls.push('translate'),
    rotate: () => calls.push('rotate'),
    setLineDash: () => calls.push('setLineDash'),
    get fillStyle() {
      return currentFillStyle;
    },
    set fillStyle(val: string) {
      currentFillStyle = val;
    },
    get strokeStyle() {
      return currentStrokeStyle;
    },
    set strokeStyle(val: string) {
      currentStrokeStyle = val;
    },
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
  };

  const listeners: Record<string, ((e: unknown) => void)[]> = {};

  const mockCanvas = {
    width: 800,
    height: 600,
    style: { cursor: 'default' },
    getBoundingClientRect: () => ({ width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600, x: 0, y: 0 }),
    getContext: (contextId: string) => {
      if (contextId === '2d') return mockCtx as CanvasRenderingContext2D;
      return null;
    },
    addEventListener: (type: string, listener: (e: unknown) => void) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(listener);
    },
    removeEventListener: (type: string, listener: (e: unknown) => void) => {
      if (!listeners[type]) return;
      listeners[type] = listeners[type].filter((l) => l !== listener);
    },
    dispatchSimulatedEvent: (type: string, event: unknown) => {
      if (listeners[type]) {
        for (const listener of listeners[type]) {
          listener(event);
        }
      }
    },
  } as unknown as HTMLCanvasElement & { dispatchSimulatedEvent: (type: string, e: unknown) => void };

  return { canvas: mockCanvas, calls, fillStyles, strokeStyles };
}

describe('color.ts', () => {
  it('parseHexColor: casos válidos e inválidos', () => {
    // Válidos
    assert.equal(parseHexColor('#abc'), '#aabbcc');
    assert.equal(parseHexColor('abc'), '#aabbcc');
    assert.equal(parseHexColor('#ABC'), '#aabbcc');
    assert.equal(parseHexColor('#aabbcc'), '#aabbcc');
    assert.equal(parseHexColor('aabbcc'), '#aabbcc');
    assert.equal(parseHexColor('  #123456  '), '#123456');
    assert.equal(parseHexColor(' #F0A '), '#ff00aa');

    // Inválidos
    assert.equal(parseHexColor('#aabbccdd'), null); // 8 dígitos
    assert.equal(parseHexColor('aabbccdd'), null);
    assert.equal(parseHexColor('#abcd'), null); // 4 dígitos
    assert.equal(parseHexColor('#12'), null); // 2 dígitos
    assert.equal(parseHexColor(''), null);
    assert.equal(parseHexColor('   '), null);
    assert.equal(parseHexColor('#xyz'), null);
    assert.equal(parseHexColor('hello'), null);
    assert.equal(parseHexColor(null as unknown as string), null);
    assert.equal(parseHexColor(undefined as unknown as string), null);
  });

  it('isNonePaint: undefined, null, "", "none" y "transparent" sin distinguir mayúsculas ni espacios', () => {
    assert.equal(NONE_PAINT, 'none');
    assert.equal(isNonePaint(undefined), true);
    assert.equal(isNonePaint(null), true);
    assert.equal(isNonePaint(''), true);
    assert.equal(isNonePaint('   '), true);
    assert.equal(isNonePaint('none'), true);
    assert.equal(isNonePaint('NONE'), true);
    assert.equal(isNonePaint('  None  '), true);
    assert.equal(isNonePaint('transparent'), true);
    assert.equal(isNonePaint('TRANSPARENT'), true);
    assert.equal(isNonePaint('  Transparent  '), true);

    // Valores no-none
    assert.equal(isNonePaint('#ff0000'), false);
    assert.equal(isNonePaint('red'), false);
    assert.equal(isNonePaint('rgb(0, 0, 0)'), false);
    assert.equal(isNonePaint('rgba(0, 0, 0, 0)'), false);
    assert.equal(isNonePaint('none1'), false);
  });

  it('normalizeColor: hex y rgb()/rgba() a hex', () => {
    assert.equal(normalizeColor('rgb(255, 0, 128)'), '#ff0080');
    assert.equal(normalizeColor('rgba(0, 255, 0, 0.5)'), '#00ff00');
    assert.equal(normalizeColor('rgb( 0 , 0 , 0 )'), '#000000');
    assert.equal(normalizeColor('#abc'), '#aabbcc');
    assert.equal(normalizeColor('#112233'), '#112233');
    assert.equal(normalizeColor('ff8800'), '#ff8800');

    // Casos no reconocidos
    assert.equal(normalizeColor('none'), null);
    assert.equal(normalizeColor('transparent'), null);
    assert.equal(normalizeColor('invalid-color'), null);
    assert.equal(normalizeColor(''), null);
    assert.equal(normalizeColor(undefined), null);
    assert.equal(normalizeColor(null), null);
  });

  it('getPaintState: none, color, mixed y lista vacía', () => {
    // Lista vacía
    assert.deepEqual(getPaintState([], 'fill'), { kind: 'none' });
    assert.deepEqual(getPaintState([], 'stroke'), { kind: 'none' });

    // Todos none / transparent / undefined
    const shapeNone1: Partial<Shape> = { id: 's1', fill: 'none', stroke: undefined };
    const shapeNone2: Partial<Shape> = { id: 's2', fill: 'transparent', stroke: 'none' };
    const shapeNone3: Partial<Shape> = { id: 's3', fill: '', stroke: 'transparent' };
    assert.deepEqual(getPaintState([shapeNone1, shapeNone2, shapeNone3] as Shape[], 'fill'), { kind: 'none' });
    assert.deepEqual(getPaintState([shapeNone1, shapeNone2, shapeNone3] as Shape[], 'stroke'), { kind: 'none' });

    // Mismo color normalizado
    const shapeColor1: Partial<Shape> = { id: 's1', fill: '#ff0000' };
    const shapeColor2: Partial<Shape> = { id: 's2', fill: '#F00' };
    const shapeColor3: Partial<Shape> = { id: 's3', fill: 'rgb(255, 0, 0)' };
    assert.deepEqual(getPaintState([shapeColor1, shapeColor2, shapeColor3] as Shape[], 'fill'), {
      kind: 'color',
      hex: '#ff0000',
    });

    // Mixto: color y none
    assert.deepEqual(getPaintState([shapeColor1, shapeNone1] as Shape[], 'fill'), { kind: 'mixed' });

    // Mixto: dos colores distintos
    const shapeColorBlue: Partial<Shape> = { id: 'sb', fill: '#0000ff' };
    assert.deepEqual(getPaintState([shapeColor1, shapeColorBlue] as Shape[], 'fill'), { kind: 'mixed' });
  });
});

describe('RenderEngine - Sin relleno y sin contorno', () => {
  it('con "none" y con "transparent" NO se llama a fill ni a stroke', () => {
    const { canvas, calls, strokeStyles } = createMockCanvas();
    const manager = new StateManager();

    const rect: Rectangle = {
      id: 'rect-none',
      type: 'rectangle',
      name: 'Rect None',
      x: 10,
      y: 10,
      width: 50,
      height: 50,
      fill: 'none',
      stroke: 'transparent',
      strokeWidth: 2,
    };

    const ellipse: Ellipse = {
      id: 'ellipse-none',
      type: 'ellipse',
      name: 'Ellipse None',
      x: 100,
      y: 100,
      radiusX: 20,
      radiusY: 20,
      fill: 'transparent',
      stroke: 'none',
      strokeWidth: 2,
    };

    const path: Path = {
      id: 'path-none',
      type: 'path',
      name: 'Path None',
      x: 0,
      y: 0,
      points: [
        { x: 0, y: 0 },
        { x: 50, y: 50 },
        { x: 100, y: 0 },
      ],
      closed: true,
      fill: 'none',
      stroke: 'none',
      strokeWidth: 2,
    };

    manager.addShape('layer-default', rect);
    manager.addShape('layer-default', ellipse);
    manager.addShape('layer-default', path);

    const engine = new RenderEngine(canvas, manager, { highDpi: false });
    engine.render();

    // Las figuras fueron procesadas
    assert.ok(calls.includes('rect'), 'El rectángulo debe haber dibujado su trazado');
    assert.ok(calls.includes('ellipse'), 'La elipse debe haber dibujado su trazado');
    assert.ok(calls.includes('bezierCurveTo'), 'El trazado Bézier debe haber dibujado sus curvas');

    const fillCount = calls.filter((c) => c === 'fill').length;
    // La única llamada a stroke proviene de la cuadrícula de fondo (renderGrid)
    const shapeStrokeCount = strokeStyles.filter((s) => s !== 'rgba(255, 255, 255, 0.025)').length;

    assert.equal(fillCount, 0, 'No debe llamarse a fill para figuras con fill "none" o "transparent"');
    assert.equal(shapeStrokeCount, 0, 'No debe llamarse a stroke para figuras con stroke "none" o "transparent"');
  });

  it('un rectángulo con color seguido de otro sin relleno no hereda el color anterior', () => {
    const { canvas, calls, fillStyles } = createMockCanvas();
    const manager = new StateManager();

    const rectColor: Rectangle = {
      id: 'rect-color',
      type: 'rectangle',
      name: 'Rect Color',
      x: 10,
      y: 10,
      width: 50,
      height: 50,
      fill: '#ff0000',
      stroke: 'none',
      strokeWidth: 0,
    };

    const rectNoFill: Rectangle = {
      id: 'rect-no-fill',
      type: 'rectangle',
      name: 'Rect No Fill',
      x: 70,
      y: 10,
      width: 50,
      height: 50,
      fill: 'none',
      stroke: 'none',
      strokeWidth: 0,
    };

    manager.addShape('layer-default', rectColor);
    manager.addShape('layer-default', rectNoFill);

    const engine = new RenderEngine(canvas, manager, { highDpi: false });
    engine.render();

    const fillCalls = calls.filter((c) => c === 'fill');
    assert.equal(fillCalls.length, 1, 'Solo debe ejecutarse fill() para el rectángulo que tiene color');
    assert.deepEqual(fillStyles, ['#ff0000'], 'El segundo rectángulo no debe haber ejecutado fill()');
  });
});

describe('StateManager.updateShapesStyle', () => {
  it('una sola notificación, estructura compartida y grupos anidados', () => {
    const manager = new StateManager();

    const shape1: Rectangle = {
      id: 'shape-1',
      type: 'rectangle',
      name: 'S1',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      fill: '#000000',
    };

    const shape2: Rectangle = {
      id: 'shape-2',
      type: 'rectangle',
      name: 'S2',
      x: 10,
      y: 10,
      width: 10,
      height: 10,
      fill: '#222222',
    };

    const shape3: Rectangle = {
      id: 'shape-3',
      type: 'rectangle',
      name: 'S3',
      x: 20,
      y: 20,
      width: 10,
      height: 10,
      fill: '#333333',
      strokeWidth: 1,
    };

    const innerGroup: Group = {
      id: 'inner-group',
      type: 'group',
      name: 'Inner Group',
      children: [shape3],
    };

    const outerGroup: Group = {
      id: 'outer-group',
      type: 'group',
      name: 'Outer Group',
      children: [shape2, innerGroup],
    };

    manager.addShape('layer-default', shape1);
    manager.addNode('layer-default', outerGroup);

    // Añadir una segunda capa no afectada
    const untouchedLayer: Layer = {
      id: 'layer-untouched',
      type: 'layer',
      name: 'Untouched Layer',
      children: [
        {
          id: 'shape-untouched',
          type: 'rectangle',
          name: 'Untouched Shape',
          x: 50,
          y: 50,
          width: 20,
          height: 20,
          fill: '#abcdef',
        },
      ],
    };
    manager.addLayer(untouchedLayer);

    const stateBefore = manager.getState();
    const untouchedLayerBefore = stateBefore.children.find((l) => l.id === 'layer-untouched');
    const shape1Before = manager.findNode('shape-1');
    const shape2Before = manager.findNode('shape-2');

    let notificationCount = 0;
    manager.subscribe(() => {
      notificationCount++;
    });

    // Actualizar shape-3 en el grupo anidado y shape-1 en la capa raíz
    const changed = manager.updateShapesStyle([
      { id: 'shape-3', style: { fill: '#ffffff', strokeWidth: 5 } },
      { id: 'shape-1', style: { fill: '#aaaaaa' } },
    ]);

    assert.equal(changed, true, 'updateShapesStyle debe retornar true al haber cambios');
    assert.equal(notificationCount, 1, 'Debe emitir exactamente una sola notificación');

    const stateAfter = manager.getState();
    const untouchedLayerAfter = stateAfter.children.find((l) => l.id === 'layer-untouched');
    const shape1After = manager.findNode('shape-1') as Rectangle;
    const shape2After = manager.findNode('shape-2') as Rectangle;
    const shape3After = manager.findNode('shape-3') as Rectangle;

    // Persistencia estructural
    assert.equal(untouchedLayerAfter, untouchedLayerBefore, 'La capa no afectada debe preservar su referencia');
    assert.equal(shape2After, shape2Before, 'shape-2 no afectado en el grupo debe preservar su referencia');
    assert.notEqual(shape1After, shape1Before, 'shape-1 modificado debe renovar su referencia');

    // Actualizaciones aplicadas
    assert.equal(shape1After.fill, '#aaaaaa');
    assert.equal(shape3After.fill, '#ffffff');
    assert.equal(shape3After.strokeWidth, 5);

    // Llamar sin cambios devuelve false y no notifica
    const noOpChanged = manager.updateShapesStyle([
      { id: 'shape-3', style: { fill: '#ffffff', strokeWidth: 5 } },
    ]);
    assert.equal(noOpChanged, false);
    assert.equal(notificationCount, 1);
  });
});

describe('StyleShapesCommand', () => {
  it('ejecutar, deshacer y rehacer; sin cambios no registra', () => {
    const manager = new StateManager();
    const cmdManager = new CommandManager();

    const shape: Rectangle = {
      id: 'shape-style-cmd',
      type: 'rectangle',
      name: 'Shape Style Cmd',
      x: 0,
      y: 0,
      width: 20,
      height: 20,
      fill: '#000000',
      stroke: 'none',
      strokeWidth: 1,
    };
    manager.addShape('layer-default', shape);

    // 1. Comando sin cambios: isAlreadyAtTarget === true y no registra
    const noOpCommand = new StyleShapesCommand(manager, [
      {
        id: 'shape-style-cmd',
        before: { fill: '#000000', stroke: 'none', strokeWidth: 1 },
        after: { fill: '#000000', stroke: 'none', strokeWidth: 1 },
      },
    ]);
    assert.equal(noOpCommand.isAlreadyAtTarget, true);
    cmdManager.executeCommand(noOpCommand);
    assert.equal(cmdManager.canUndo(), false, 'Comando sin cambios no debe registrarse en el historial');

    // 2. Comando con cambios
    const command = new StyleShapesCommand(manager, [
      {
        id: 'shape-style-cmd',
        before: { fill: '#000000', stroke: 'none', strokeWidth: 1 },
        after: { fill: '#ff0000', stroke: '#00ff00', strokeWidth: 3 },
      },
    ]);
    assert.equal(command.isAlreadyAtTarget, false);

    cmdManager.executeCommand(command);
    assert.equal(cmdManager.canUndo(), true);

    const shapeAfterExec = manager.findNode('shape-style-cmd') as Rectangle;
    assert.equal(shapeAfterExec.fill, '#ff0000');
    assert.equal(shapeAfterExec.stroke, '#00ff00');
    assert.equal(shapeAfterExec.strokeWidth, 3);

    // Deshacer (undo)
    cmdManager.undo();
    const shapeAfterUndo = manager.findNode('shape-style-cmd') as Rectangle;
    assert.equal(shapeAfterUndo.fill, '#000000');
    assert.equal(shapeAfterUndo.stroke, 'none');
    assert.equal(shapeAfterUndo.strokeWidth, 1);

    // Rehacer (redo)
    cmdManager.redo();
    const shapeAfterRedo = manager.findNode('shape-style-cmd') as Rectangle;
    assert.equal(shapeAfterRedo.fill, '#ff0000');
    assert.equal(shapeAfterRedo.stroke, '#00ff00');
    assert.equal(shapeAfterRedo.strokeWidth, 3);
  });
});

describe('toValidHexColor (compatibilidad)', () => {
  it('sigue pasando sus comportamientos esperados', () => {
    assert.equal(toValidHexColor('#ff0000'), '#ff0000');
    assert.equal(toValidHexColor('#f00'), '#ff0000');
    assert.equal(toValidHexColor('rgb(255, 0, 0)'), '#ff0000');
    assert.equal(toValidHexColor('rgba(0, 255, 0, 0.5)'), '#00ff00');
    assert.equal(toValidHexColor('invalid', '#123456'), '#123456');
    assert.equal(toValidHexColor(undefined, '#123456'), '#123456');
    assert.equal(toValidHexColor(null, '#123456'), '#123456');
    assert.equal(toValidHexColor('none', '#000000'), '#000000');
  });
});

describe('Estilo de dibujo actual (drawingStyle)', () => {
  it('tras setDrawingStyle({fill:"#ff0000", stroke:"#00ff00", strokeWidth:5}), un rectángulo y una elipse creados por arrastre nacen con esos valores y opacity 1', () => {
    const manager = new StateManager();
    const cmdManager = new CommandManager();
    const { canvas } = createMockCanvas();
    const controller = new InputController(canvas, manager, cmdManager);

    manager.setDrawingStyle({
      fill: '#ff0000',
      stroke: '#00ff00',
      strokeWidth: 5,
    });

    const style = manager.getDrawingStyle();
    assert.equal(style.fill, '#ff0000');
    assert.equal(style.stroke, '#00ff00');
    assert.equal(style.strokeWidth, 5);

    // 1. Crear rectángulo por arrastre
    controller.setTool('rectangle');
    (canvas as any).dispatchSimulatedEvent('mousedown', { clientX: 50, clientY: 50 });
    (canvas as any).dispatchSimulatedEvent('mousemove', { clientX: 150, clientY: 120 });
    (canvas as any).dispatchSimulatedEvent('mouseup', { clientX: 150, clientY: 120 });

    const shapes = manager.getState().children[0].children;
    const rect = shapes[shapes.length - 1] as Rectangle;
    assert.equal(rect.type, 'rectangle');
    assert.equal(rect.fill, '#ff0000');
    assert.equal(rect.stroke, '#00ff00');
    assert.equal(rect.strokeWidth, 5);
    assert.equal(rect.opacity, 1);

    // 2. Crear elipse por arrastre
    controller.setTool('ellipse');
    (canvas as any).dispatchSimulatedEvent('mousedown', { clientX: 200, clientY: 200 });
    (canvas as any).dispatchSimulatedEvent('mousemove', { clientX: 300, clientY: 280 });
    (canvas as any).dispatchSimulatedEvent('mouseup', { clientX: 300, clientY: 280 });

    const updatedShapes = manager.getState().children[0].children;
    const ellipse = updatedShapes[updatedShapes.length - 1] as Ellipse;
    assert.equal(ellipse.type, 'ellipse');
    assert.equal(ellipse.fill, '#ff0000');
    assert.equal(ellipse.stroke, '#00ff00');
    assert.equal(ellipse.strokeWidth, 5);
    assert.equal(ellipse.opacity, 1);

    controller.destroy();
  });
});
