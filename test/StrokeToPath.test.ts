import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { InputController } from '../src/input/InputController.ts';
import { OutlineStrokeCommand } from '../src/commands/OutlineStrokeCommand.ts';
import {
  canOutlineStroke,
  expandShapeStroke,
  outlineOpenPolyline,
  outlineStroke,
} from '../src/utils/strokeToPath.ts';
import {
  executeBooleanOperation,
  isClosedShape,
} from '../src/utils/booleanOperations.ts';
import {
  isGroup,
  isShape,
  type Ellipse,
  type Path,
  type Polygon,
  type Rectangle,
  type Star,
} from '../src/types/scene-graph.ts';

describe('Stroke to Path (Contornear Trazado / Outline Stroke)', () => {
  describe('1. canOutlineStroke', () => {
    it('detecta figuras con borde susceptible de contornear', () => {
      const linePath: Path = {
        id: 'p1',
        type: 'path',
        name: 'Línea',
        x: 0,
        y: 0,
        closed: false,
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
        stroke: '#ff0000',
        strokeWidth: 4,
      };
      assert.equal(canOutlineStroke(linePath), true);

      const rect: Rectangle = {
        id: 'r1',
        type: 'rectangle',
        name: 'Rect',
        x: 10,
        y: 10,
        width: 100,
        height: 50,
        stroke: '#000000',
        strokeWidth: 2,
      };
      assert.equal(canOutlineStroke(rect), true);

      const noStrokeRect: Rectangle = {
        id: 'r2',
        type: 'rectangle',
        name: 'Rect sin borde',
        x: 0,
        y: 0,
        width: 50,
        height: 50,
        fill: '#3b82f6',
        stroke: 'none',
      };
      assert.equal(canOutlineStroke(noStrokeRect), false);

      const zeroWidthRect: Rectangle = {
        ...rect,
        id: 'r3',
        strokeWidth: 0,
      };
      assert.equal(canOutlineStroke(zeroWidthRect), false);
    });
  });

  describe('2. outlineOpenPolyline', () => {
    it('genera contorno rectangular exacto para un segmento horizontal con cap butt', () => {
      const polyline = [{ x: 0, y: 50 }, { x: 100, y: 50 }];
      const contour = outlineOpenPolyline(polyline, 10, 'butt');
      assert.ok(contour.length >= 4);

      // Los puntos deben estar en torno a y=45 e y=55, x entre 0 y 100
      const ys = contour.map((p) => p.y);
      const xs = contour.map((p) => p.x);
      assert.equal(Math.min(...ys), 45);
      assert.equal(Math.max(...ys), 55);
      assert.equal(Math.min(...xs), 0);
      assert.equal(Math.max(...xs), 100);
    });

    it('genera remates redondeados (round caps) extendiéndose r fuera de los extremos', () => {
      const polyline = [{ x: 10, y: 50 }, { x: 90, y: 50 }];
      const contour = outlineOpenPolyline(polyline, 20, 'round');
      // r = 10, debe extenderse hasta x=0 en el inicio y x=100 en el final
      const xs = contour.map((p) => p.x);
      assert.ok(Math.min(...xs) <= 0.1);
      assert.ok(Math.max(...xs) >= 99.9);
    });

    it('genera remates cuadrados (square caps) extendiéndose r más allá de los extremos', () => {
      const polyline = [{ x: 10, y: 50 }, { x: 90, y: 50 }];
      const contour = outlineOpenPolyline(polyline, 20, 'square');
      const xs = contour.map((p) => p.x);
      assert.equal(Math.min(...xs), 0);
      assert.equal(Math.max(...xs), 100);
    });

    it('genera esquinas biseladas (bevel), redondeadas (round) y en inglete (miter)', () => {
      const corner = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }];
      const roundOutline = outlineOpenPolyline(corner, 10, 'butt', 'round');
      const miterOutline = outlineOpenPolyline(corner, 10, 'butt', 'miter');
      const bevelOutline = outlineOpenPolyline(corner, 10, 'butt', 'bevel');

      assert.ok(roundOutline.length >= 4);
      assert.ok(miterOutline.length >= 4);
      assert.ok(bevelOutline.length >= 4);
    });
  });

  describe('3. outlineStroke en diferentes figuras geométricas', () => {
    it('contornea un Path abierto (Línea) convirtiéndolo en un Path cerrado con fill = stroke original', () => {
      const line: Path = {
        id: 'line-1',
        type: 'path',
        name: 'Línea de prueba',
        x: 0,
        y: 0,
        closed: false,
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
        stroke: '#ef4444',
        strokeWidth: 10,
        strokeLineCap: 'butt',
      };

      const paths = outlineStroke(line);
      assert.equal(paths.length, 1);
      const outlined = paths[0];

      assert.equal(outlined.type, 'path');
      assert.equal(outlined.closed, true);
      assert.equal(outlined.fill, '#ef4444');
      assert.equal(outlined.stroke, 'none');
      assert.equal(outlined.strokeWidth, 0);
      assert.ok(outlined.points.length >= 4);
      assert.equal(isClosedShape(outlined), true);
    });

    it('contornea un Rectangle generando una corona/marco rectangular hueco', () => {
      const rect: Rectangle = {
        id: 'rect-1',
        type: 'rectangle',
        name: 'Caja',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        stroke: '#10b981',
        strokeWidth: 10,
      };

      const paths = outlineStroke(rect);
      assert.equal(paths.length, 1);
      const outlined = paths[0];

      assert.equal(outlined.closed, true);
      assert.equal(outlined.fill, '#10b981');
      assert.equal(outlined.stroke, 'none');
      assert.ok(outlined.points.length >= 8); // Exterior + interior con costura
      assert.equal(isClosedShape(outlined), true);
    });

    it('contornea una Ellipse generando una corona elíptica', () => {
      const ellipse: Ellipse = {
        id: 'ell-1',
        type: 'ellipse',
        name: 'Óvalo',
        x: 100,
        y: 100,
        radiusX: 50,
        radiusY: 30,
        stroke: '#8b5cf6',
        strokeWidth: 8,
      };

      const paths = outlineStroke(ellipse);
      assert.equal(paths.length, 1);
      const outlined = paths[0];

      assert.equal(outlined.closed, true);
      assert.equal(outlined.fill, '#8b5cf6');
      assert.ok(outlined.points.length >= 20);
      assert.equal(isClosedShape(outlined), true);
    });

    it('contornea un Polygon y una Star', () => {
      const poly: Polygon = {
        id: 'poly-1',
        type: 'polygon',
        name: 'Hexágono',
        x: 100,
        y: 100,
        radius: 40,
        sides: 6,
        stroke: '#f59e0b',
        strokeWidth: 6,
      };
      const polyPaths = outlineStroke(poly);
      assert.equal(polyPaths.length, 1);
      assert.equal(polyPaths[0].closed, true);

      const star: Star = {
        id: 'star-1',
        type: 'star',
        name: 'Estrella',
        x: 200,
        y: 200,
        outerRadius: 50,
        innerRadius: 25,
        points: 5,
        stroke: '#06b6d4',
        strokeWidth: 4,
      };
      const starPaths = outlineStroke(star);
      assert.equal(starPaths.length, 1);
      assert.equal(starPaths[0].closed, true);
    });

    it('contornea un trazo discontinuo (dashed) generando múltiples segmentos', () => {
      const dashedLine: Path = {
        id: 'dashed-1',
        type: 'path',
        name: 'Línea punteada',
        x: 0,
        y: 0,
        closed: false,
        points: [{ x: 0, y: 0 }, { x: 200, y: 0 }],
        stroke: '#3b82f6',
        strokeWidth: 6,
        strokeDashArray: [20, 20],
      };

      const paths = outlineStroke(dashedLine);
      assert.ok(paths.length >= 3);
      for (const p of paths) {
        assert.equal(p.closed, true);
        assert.equal(p.fill, '#3b82f6');
      }
    });
  });

  describe('4. expandShapeStroke y separación de relleno vs contorno', () => {
    it('si la figura solo tenía borde, retorna strokeShapes y fillShape undefined', () => {
      const line: Path = {
        id: 'line-stroke-only',
        type: 'path',
        name: 'Línea simple',
        x: 0,
        y: 0,
        closed: false,
        points: [{ x: 0, y: 0 }, { x: 50, y: 50 }],
        stroke: '#000000',
        strokeWidth: 2,
      };

      const res = expandShapeStroke(line);
      assert.ok(res);
      assert.equal(res.fillShape, undefined);
      assert.equal(res.strokeShapes.length, 1);
    });

    it('si la figura tenía relleno Y borde, preserva el relleno en fillShape sin borde', () => {
      const rect: Rectangle = {
        id: 'rect-fill-and-stroke',
        type: 'rectangle',
        name: 'Caja con relleno y borde',
        x: 10,
        y: 10,
        width: 100,
        height: 60,
        fill: '#3b82f6',
        stroke: '#000000',
        strokeWidth: 4,
      };

      const res = expandShapeStroke(rect);
      assert.ok(res);
      assert.ok(res.fillShape);
      assert.equal(res.fillShape.fill, '#3b82f6');
      assert.equal(res.fillShape.stroke, 'none');
      assert.equal(res.fillShape.strokeWidth, 0);
      assert.equal(res.strokeShapes.length, 1);
      assert.equal(res.strokeShapes[0].fill, '#000000');
    });
  });

  describe('5. OutlineStrokeCommand y Reversibilidad (Undo / Redo)', () => {
    it('reemplaza una línea sin relleno por un Path cerrado y revierte exactamente con Undo', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();

      const line: Path = {
        id: 'line-undo-1',
        type: 'path',
        name: 'Mi Trazo',
        x: 0,
        y: 0,
        closed: false,
        points: [{ x: 10, y: 20 }, { x: 150, y: 20 }],
        stroke: '#ec4899',
        strokeWidth: 8,
      };
      const layerId = stateManager.getState().children[0].id;
      stateManager.addShape(layerId, line);
      stateManager.setSelection([line.id]);

      const cmd = new OutlineStrokeCommand(stateManager, stateManager.getSelectedNodes());
      commandManager.executeCommand(cmd);

      // Ahora la figura original no existe
      assert.equal(stateManager.findNode('line-undo-1'), null);

      // La nueva figura de contorno está seleccionada y es un Path cerrado
      const selection = stateManager.getSelection();
      assert.equal(selection.length, 1);
      const outlinedShape = stateManager.findNode(selection[0]) as Path;
      assert.ok(outlinedShape && outlinedShape.type === 'path');
      assert.equal(outlinedShape.closed, true);
      assert.equal(outlinedShape.fill, '#ec4899');
      assert.equal(outlinedShape.stroke, 'none');

      // Undo restaura la línea original
      commandManager.undo();
      assert.ok(stateManager.findNode('line-undo-1'));
      assert.equal((stateManager.findNode('line-undo-1') as Path).stroke, '#ec4899');
      assert.equal(stateManager.getSelection()[0], 'line-undo-1');

      // Redo re-aplica el contorneado
      commandManager.redo();
      assert.equal(stateManager.findNode('line-undo-1'), null);
      assert.ok(stateManager.findNode(selection[0]));
    });

    it('agrupa relleno y contorno cuando la figura tenía ambos, y soporta Undo/Redo', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();

      const rect: Rectangle = {
        id: 'rect-grouped',
        type: 'rectangle',
        name: 'Rectángulo mixto',
        x: 20,
        y: 20,
        width: 80,
        height: 80,
        fill: '#fde047',
        stroke: '#1e293b',
        strokeWidth: 6,
      };
      const layerId = stateManager.getState().children[0].id;
      stateManager.addShape(layerId, rect);
      stateManager.setSelection([rect.id]);

      const cmd = new OutlineStrokeCommand(stateManager, stateManager.getSelectedNodes());
      commandManager.executeCommand(cmd);

      // La selección es el nuevo grupo
      const sel = stateManager.getSelection();
      assert.equal(sel.length, 1);
      const groupNode = stateManager.findNode(sel[0]);
      assert.ok(groupNode && isGroup(groupNode));
      assert.equal(groupNode.children.length, 2);

      // El primer hijo es el relleno, el segundo es el contorno
      const [fillChild, strokeChild] = groupNode.children;
      assert.ok(isShape(fillChild) && fillChild.fill === '#fde047' && fillChild.stroke === 'none');
      assert.ok(isShape(strokeChild) && strokeChild.fill === '#1e293b' && strokeChild.stroke === 'none');

      // Undo restaura el rectángulo original fuera de cualquier grupo
      commandManager.undo();
      assert.ok(stateManager.findNode('rect-grouped'));
      assert.equal(stateManager.getSelection()[0], 'rect-grouped');
    });

    it('opera sobre múltiples figuras seleccionadas simultáneamente en un solo paso de historial', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();

      const line1: Path = {
        id: 'l1',
        type: 'path',
        name: 'L1',
        x: 0,
        y: 0,
        closed: false,
        points: [{ x: 0, y: 0 }, { x: 50, y: 0 }],
        stroke: '#ff0000',
        strokeWidth: 4,
      };
      const line2: Path = {
        id: 'l2',
        type: 'path',
        name: 'L2',
        x: 0,
        y: 0,
        closed: false,
        points: [{ x: 0, y: 20 }, { x: 50, y: 20 }],
        stroke: '#00ff00',
        strokeWidth: 4,
      };

      const layerId = stateManager.getState().children[0].id;
      stateManager.addShape(layerId, line1);
      stateManager.addShape(layerId, line2);
      stateManager.setSelection(['l1', 'l2']);

      const cmd = new OutlineStrokeCommand(stateManager, stateManager.getSelectedNodes());
      commandManager.executeCommand(cmd);

      assert.equal(stateManager.findNode('l1'), null);
      assert.equal(stateManager.findNode('l2'), null);
      assert.equal(stateManager.getSelection().length, 2);

      // Un solo Undo restaura ambas
      commandManager.undo();
      assert.ok(stateManager.findNode('l1'));
      assert.ok(stateManager.findNode('l2'));
    });
  });

  describe('6. Integración con Operaciones Booleanas (Pathfinder)', () => {
    it('permite restar una línea gruesa contorneada de un rectángulo cerrado', () => {
      // Caso de uso explícito de ROADMAP.md:
      // "Permite someter los trazos a operaciones booleanas (ej. restar una línea gruesa de un rectángulo)"
      const rect: Rectangle = {
        id: 'base-rect',
        type: 'rectangle',
        name: 'Rectángulo Fondo',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        fill: '#3b82f6',
      };

      const thickLine: Path = {
        id: 'cutter-line',
        type: 'path',
        name: 'Línea Cortadora',
        x: 0,
        y: 0,
        closed: false,
        points: [{ x: -10, y: 50 }, { x: 110, y: 50 }],
        stroke: '#000000',
        strokeWidth: 20,
        strokeLineCap: 'butt',
      };

      // Antes del contorneado, thickLine no es cerrada y no puede participar en operaciones booleanas
      assert.equal(isClosedShape(thickLine), false);

      // Contorneamos la línea
      const outlinedPaths = outlineStroke(thickLine);
      assert.equal(outlinedPaths.length, 1);
      const cutterPath = outlinedPaths[0];
      assert.equal(isClosedShape(cutterPath), true);

      // Ahora ejecutamos sustracción booleana: rect - cutterPath
      const resultPaths = executeBooleanOperation('subtract', [rect, cutterPath]);

      // La línea de grosor 20 cruzaba horizontalmente por y=50, dividiendo el rectángulo de 100x100
      // en dos islas rectangulares separadas (arriba de y=40 y abajo de y=60)
      assert.ok(resultPaths.length >= 2, `Se esperaban al menos 2 islas de corte, obtenido: ${resultPaths.length}`);
      for (const p of resultPaths) {
        assert.equal(p.closed, true);
        assert.equal(p.fill, '#3b82f6');
      }
    });

    it('permite unir un trazado contorneado con otra figura cerrada', () => {
      const circle: Ellipse = {
        id: 'c1',
        type: 'ellipse',
        name: 'Círculo',
        x: 50,
        y: 50,
        radiusX: 30,
        radiusY: 30,
        fill: '#10b981',
      };

      const stemLine: Path = {
        id: 'stem',
        type: 'path',
        name: 'Tallo',
        x: 0,
        y: 0,
        closed: false,
        points: [{ x: 50, y: 50 }, { x: 50, y: 120 }],
        stroke: '#10b981',
        strokeWidth: 10,
        strokeLineCap: 'butt',
      };

      const outlinedStem = outlineStroke(stemLine)[0];
      const unionResult = executeBooleanOperation('union', [circle, outlinedStem]);

      assert.equal(unionResult.length, 1);
      assert.equal(unionResult[0].closed, true);
      assert.ok(unionResult[0].points.length >= 10);
    });
  });

  describe('7. InputController y atajo de teclado Ctrl+Shift+O', () => {
    it('inputController.outlineStroke() ejecuta el comando y sincroniza selección', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const canvas = {
        style: {},
        addEventListener: () => {},
        removeEventListener: () => {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      } as unknown as HTMLCanvasElement;

      const inputController = new InputController(canvas, stateManager, commandManager);

      const pathNode: Path = {
        id: 'test-ctrl-shift-o',
        type: 'path',
        name: 'Trazo P',
        x: 0,
        y: 0,
        closed: false,
        points: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
        stroke: '#6366f1',
        strokeWidth: 6,
      };
      const layerId = stateManager.getState().children[0].id;
      stateManager.addShape(layerId, pathNode);
      stateManager.setSelection([pathNode.id]);

      const executed = inputController.outlineStroke();
      assert.equal(executed, true);
      assert.equal(stateManager.findNode('test-ctrl-shift-o'), null);
      assert.equal(stateManager.getSelection().length, 1);

      inputController.destroy();
    });

    it('atajo de teclado Ctrl+Shift+O dispara outlineStroke', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const canvas = {
        style: {},
        addEventListener: () => {},
        removeEventListener: () => {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      } as unknown as HTMLCanvasElement;

      const inputController = new InputController(canvas, stateManager, commandManager, {
        enableKeyboardShortcuts: true,
      });

      const line: Path = {
        id: 'key-test-line',
        type: 'path',
        name: 'Trazo Atajo',
        x: 0,
        y: 0,
        closed: false,
        points: [{ x: 10, y: 10 }, { x: 80, y: 10 }],
        stroke: '#f43f5e',
        strokeWidth: 4,
      };
      const layerId = stateManager.getState().children[0].id;
      stateManager.addShape(layerId, line);
      stateManager.setSelection([line.id]);

      const keyEvent = {
        key: 'O',
        code: 'KeyO',
        ctrlKey: true,
        shiftKey: true,
        preventDefault: () => {},
      } as unknown as KeyboardEvent;

      inputController.handleKeyDown(keyEvent);

      assert.equal(stateManager.findNode('key-test-line'), null);
      assert.equal(stateManager.getSelection().length, 1);

      inputController.destroy();
    });
  });
});
