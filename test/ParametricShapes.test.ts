import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { InputController, KEYBOARD_SHORTCUTS } from '../src/input/InputController.ts';
import { setupUIBindings } from '../src/main.ts';
import { exportDocumentToSvg } from '../src/utils/exportSvg.ts';
import { calculateExportBounds, renderDocumentToCanvas } from '../src/utils/exportRaster.ts';
import { serializeDocument, parseDocument } from '../src/state/Serializer.ts';
import { cloneNode } from '../src/utils/cloneShape.ts';
import {
  getPolygonBaseVertices,
  getPolygonVertices,
  getStarBaseVertices,
  getStarVertices,
  getPolygonAABB,
  getStarAABB,
  getShapeAABB,
  isPointInShape,
  getSelectionHandles,
} from '../src/utils/geometry.ts';
import {
  isPolygon,
  isStar,
  type Polygon,
  type Star,
} from '../src/types/scene-graph.ts';
import { UpdateParametricShapeCommand } from '../src/commands/UpdateParametricShapeCommand.ts';
import { ResizeCommand } from '../src/commands/ResizeCommand.ts';

// Mock simple de DOM para tests de UI
class MockElement {
  public id: string;
  public tagName: string;
  public disabled: boolean = false;
  public textContent: string = '';
  public value: string = '';
  public placeholder: string = '';
  public style: Record<string, string> = {};
  public clickCount: number = 0;
  private attributes: Map<string, string> = new Map();
  private classes: Set<string> = new Set();
  private listeners: Map<string, Set<(e: any) => void>> = new Map();

  constructor(id: string, tagName: string = 'button') {
    this.id = id;
    this.tagName = tagName.toUpperCase();
  }

  public get className(): string {
    return Array.from(this.classes).join(' ');
  }

  public set className(val: string) {
    this.classes.clear();
    if (val) {
      for (const cls of val.split(/\s+/)) {
        if (cls) this.classes.add(cls);
      }
    }
  }

  public get classList() {
    return {
      add: (cls: string) => this.classes.add(cls),
      remove: (cls: string) => this.classes.delete(cls),
      contains: (cls: string) => this.classes.has(cls),
      toggle: (cls: string, force?: boolean) => {
        if (force !== undefined) {
          if (force) this.classes.add(cls);
          else this.classes.delete(cls);
          return force;
        }
        if (this.classes.has(cls)) {
          this.classes.delete(cls);
          return false;
        }
        this.classes.add(cls);
        return true;
      },
    };
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  public getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  public removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  public addEventListener(event: string, handler: (e: any) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
  }

  public removeEventListener(event: string, handler: (e: any) => void): void {
    this.listeners.get(event)?.delete(handler);
  }

  public dispatchEvent(e: { type: string; [key: string]: any }): boolean {
    const handlers = this.listeners.get(e.type);
    if (handlers) {
      for (const h of handlers) {
        h(e);
      }
    }
    return true;
  }

  public click(): void {
    this.clickCount++;
    this.dispatchEvent({ type: 'click' });
  }

  public focus(): void {
    this.dispatchEvent({ type: 'focus' });
  }

  public blur(): void {
    this.dispatchEvent({ type: 'blur' });
  }

  public appendChild(child: any): any {
    return child;
  }
}

function createMockCanvas(): HTMLCanvasElement & {
  mockCtx: Record<string, any>;
  calls: string[];
  dispatchSimulatedEvent: (type: string, e: unknown) => void;
} {
  const calls: string[] = [];
  const listeners: Record<string, ((e: any) => void)[]> = {};
  const mockCtx: Record<string, any> = {
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    beginPath: () => calls.push('beginPath'),
    closePath: () => calls.push('closePath'),
    moveTo: (_x: number, _y: number) => calls.push('moveTo'),
    lineTo: (_x: number, _y: number) => calls.push('lineTo'),
    rect: () => calls.push('rect'),
    strokeRect: () => calls.push('strokeRect'),
    fillRect: () => calls.push('fillRect'),
    stroke: () => calls.push('stroke'),
    fill: () => calls.push('fill'),
    setLineDash: () => calls.push('setLineDash'),
    translate: () => calls.push('translate'),
    rotate: () => calls.push('rotate'),
    scale: () => calls.push('scale'),
    setTransform: () => calls.push('setTransform'),
    clearRect: () => calls.push('clearRect'),
    measureText: () => ({ width: 50 }),
    canvas: { width: 1000, height: 800 },
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    strokeStyle: '#000000',
    fillStyle: '#000000',
    globalAlpha: 1,
  };

  return {
    id: 'viewport-canvas',
    style: { cursor: 'default' },
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 1000,
      height: 800,
      right: 1000,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => {},
    }),
    getContext: () => mockCtx,
    addEventListener: (type: string, listener: (e: any) => void) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(listener);
    },
    removeEventListener: (type: string, listener: (e: any) => void) => {
      if (!listeners[type]) return;
      listeners[type] = listeners[type].filter((l) => l !== listener);
    },
    dispatchSimulatedEvent: (type: string, e: any) => {
      if (listeners[type]) {
        for (const l of listeners[type]) {
          l(e);
        }
      }
    },
    mockCtx,
    calls,
  } as unknown as HTMLCanvasElement & {
    mockCtx: Record<string, any>;
    calls: string[];
    dispatchSimulatedEvent: (type: string, e: unknown) => void;
  };
}

function setupMockDocument(mockCanvas?: HTMLCanvasElement): {
  elements: Map<string, MockElement>;
  restore: () => void;
} {
  const elements = new Map<string, MockElement>();
  const ids = [
    'tool-select', 'tool-direct-select', 'tool-hand', 'tool-pen', 'tool-pencil',
    'tool-rectangle', 'tool-ellipse', 'tool-polygon', 'tool-star', 'tool-line',
    'tool-text', 'tool-eyedropper', 'btn-undo', 'btn-redo',
    'panel-title', 'no-selection-state', 'selection-state',
    'section-transform', 'section-appearance', 'section-artboard',
    'input-object-x', 'input-object-y', 'input-object-width', 'input-object-height', 'input-object-rotation',
    'group-corner-radius', 'input-corner-radius',
    'section-polygon', 'input-polygon-sides', 'input-polygon-radius',
    'section-star', 'input-star-points', 'input-star-outer-radius', 'input-star-inner-radius',
    'section-typography', 'input-text-content', 'select-font-family', 'input-font-size',
    'input-line-height', 'input-letter-spacing', 'select-font-weight', 'select-font-style', 'select-text-align',
    'btn-text-align-left', 'btn-text-align-center', 'btn-text-align-right',
    'input-text-color', 'input-text-color-hex', 'btn-text-color-none', 'swatch-text-color-preview', 'group-text-color',
    'input-fill', 'input-fill-hex', 'btn-fill-none', 'swatch-fill-preview',
    'input-stroke', 'input-stroke-hex', 'btn-stroke-none', 'swatch-stroke-preview',
    'input-stroke-width', 'select-stroke-dash', 'select-stroke-cap', 'select-stroke-join',
    'input-opacity', 'input-opacity-value',
    'select-artboard-preset', 'input-artboard-width', 'input-artboard-height', 'check-artboard-ratio',
    'section-path-point', 'btn-point-corner', 'btn-point-smooth', 'btn-point-symmetric', 'btn-delete-anchor',
    'section-align', 'btn-align-left', 'btn-align-center-h', 'btn-align-right', 'btn-align-top', 'btn-align-center-v', 'btn-align-bottom',
    'btn-distribute-h', 'btn-distribute-v',
    'section-pathfinder', 'btn-pathfinder-union', 'btn-pathfinder-subtract', 'btn-pathfinder-intersect', 'btn-pathfinder-exclude',
    'btn-bring-to-front', 'btn-send-to-back', 'btn-duplicate', 'btn-delete-selection', 'btn-toggle-panel',
    'tab-properties', 'tab-layers', 'panel-tab-properties', 'panel-tab-layers',
    'btn-add-layer', 'btn-layer-move-up', 'btn-layer-move-down', 'btn-layer-delete', 'layers-tree', 'layers-empty-state',
    'status-tool-label', 'status-shapes-count', 'status-selection-info', 'status-selection-separator',
    'status-zoom-btn', 'status-zoom-label', 'zoom-dropdown',
  ];

  for (const id of ids) {
    elements.set(id, new MockElement(id));
  }

  const origDocument = (globalThis as any).document;
  (globalThis as any).document = {
    querySelector: (selector: string) => {
      if (selector === '#viewport-canvas' && mockCanvas) {
        return mockCanvas;
      }
      for (const [id, el] of elements.entries()) {
        if (selector === `#${id}` || selector.includes(`#${id}`)) return el;
      }
      return null;
    },
    querySelectorAll: (selector: string) => {
      if (selector === '.collapsible-section') {
        const sections: MockElement[] = [];
        for (const [id, el] of elements.entries()) {
          if (id.startsWith('section-')) sections.push(el);
        }
        return sections;
      }
      return [];
    },
    createElement: (tag: string) => {
      if (tag.toLowerCase() === 'canvas') {
        return createMockCanvas();
      }
      return new MockElement('', tag);
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    activeElement: null,
  };

  return {
    elements,
    restore: () => {
      (globalThis as any).document = origDocument;
    },
  };
}

describe('Primitivas Paramétricas: Polígono Regular y Estrella', () => {
  describe('1. Geometría y Vértices Matemáticos', () => {
    it('getPolygonBaseVertices genera n vértices con punta superior en (x, y - R)', () => {
      const poly: Polygon = {
        id: 'p1',
        type: 'polygon',
        name: 'P',
        x: 100,
        y: 100,
        radius: 50,
        sides: 5,
      };
      const vertices = getPolygonBaseVertices(poly);
      assert.strictEqual(vertices.length, 5);
      // El primer vértice debe apuntar a las 12 en punto (-PI/2)
      assert.strictEqual(Math.round(vertices[0].x), 100);
      assert.strictEqual(Math.round(vertices[0].y), 50); // 100 - 50
    });

    it('getPolygonVertices aplica rotación alrededor del centro', () => {
      const poly: Polygon = {
        id: 'poly-1',
        type: 'polygon',
        name: 'Pentágono',
        x: 100,
        y: 100,
        radius: 50,
        sides: 4,
        rotation: 90,
      };
      const vertices = getPolygonVertices(poly);
      assert.strictEqual(vertices.length, 4);
      // Rotado 90 grados en sentido horario, el vértice superior (100, 50) pasa a la derecha (150, 100)
      assert.strictEqual(Math.round(vertices[0].x), 150);
      assert.strictEqual(Math.round(vertices[0].y), 100);
    });

    it('getStarBaseVertices genera 2*p vértices alternando radios exterior e interior', () => {
      const star: Star = {
        id: 's1',
        type: 'star',
        name: 'S',
        x: 200,
        y: 200,
        outerRadius: 60,
        innerRadius: 30,
        points: 5,
      };
      const vertices = getStarBaseVertices(star);
      assert.strictEqual(vertices.length, 10);
      // Vértice 0 (punta exterior a las 12 en punto):
      assert.strictEqual(Math.round(vertices[0].x), 200);
      assert.strictEqual(Math.round(vertices[0].y), 140); // 200 - 60
      // Vértice 1 (valle interior a ángulo -PI/2 + PI/5):
      const dist1 = Math.hypot(vertices[1].x - 200, vertices[1].y - 200);
      assert.strictEqual(Math.round(dist1), 30);
    });

    it('getStarVertices aplica rotación sobre los vértices de la estrella', () => {
      const star: Star = {
        id: 'star-1',
        type: 'star',
        name: 'Estrella',
        x: 200,
        y: 200,
        outerRadius: 80,
        innerRadius: 40,
        points: 6,
        rotation: 180,
      };
      const vertices = getStarVertices(star);
      assert.strictEqual(vertices.length, 12);
      // Con rotación de 180 grados, el vértice exterior superior pasa a la parte inferior (200, 280)
      assert.strictEqual(Math.round(vertices[0].x), 200);
      assert.strictEqual(Math.round(vertices[0].y), 280);
    });

    it('getPolygonAABB y getStarAABB calculan la caja envolvente exacta', () => {
      const poly: Polygon = {
        id: 'poly-1',
        type: 'polygon',
        name: 'Hexágono',
        x: 0,
        y: 0,
        radius: 100,
        sides: 4, // cuadrado con vértices en (0,-100), (100,0), (0,100), (-100,0)
      };
      const aabb = getPolygonAABB(poly);
      assert.strictEqual(Math.round(aabb.minX), -100);
      assert.strictEqual(Math.round(aabb.maxX), 100);
      assert.strictEqual(Math.round(aabb.minY), -100);
      assert.strictEqual(Math.round(aabb.maxY), 100);

      const shapeAabb = getShapeAABB(poly);
      assert.deepStrictEqual(shapeAabb, aabb);

      const star: Star = {
        id: 'star-1',
        type: 'star',
        name: 'Estrella',
        x: 100,
        y: 100,
        outerRadius: 50,
        innerRadius: 25,
        points: 4,
      };
      const starAabb = getStarAABB(star);
      const starShapeAabb = getShapeAABB(star);
      assert.deepStrictEqual(starShapeAabb, starAabb);
    });

    it('isPointInShape detecta puntos interiores y bordes de Polígono y Estrella', () => {
      const poly: Polygon = {
        id: 'p1',
        type: 'polygon',
        name: 'Polígono',
        x: 100,
        y: 100,
        radius: 50,
        sides: 6,
      };

      // Centro del polígono
      assert.strictEqual(isPointInShape(100, 100, poly), true);
      // Punto lejos fuera
      assert.strictEqual(isPointInShape(200, 200, poly), false);
      // Punto muy cerca del vértice superior con tolerancia
      assert.strictEqual(isPointInShape(100, 48, poly, 5), true);

      const star: Star = {
        id: 's1',
        type: 'star',
        name: 'Estrella',
        x: 200,
        y: 200,
        outerRadius: 60,
        innerRadius: 20,
        points: 5,
      };

      // Centro de la estrella
      assert.strictEqual(isPointInShape(200, 200, star), true);
      // Punto en la punta superior
      assert.strictEqual(isPointInShape(200, 145, star), true);
      // Punto en la muesca exterior (fuera de la estrella, pero dentro de su AABB exterior)
      assert.strictEqual(isPointInShape(200, 165, star), true); // parte interior
      assert.strictEqual(isPointInShape(230, 155, star), false); // vacío entre puntas
    });

    it('getSelectionHandles genera 5 tiradores para Polygon y Star (4 esquinas y rotación)', () => {
      const poly: Polygon = {
        id: 'p1',
        type: 'polygon',
        name: 'Polígono',
        x: 100,
        y: 100,
        radius: 50,
        sides: 5,
      };
      const handles = getSelectionHandles(poly);
      assert.strictEqual(handles.length, 5);
      const types = handles.map((h) => h.type);
      assert.ok(types.includes('top-left'));
      assert.ok(types.includes('bottom-right'));
      assert.ok(types.includes('rotation-handle'));
    });
  });

  describe('2. Scene Graph, Serialización y Clonado', () => {
    it('crea nodos Polygon y Star inmutables y los reconoce mediante type guards', () => {
      const sm = new StateManager();
      const layerId = sm.getState().children[0].id;
      const poly: Polygon = {
        id: 'poly-node',
        type: 'polygon',
        name: 'Mi Polígono',
        x: 150,
        y: 150,
        radius: 40,
        sides: 6,
        fill: '#38bdf8',
      };
      const star: Star = {
        id: 'star-node',
        type: 'star',
        name: 'Mi Estrella',
        x: 300,
        y: 300,
        outerRadius: 50,
        innerRadius: 25,
        points: 5,
        fill: '#f59e0b',
      };

      sm.addShape(layerId, poly);
      sm.addShape(layerId, star);

      const storedPoly = sm.findNode('poly-node');
      const storedStar = sm.findNode('star-node');

      assert.ok(storedPoly && isPolygon(storedPoly));
      assert.ok(storedStar && isStar(storedStar));
      assert.strictEqual(Object.isFrozen(storedPoly), true);
      assert.strictEqual(Object.isFrozen(storedStar), true);
    });

    it('cloneNode duplica Polígono y Estrella con sus propiedades paramétricas intactas', () => {
      const star: Star = {
        id: 'star-orig',
        type: 'star',
        name: 'Estrella Original',
        x: 50,
        y: 60,
        outerRadius: 70,
        innerRadius: 35,
        points: 8,
        rotation: 45,
      };
      const cloned = cloneNode(star) as Star;
      assert.notStrictEqual(cloned.id, star.id);
      assert.strictEqual(cloned.type, 'star');
      assert.strictEqual(cloned.outerRadius, 70);
      assert.strictEqual(cloned.innerRadius, 35);
      assert.strictEqual(cloned.points, 8);
      assert.strictEqual(cloned.rotation, 45);
    });

    it('Serializer exporta e importa Polygon y Star preservando propiedades paramétricas', async () => {
      const sm = new StateManager();
      const layerId = sm.getState().children[0].id;
      sm.addShape(layerId, {
        id: 'poly-1',
        type: 'polygon',
        name: 'Polígono JSON',
        x: 100,
        y: 120,
        radius: 45,
        sides: 7,
      });
      sm.addShape(layerId, {
        id: 'star-1',
        type: 'star',
        name: 'Estrella JSON',
        x: 250,
        y: 280,
        outerRadius: 65,
        innerRadius: 28,
        points: 6,
      });

      const json = serializeDocument(sm.getState());
      const restored = await parseDocument(json);

      const restoredPoly = restored.children[0].children.find((c) => c.id === 'poly-1') as Polygon;
      const restoredStar = restored.children[0].children.find((c) => c.id === 'star-1') as Star;

      assert.ok(restoredPoly && isPolygon(restoredPoly));
      assert.strictEqual(restoredPoly.sides, 7);
      assert.strictEqual(restoredPoly.radius, 45);

      assert.ok(restoredStar && isStar(restoredStar));
      assert.strictEqual(restoredStar.points, 6);
      assert.strictEqual(restoredStar.outerRadius, 65);
      assert.strictEqual(restoredStar.innerRadius, 28);
    });
  });

  describe('3. Comandos Undo/Redo y Transformaciones', () => {
    it('UpdateParametricShapeCommand modifica lados y radio con undo y redo completos', () => {
      const sm = new StateManager();
      const cm = new CommandManager();
      const layerId = sm.getState().children[0].id;
      sm.addShape(layerId, {
        id: 'poly-test',
        type: 'polygon',
        name: 'Hexágono',
        x: 100,
        y: 100,
        radius: 40,
        sides: 6,
      });

      const cmd = new UpdateParametricShapeCommand(
        sm,
        'poly-test',
        { sides: 6, radius: 40 },
        { sides: 8, radius: 55 }
      );

      cm.executeCommand(cmd);
      let poly = sm.findNode('poly-test') as Polygon;
      assert.strictEqual(poly.sides, 8);
      assert.strictEqual(poly.radius, 55);

      cm.undo();
      poly = sm.findNode('poly-test') as Polygon;
      assert.strictEqual(poly.sides, 6);
      assert.strictEqual(poly.radius, 40);

      cm.redo();
      poly = sm.findNode('poly-test') as Polygon;
      assert.strictEqual(poly.sides, 8);
      assert.strictEqual(poly.radius, 55);
    });

    it('UpdateParametricShapeCommand modifica puntas y radios de estrella con undo y redo', () => {
      const sm = new StateManager();
      const cm = new CommandManager();
      const layerId = sm.getState().children[0].id;
      sm.addShape(layerId, {
        id: 'star-test',
        type: 'star',
        name: 'Estrella',
        x: 100,
        y: 100,
        outerRadius: 50,
        innerRadius: 25,
        points: 5,
      });

      const cmd = new UpdateParametricShapeCommand(
        sm,
        'star-test',
        { points: 5, outerRadius: 50, innerRadius: 25 },
        { points: 7, outerRadius: 75, innerRadius: 30 }
      );

      cm.executeCommand(cmd);
      let star = sm.findNode('star-test') as Star;
      assert.strictEqual(star.points, 7);
      assert.strictEqual(star.outerRadius, 75);
      assert.strictEqual(star.innerRadius, 30);

      cm.undo();
      star = sm.findNode('star-test') as Star;
      assert.strictEqual(star.points, 5);
      assert.strictEqual(star.outerRadius, 50);
      assert.strictEqual(star.innerRadius, 25);
    });

    it('ResizeCommand escala radios de polígono y estrella proporcionalmente', () => {
      const sm = new StateManager();
      const cm = new CommandManager();
      const layerId = sm.getState().children[0].id;
      sm.addShape(layerId, {
        id: 'poly-resize',
        type: 'polygon',
        name: 'P',
        x: 100,
        y: 100,
        radius: 50,
        sides: 5,
      });

      const cmd = new ResizeCommand(
        sm,
        'poly-resize',
        { x: 100, y: 100, radius: 50 },
        { x: 120, y: 120, radius: 80 }
      );
      cm.executeCommand(cmd);

      let poly = sm.findNode('poly-resize') as Polygon;
      assert.strictEqual(poly.x, 120);
      assert.strictEqual(poly.y, 120);
      assert.strictEqual(poly.radius, 80);

      cm.undo();
      poly = sm.findNode('poly-resize') as Polygon;
      assert.strictEqual(poly.x, 100);
      assert.strictEqual(poly.radius, 50);
    });

    it('calculateResizedDimensions escala un polígono regular desde manejador de esquina', () => {
      const canvas = createMockCanvas();
      const sm = new StateManager();
      const cm = new CommandManager();
      const ic = new InputController(canvas, sm, cm);

      const initial = { x: 100, y: 100, radius: 50, sides: 6 };
      // Arrastrar hacia abajo-derecha (+20, +20): el radio pasa de 50 a 60 y el centro se desplaza +10, +10
      const resizedBR = ic.calculateResizedDimensions(initial, 'bottom-right', 20, 20, true, false);
      assert.strictEqual(resizedBR.radius, 60);
      assert.strictEqual(resizedBR.x, 110);
      assert.strictEqual(resizedBR.y, 110);
      assert.strictEqual(resizedBR.sides, 6);

      // Arrastrar desde el centro (Alt): centro se mantiene fijo en (100, 100)
      const resizedCenter = ic.calculateResizedDimensions(initial, 'bottom-right', 20, 20, true, true);
      assert.strictEqual(resizedCenter.x, 100);
      assert.strictEqual(resizedCenter.y, 100);
      assert.strictEqual(resizedCenter.radius, 70);

      ic.destroy();
    });

    it('calculateResizedDimensions escala una estrella regular manteniendo la proporción de radios', () => {
      const canvas = createMockCanvas();
      const sm = new StateManager();
      const cm = new CommandManager();
      const ic = new InputController(canvas, sm, cm);

      const initial = { x: 200, y: 200, outerRadius: 60, innerRadius: 30, starPoints: 5 };
      const resized = ic.calculateResizedDimensions(initial, 'bottom-right', 24, 24, true, false);
      assert.strictEqual(resized.outerRadius, 72);
      assert.strictEqual(resized.innerRadius, 36);
      assert.strictEqual(resized.x, 212);
      assert.strictEqual(resized.y, 212);
      assert.strictEqual(resized.starPoints, 5);

      ic.destroy();
    });

    it('SelectToolHandler permite redimensionar interactivamente polígonos y estrellas desde manejadores de esquina con Undo/Redo', () => {
      const canvas = createMockCanvas();
      const sm = new StateManager();
      const cm = new CommandManager();
      const ic = new InputController(canvas, sm, cm);
      const layerId = sm.getState().children[0].id;

      // 1. Probar con Polígono
      const poly: Polygon = {
        id: 'poly-interactive',
        type: 'polygon',
        name: 'Hexágono',
        x: 150,
        y: 150,
        radius: 40,
        sides: 6,
      };
      sm.addShape(layerId, poly);
      sm.setSelection(['poly-interactive']);

      // Obtener el manejador bottom-right del polígono
      const polyHandles = getSelectionHandles(poly, 8);
      const brHandle = polyHandles.find((h) => h.type === 'bottom-right');
      assert.ok(brHandle);

      // Iniciar arrastre sobre el tirador
      const startX = (brHandle.minX + brHandle.maxX) / 2;
      const startY = (brHandle.minY + brHandle.maxY) / 2;
      canvas.dispatchSimulatedEvent('mousedown', {
        clientX: startX,
        clientY: startY,
        button: 0,
        shiftKey: false,
        altKey: false,
      });

      assert.strictEqual(ic.isResizing, true);

      // Arrastrar +30px en X e Y
      canvas.dispatchSimulatedEvent('mousemove', {
        clientX: startX + 30,
        clientY: startY + 30,
        shiftKey: false,
        altKey: false,
      });

      let updatedPoly = sm.findNode('poly-interactive') as Polygon;
      assert.ok(updatedPoly.radius > 40, `El radio ${updatedPoly.radius} debería ser mayor a 40`);

      // Soltar para completar el comando
      canvas.dispatchSimulatedEvent('mouseup', {
        clientX: startX + 30,
        clientY: startY + 30,
        shiftKey: false,
        altKey: false,
      });

      assert.strictEqual(ic.isResizing, false);
      const scaledRadius = (sm.findNode('poly-interactive') as Polygon).radius;
      assert.ok(scaledRadius > 40);

      // Deshacer restaura el radio original
      cm.undo();
      updatedPoly = sm.findNode('poly-interactive') as Polygon;
      assert.strictEqual(updatedPoly.radius, 40);
      assert.strictEqual(updatedPoly.x, 150);
      assert.strictEqual(updatedPoly.y, 150);

      // Rehacer vuelve a aplicar el tamaño escalado
      cm.redo();
      updatedPoly = sm.findNode('poly-interactive') as Polygon;
      assert.strictEqual(updatedPoly.radius, scaledRadius);

      // 2. Probar con Estrella
      const star: Star = {
        id: 'star-interactive',
        type: 'star',
        name: 'Estrella',
        x: 300,
        y: 300,
        outerRadius: 50,
        innerRadius: 25,
        points: 5,
      };
      sm.addShape(layerId, star);
      sm.setSelection(['star-interactive']);

      const starHandles = getSelectionHandles(star, 8);
      const starBrHandle = starHandles.find((h) => h.type === 'bottom-right');
      assert.ok(starBrHandle);

      const starStartX = (starBrHandle.minX + starBrHandle.maxX) / 2;
      const starStartY = (starBrHandle.minY + starBrHandle.maxY) / 2;
      canvas.dispatchSimulatedEvent('mousedown', {
        clientX: starStartX,
        clientY: starStartY,
        button: 0,
        shiftKey: false,
        altKey: false,
      });

      assert.strictEqual(ic.isResizing, true);

      canvas.dispatchSimulatedEvent('mousemove', {
        clientX: starStartX + 20,
        clientY: starStartY + 20,
        shiftKey: false,
        altKey: false,
      });

      let updatedStar = sm.findNode('star-interactive') as Star;
      assert.ok(updatedStar.outerRadius > 50);
      assert.ok(updatedStar.innerRadius > 25);

      canvas.dispatchSimulatedEvent('mouseup', {
        clientX: starStartX + 20,
        clientY: starStartY + 20,
        shiftKey: false,
        altKey: false,
      });

      assert.strictEqual(ic.isResizing, false);
      const finalOuter = (sm.findNode('star-interactive') as Star).outerRadius;
      assert.ok(finalOuter > 50);

      cm.undo();
      updatedStar = sm.findNode('star-interactive') as Star;
      assert.strictEqual(updatedStar.outerRadius, 50);
      assert.strictEqual(updatedStar.innerRadius, 25);

      cm.redo();
      updatedStar = sm.findNode('star-interactive') as Star;
      assert.strictEqual(updatedStar.outerRadius, finalOuter);

      ic.destroy();
    });
  });

  describe('4. Exportación SVG y Raster', () => {
    it('exportDocumentToSvg genera elemento <polygon points="..." /> para polígono y estrella', () => {
      const sm = new StateManager();
      const layerId = sm.getState().children[0].id;
      sm.addShape(layerId, {
        id: 'poly-svg',
        type: 'polygon',
        name: 'Polígono SVG',
        x: 100,
        y: 100,
        radius: 50,
        sides: 5,
        fill: '#ff0000',
        stroke: '#000000',
        strokeWidth: 2,
      });
      sm.addShape(layerId, {
        id: 'star-svg',
        type: 'star',
        name: 'Estrella SVG',
        x: 300,
        y: 300,
        outerRadius: 60,
        innerRadius: 30,
        points: 6,
        fill: '#00ff00',
      });

      const svg = exportDocumentToSvg(sm.getState());
      assert.ok(svg.includes('<polygon'));
      assert.ok(svg.includes('points='));
      assert.ok(svg.includes('fill="#ff0000"'));
      assert.ok(svg.includes('fill="#00ff00"'));
    });

    it('calculateExportBounds y renderDocumentToCanvas calculan límites y dibujan polígono y estrella', () => {
      const canvas = createMockCanvas();
      const { restore } = setupMockDocument(canvas);
      try {
        const sm = new StateManager();
        const layerId = sm.getState().children[0].id;
        sm.addShape(layerId, {
          id: 'poly-r',
          type: 'polygon',
          name: 'Polígono Raster',
          x: 100,
          y: 100,
          radius: 40,
          sides: 5,
          fill: '#38bdf8',
        });
        sm.addShape(layerId, {
          id: 'star-r',
          type: 'star',
          name: 'Estrella Raster',
          x: 200,
          y: 200,
          outerRadius: 50,
          innerRadius: 25,
          points: 5,
          fill: '#f59e0b',
        });

        const bounds = calculateExportBounds(sm.getState(), true, ['poly-r']);
        assert.ok(bounds.width > 0);
        assert.ok(bounds.height > 0);

        const exportedCanvas = renderDocumentToCanvas(sm.getState(), {
          onlySelected: true,
          selectedIds: ['poly-r'],
        });
        assert.ok(exportedCanvas !== null);
      } finally {
        restore();
      }
    });
  });

  describe('5. InputController y Creación Interactiva con Arrastre', () => {
    it('herramientas polygon y star tienen atajos de teclado Y y S', () => {
      assert.ok(KEYBOARD_SHORTCUTS.some((s) => s.key === 'Y' && s.description.includes('Polígono')));
      assert.ok(KEYBOARD_SHORTCUTS.some((s) => s.key === 'S' && s.description.includes('Estrella')));

      const sm = new StateManager();
      const cm = new CommandManager();
      const canvas = createMockCanvas();
      const ic = new InputController(canvas, sm, cm);

      (ic as any).handleKeyDown({ key: 'y' });
      assert.strictEqual(ic.currentTool, 'polygon');

      (ic as any).handleKeyDown({ key: 's' });
      assert.strictEqual(ic.currentTool, 'star');

      ic.destroy();
    });

    it('arrastre en modo polygon crea nodo Polygon con radio y lados por defecto', () => {
      const sm = new StateManager();
      const cm = new CommandManager();
      const canvas = createMockCanvas();
      const ic = new InputController(canvas, sm, cm);

      ic.setTool('polygon');
      assert.strictEqual(ic.currentTool, 'polygon');

      // Simular arrastre desde (100, 100) hasta (140, 130) -> distancia hipotenusa 50
      (ic as any).handleMouseDown({ clientX: 100, clientY: 100, button: 0 });
      (ic as any).handleMouseMove({ clientX: 140, clientY: 130, button: 0 });
      assert.ok(ic.shapePreview !== null);
      assert.strictEqual(ic.shapePreview?.type, 'polygon');

      (ic as any).handleMouseUp({ clientX: 140, clientY: 130, button: 0 });

      const shapes = sm.getSelectedNodes();
      assert.strictEqual(shapes.length, 1);
      const poly = shapes[0] as Polygon;
      assert.strictEqual(poly.type, 'polygon');
      assert.strictEqual(poly.x, 120);
      assert.strictEqual(poly.y, 120);
      assert.strictEqual(Math.round(poly.radius), 20);
      assert.strictEqual(poly.sides, 5);

      // Deshacer elimina la figura creada
      cm.undo();
      assert.strictEqual(sm.findNode(poly.id), null);

      // Rehacer la vuelve a incorporar en el Scene Graph
      cm.redo();
      assert.ok(sm.findNode(poly.id) !== null);

      ic.destroy();
    });

    it('arrastre en modo star crea nodo Star con outerRadius e innerRadius calculados', () => {
      const sm = new StateManager();
      const cm = new CommandManager();
      const canvas = createMockCanvas();
      const ic = new InputController(canvas, sm, cm);

      ic.setTool('star');
      assert.strictEqual(ic.currentTool, 'star');

      // Arrastre desde (200, 200) hasta (260, 200) -> radio 60
      (ic as any).handleMouseDown({ clientX: 200, clientY: 200, button: 0 });
      (ic as any).handleMouseMove({ clientX: 260, clientY: 200, button: 0 });
      assert.ok(ic.shapePreview !== null);
      assert.strictEqual(ic.shapePreview?.type, 'star');

      (ic as any).handleMouseUp({ clientX: 260, clientY: 200, button: 0 });

      const shapes = sm.getSelectedNodes();
      assert.strictEqual(shapes.length, 1);
      const star = shapes[0] as Star;
      assert.strictEqual(star.type, 'star');
      assert.strictEqual(star.x, 230);
      assert.strictEqual(star.y, 230);
      assert.strictEqual(Math.round(star.outerRadius), 30);
      assert.strictEqual(Math.round(star.innerRadius), 15); // outerRadius / 2
      assert.strictEqual(star.points, 5);

      ic.destroy();
    });
  });

  describe('6. Integración UI: Toolbar, StatusBar y Panel de Propiedades', () => {
    it('ToolbarController activa botones y StatusBarController refleja etiquetas de Polígono y Estrella', () => {
      const canvas = createMockCanvas();
      const { elements, restore } = setupMockDocument(canvas);
      try {
        const sm = new StateManager();
        const cm = new CommandManager();
        const ic = new InputController(canvas, sm, cm);

        const ui = setupUIBindings(ic, cm, sm);

        // Probar cambio a herramienta Polígono
        const btnPoly = elements.get('tool-polygon')!;
        btnPoly.click();
        assert.strictEqual(ic.currentTool, 'polygon');
        assert.strictEqual(btnPoly.classList.contains('active'), true);
        assert.strictEqual(btnPoly.getAttribute('aria-pressed'), 'true');
        assert.strictEqual(elements.get('status-tool-label')!.textContent, 'Modo: Polígono regular');

        // Probar cambio a herramienta Estrella
        const btnStar = elements.get('tool-star')!;
        btnStar.click();
        assert.strictEqual(ic.currentTool, 'star');
        assert.strictEqual(btnStar.classList.contains('active'), true);
        assert.strictEqual(elements.get('status-tool-label')!.textContent, 'Modo: Estrella');

        ui.cleanup();
        ic.destroy();
      } finally {
        restore();
      }
    });

    it('Panel de Propiedades muestra sección Polígono y permite modificar lados y radio con Undo/Redo', () => {
      const canvas = createMockCanvas();
      const { elements, restore } = setupMockDocument(canvas);
      try {
        const sm = new StateManager();
        const cm = new CommandManager();
        const ic = new InputController(canvas, sm, cm);

        const ui = setupUIBindings(ic, cm, sm);

        const layerId = sm.getState().children[0].id;
        const poly: Polygon = {
          id: 'poly-ui',
          type: 'polygon',
          name: 'Polígono UI',
          x: 100,
          y: 100,
          radius: 40,
          sides: 5,
        };
        sm.addShape(layerId, poly);
        sm.setSelection(['poly-ui']);

        const secPoly = elements.get('section-polygon')!;
        const secStar = elements.get('section-star')!;
        assert.strictEqual(secPoly.style.display, 'block');
        assert.strictEqual(secStar.style.display, 'none');

        const inputSides = elements.get('input-polygon-sides')!;
        const inputRadius = elements.get('input-polygon-radius')!;
        assert.strictEqual(inputSides.value, '5');
        assert.strictEqual(inputRadius.value, '40');

        // Modificar lados a 7
        inputSides.focus();
        inputSides.value = '7';
        inputSides.dispatchEvent({ type: 'change' });

        let currentPoly = sm.findNode('poly-ui') as Polygon;
        assert.strictEqual(currentPoly.sides, 7);

        // Deshacer restaura a 5
        cm.undo();
        currentPoly = sm.findNode('poly-ui') as Polygon;
        assert.strictEqual(currentPoly.sides, 5);

        // Rehacer vuelve a 7
        cm.redo();
        currentPoly = sm.findNode('poly-ui') as Polygon;
        assert.strictEqual(currentPoly.sides, 7);

        ui.cleanup();
        ic.destroy();
      } finally {
        restore();
      }
    });

    it('Panel de Propiedades muestra sección Estrella y permite modificar puntas y radios con Undo/Redo', () => {
      const canvas = createMockCanvas();
      const { elements, restore } = setupMockDocument(canvas);
      try {
        const sm = new StateManager();
        const cm = new CommandManager();
        const ic = new InputController(canvas, sm, cm);

        const ui = setupUIBindings(ic, cm, sm);

        const layerId = sm.getState().children[0].id;
        const star: Star = {
          id: 'star-ui',
          type: 'star',
          name: 'Estrella UI',
          x: 200,
          y: 200,
          outerRadius: 60,
          innerRadius: 30,
          points: 5,
        };
        sm.addShape(layerId, star);
        sm.setSelection(['star-ui']);

        const secPoly = elements.get('section-polygon')!;
        const secStar = elements.get('section-star')!;
        assert.strictEqual(secPoly.style.display, 'none');
        assert.strictEqual(secStar.style.display, 'block');

        const inputPoints = elements.get('input-star-points')!;
        const inputOuter = elements.get('input-star-outer-radius')!;
        const inputInner = elements.get('input-star-inner-radius')!;
        assert.strictEqual(inputPoints.value, '5');
        assert.strictEqual(inputOuter.value, '60');
        assert.strictEqual(inputInner.value, '30');

        // Modificar puntas a 8
        inputPoints.focus();
        inputPoints.value = '8';
        inputPoints.dispatchEvent({ type: 'change' });

        let currentStar = sm.findNode('star-ui') as Star;
        assert.strictEqual(currentStar.points, 8);

        // Modificar radio exterior a 85
        inputOuter.focus();
        inputOuter.value = '85';
        inputOuter.dispatchEvent({ type: 'change' });

        currentStar = sm.findNode('star-ui') as Star;
        assert.strictEqual(currentStar.outerRadius, 85);

        // Deshacer radio exterior
        cm.undo();
        currentStar = sm.findNode('star-ui') as Star;
        assert.strictEqual(currentStar.outerRadius, 60);

        // Deshacer puntas
        cm.undo();
        currentStar = sm.findNode('star-ui') as Star;
        assert.strictEqual(currentStar.points, 5);

        ui.cleanup();
        ic.destroy();
      } finally {
        restore();
      }
    });
  });
});
