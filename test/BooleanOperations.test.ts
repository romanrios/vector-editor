import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { InputController } from '../src/input/InputController.ts';
import { setupUIBindings } from '../src/main.ts';
import {
  polygonArea,
  isPointInPolygon,
  isPointInMultiPolygon,
  ensureCCW,
  simplifyPolygon,
  bridgeHoleToOuter,
  shapeToPolygon,
  isClosedShape,
  combineRings,
  executeBooleanOperation,
  processHolesAndIslands,
} from '../src/utils/booleanOperations.ts';
import { BooleanOperationCommand } from '../src/commands/BooleanOperationCommand.ts';
import type {
  Rectangle,
  Ellipse,
  Path,
  Group,
} from '../src/types/scene-graph.ts';

// Mock minimalista de Canvas para InputController
function createMockCanvas(): HTMLCanvasElement & { dispatchSimulatedEvent: (type: string, e: unknown) => void } {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};

  const mockCtx: Partial<CanvasRenderingContext2D> = {
    save: () => {},
    restore: () => {},
    setTransform: () => {},
    clearRect: () => {},
    fillRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    bezierCurveTo: () => {},
    closePath: () => {},
    stroke: () => {},
    fill: () => {},
    rect: () => {},
    roundRect: () => {},
    strokeRect: () => {},
    ellipse: () => {},
    arc: () => {},
    translate: () => {},
    rotate: () => {},
    setLineDash: () => {},
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
  };

  return {
    style: { cursor: 'default' },
    width: 1000,
    height: 800,
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
    getContext: () => mockCtx as CanvasRenderingContext2D,
    addEventListener: (type: string, listener: unknown) => {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(listener as (e: unknown) => void);
    },
    removeEventListener: (type: string, listener: unknown) => {
      if (!listeners[type]) return;
      listeners[type] = listeners[type].filter((l) => l !== listener);
    },
    dispatchSimulatedEvent: (type: string, e: unknown) => {
      if (listeners[type]) {
        for (const l of listeners[type]) {
          l(e);
        }
      }
    },
    focus: () => {},
  } as unknown as HTMLCanvasElement & { dispatchSimulatedEvent: (type: string, e: unknown) => void };
}

// Mock DOM para pruebas de UI y bindings
class MockElement {
  public id: string;
  public tagName: string;
  public disabled: boolean = false;
  public hidden: boolean = false;
  public textContent: string = '';
  public value: string = '';
  public innerHTML: string = '';
  public style: Record<string, string> = {};
  public children: MockElement[] = [];
  public parentElement: MockElement | null = null;
  private attributes: Map<string, string> = new Map();
  private classes: Set<string> = new Set();
  private listeners: Map<string, Set<(e: any) => void>> = new Map();

  constructor(id: string = '', tagName: string = 'div') {
    this.id = id;
    this.tagName = tagName;
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

  public hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  public addEventListener(type: string, listener: (e: any) => void): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  public removeEventListener(type: string, listener: (e: any) => void): void {
    const set = this.listeners.get(type);
    if (set) set.delete(listener);
  }

  public dispatchEvent(event: { type: string; [key: string]: any }): boolean {
    if (!event.stopPropagation) event.stopPropagation = () => {};
    if (!event.preventDefault) event.preventDefault = () => {};
    if (!event.target) event.target = this;
    const set = this.listeners.get(event.type);
    if (set) {
      for (const listener of Array.from(set)) {
        listener(event);
      }
    }
    return true;
  }

  public click(): void {
    this.dispatchEvent({ type: 'click' });
  }

  public focus(): void {}

  public closest(selector: string): MockElement | null {
    if (selector.startsWith('.') && this.classes.has(selector.slice(1))) {
      return this;
    }
    return this.parentElement ? this.parentElement.closest(selector) : null;
  }
}

describe('Sistema de Operaciones Booleanas / Pathfinder', () => {
  describe('1. Funciones geométricas auxiliares y polígonos', () => {
    it('calcula correctamente el área orientada de polígonos convexos y cóncavos', () => {
      // Cuadrado 100x100 en sentido antihorario (CCW)
      const squareCCW = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ];
      assert.strictEqual(polygonArea(squareCCW), 10000);

      // Cuadrado en sentido horario (CW) -> área negativa
      const squareCW = [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
        { x: 100, y: 100 },
        { x: 100, y: 0 },
      ];
      assert.strictEqual(polygonArea(squareCW), -10000);

      // ensureCCW invierte si es horario y mantiene si es antihorario
      const converted = ensureCCW(squareCW);
      assert.strictEqual(polygonArea(converted), 10000);
      assert.strictEqual(polygonArea(ensureCCW(squareCCW)), 10000);
    });

    it('determina pertenencia de punto en polígono (isPointInPolygon y isPointInMultiPolygon)', () => {
      const ring = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ];
      assert.strictEqual(isPointInPolygon({ x: 50, y: 50 }, ring), true);
      assert.strictEqual(isPointInPolygon({ x: 150, y: 50 }, ring), false);
      assert.strictEqual(isPointInPolygon({ x: -10, y: 50 }, ring), false);

      // MultiPolígono disjunto
      const ring2 = [
        { x: 200, y: 0 },
        { x: 300, y: 0 },
        { x: 300, y: 100 },
        { x: 200, y: 100 },
      ];
      assert.strictEqual(isPointInMultiPolygon({ x: 50, y: 50 }, [ring, ring2]), true);
      assert.strictEqual(isPointInMultiPolygon({ x: 250, y: 50 }, [ring, ring2]), true);
      assert.strictEqual(isPointInMultiPolygon({ x: 150, y: 50 }, [ring, ring2]), false);
    });

    it('simplifica vértices colineales y duplicados con simplifyPolygon', () => {
      const ringWithCollinear = [
        { x: 0, y: 0 },
        { x: 50, y: 0 }, // Colineal
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ];
      const simplified = simplifyPolygon(ringWithCollinear);
      assert.strictEqual(simplified.length, 4);
      assert.strictEqual(polygonArea(simplified), 10000);
    });

    it('puentea correctamente un hueco interior con el contorno exterior (bridgeHoleToOuter)', () => {
      const outer = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ];
      const hole = [
        { x: 25, y: 25 },
        { x: 25, y: 75 },
        { x: 75, y: 75 },
        { x: 75, y: 25 },
      ];
      const bridged = bridgeHoleToOuter(outer, hole);
      assert.ok(bridged.length >= outer.length + hole.length);
      // El área neta orientada del contorno con corte de puente de grosor 0 es el área exterior menos el área del hueco
      const area = polygonArea(bridged);
      assert.ok(Math.abs(area - (10000 - 2500)) < 100);
    });
  });

  describe('2. Conversión Universal de Figuras a Trazados Cerrados (shapeToPolygon)', () => {
    it('convierte Rectangle estándar a polígono de 4 vértices CCW', () => {
      const rect: Rectangle = {
        id: 'rect-1',
        name: 'Rect 1',
        type: 'rectangle',
        x: 10,
        y: 20,
        width: 100,
        height: 60,
        rotation: 0,
        fill: '#ff0000',
        stroke: 'none',
        strokeWidth: 1,
        opacity: 1,
      };
      assert.strictEqual(isClosedShape(rect), true);
      const poly = shapeToPolygon(rect);
      assert.strictEqual(poly.length, 4);
      assert.strictEqual(polygonArea(poly), 6000);
    });

    it('convierte Rectangle rotado manteniendo el área exacta y vértices proyectados', () => {
      const rect: Rectangle = {
        id: 'rect-rot',
        name: 'Rect Rot',
        type: 'rectangle',
        x: 50,
        y: 50,
        width: 100,
        height: 50,
        rotation: 45,
        fill: '#00ff00',
        stroke: 'none',
        strokeWidth: 1,
        opacity: 1,
      };
      const poly = shapeToPolygon(rect);
      assert.strictEqual(poly.length, 4);
      assert.ok(Math.abs(polygonArea(poly) - 5000) < 1e-4);
    });

    it('convierte Rectangle con cornerRadius aproximando las 4 esquinas redondeadas', () => {
      const rect: Rectangle = {
        id: 'rect-rounded',
        name: 'Rect Rounded',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        cornerRadius: 20,
        rotation: 0,
        fill: '#0000ff',
        stroke: 'none',
        strokeWidth: 1,
        opacity: 1,
      };
      const poly = shapeToPolygon(rect);
      // Debe tener múltiples vértices por esquina aproximada
      assert.ok(poly.length > 8);
      // El área de un cuadrado de 100x100 con r=20 es 100*100 - (4 - PI)*20^2 = 10000 - (4 - 3.14159)*400 = ~9656.6
      const area = polygonArea(poly);
      assert.ok(area > 9500 && area < 9800);
    });

    it('convierte Ellipse a polígono suave en coordenadas absolutas', () => {
      const ellipse: Ellipse = {
        id: 'ell-1',
        name: 'Ellipse 1',
        type: 'ellipse',
        x: 100,
        y: 100,
        radiusX: 50,
        radiusY: 30,
        rotation: 0,
        fill: '#ffff00',
        stroke: 'none',
        strokeWidth: 1,
        opacity: 1,
      };
      assert.strictEqual(isClosedShape(ellipse), true);
      const poly = shapeToPolygon(ellipse);
      assert.ok(poly.length >= 32);
      // Área elipse = PI * rx * ry = 3.14159 * 50 * 30 = ~4712.38
      const area = polygonArea(poly);
      assert.ok(Math.abs(area - Math.PI * 50 * 30) < 50);
    });

    it('convierte Ellipse rotada', () => {
      const ellipse: Ellipse = {
        id: 'ell-rot',
        name: 'Ellipse Rot',
        type: 'ellipse',
        x: 150,
        y: 150,
        radiusX: 40,
        radiusY: 20,
        rotation: 90,
        fill: '#ffff00',
        stroke: 'none',
        strokeWidth: 1,
        opacity: 1,
      };
      const poly = shapeToPolygon(ellipse);
      const area = polygonArea(poly);
      assert.ok(Math.abs(area - Math.PI * 40 * 20) < 50);
    });

    it('convierte Path cerrado (rectilíneo y con curvas Bézier cúbicas)', () => {
      // Triángulo cerrado
      const triPath: Path = {
        id: 'path-tri',
        name: 'Path Tri',
        type: 'path',
        x: 0,
        y: 0,
        rotation: 0,
        fill: '#00ffff',
        stroke: 'none',
        strokeWidth: 1,
        opacity: 1,
        closed: true,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 50, y: 80 },
        ],
      };
      assert.strictEqual(isClosedShape(triPath), true);
      const polyTri = shapeToPolygon(triPath);
      assert.strictEqual(polyTri.length, 3);
      assert.strictEqual(polygonArea(polyTri), 4000);

      // Path con curva Bézier
      const bezierPath: Path = {
        id: 'path-bez',
        name: 'Path Bez',
        type: 'path',
        x: 0,
        y: 0,
        rotation: 0,
        fill: '#00ffff',
        stroke: 'none',
        strokeWidth: 1,
        opacity: 1,
        closed: true,
        points: [
          { x: 0, y: 0, handleOut: { x: 30, y: -20 } },
          { x: 100, y: 0, handleIn: { x: 70, y: -20 } },
          { x: 50, y: 80 },
        ],
      };
      const polyBez = shapeToPolygon(bezierPath);
      // El segmento curvo debe haber sido subdividido adaptativamente
      assert.ok(polyBez.length > 5);
      assert.ok(polygonArea(polyBez) > 4000);

      // Path abierto no se considera figura cerrada
      const openPath: Path = {
        ...triPath,
        id: 'path-open',
        closed: false,
      };
      assert.strictEqual(isClosedShape(openPath), false);
      assert.strictEqual(shapeToPolygon(openPath).length, 0);
    });
  });

  describe('3. Algoritmo Pathfinder 2D: Unión, Sustracción, Intersección y Exclusión', () => {
    // Definimos dos rectángulos de 100x100: A en (0,0)-(100,100), B en (50,0)-(150,100)
    // Se solapan en x ∈ [50, 100], área solape = 50 * 100 = 5000.
    const ringA = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const ringB = [
      { x: 50, y: 0 },
      { x: 150, y: 0 },
      { x: 150, y: 100 },
      { x: 50, y: 100 },
    ];

    it('Unión (Union): fusiona dos rectángulos solapados en un solo contorno', () => {
      const rings = combineRings('union', [ringA], [ringB]);
      assert.strictEqual(rings.length, 1);
      // El área esperada es 10000 + 10000 - 5000 = 15000
      const area = polygonArea(rings[0]);
      assert.strictEqual(area, 15000);
    });

    it('Sustracción (Subtract): resta la figura superior de la inferior (A menos B)', () => {
      const rings = combineRings('subtract', [ringA], [ringB]);
      assert.strictEqual(rings.length, 1);
      // Área esperada de A \ B: 10000 - 5000 = 5000 (rectángulo de 50x100 de 0 a 50)
      const area = polygonArea(rings[0]);
      assert.strictEqual(area, 5000);
      assert.strictEqual(isPointInPolygon({ x: 25, y: 50 }, rings[0]), true);
      assert.strictEqual(isPointInPolygon({ x: 75, y: 50 }, rings[0]), false);
    });

    it('Intersección (Intersect): conserva exclusivamente el solape común', () => {
      const rings = combineRings('intersect', [ringA], [ringB]);
      assert.strictEqual(rings.length, 1);
      // Área esperada: 5000 (de 50 a 100)
      const area = polygonArea(rings[0]);
      assert.strictEqual(area, 5000);
      assert.strictEqual(isPointInPolygon({ x: 75, y: 50 }, rings[0]), true);
      assert.strictEqual(isPointInPolygon({ x: 25, y: 50 }, rings[0]), false);
      assert.strictEqual(isPointInPolygon({ x: 125, y: 50 }, rings[0]), false);
    });

    it('Exclusión / XOR (Exclude): conserva las áreas que no se solapan', () => {
      const rings = combineRings('exclude', [ringA], [ringB]);
      // Debe producir dos anillos disjuntos: A \ B y B \ A
      assert.strictEqual(rings.length, 2);
      const totalArea = polygonArea(rings[0]) + polygonArea(rings[1]);
      assert.strictEqual(totalArea, 10000); // 5000 + 5000
      assert.strictEqual(isPointInPolygon({ x: 75, y: 50 }, rings[0]), false);
      assert.strictEqual(isPointInPolygon({ x: 75, y: 50 }, rings[1]), false);
    });

    it('Casos límite: figuras disjuntas', () => {
      const ringDisjointA = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ];
      const ringDisjointB = [
        { x: 200, y: 0 },
        { x: 300, y: 0 },
        { x: 300, y: 100 },
        { x: 200, y: 100 },
      ];

      // Unión disjunta: conserva ambos anillos
      const union = combineRings('union', [ringDisjointA], [ringDisjointB]);
      assert.strictEqual(union.length, 2);

      // Sustracción disjunta: la base queda intacta
      const sub = combineRings('subtract', [ringDisjointA], [ringDisjointB]);
      assert.strictEqual(sub.length, 1);
      assert.strictEqual(polygonArea(sub[0]), 10000);

      // Intersección disjunta: vacío
      const inter = combineRings('intersect', [ringDisjointA], [ringDisjointB]);
      assert.strictEqual(inter.length, 0);

      // Exclusión disjunta: conserva ambos anillos
      const excl = combineRings('exclude', [ringDisjointA], [ringDisjointB]);
      assert.strictEqual(excl.length, 2);
    });

    it('Casos límite: figuras idénticas y coincidentes', () => {
      // Unión de figuras idénticas: queda 1 figura idéntica
      const union = combineRings('union', [ringA], [ringA]);
      assert.strictEqual(union.length, 1);
      assert.strictEqual(polygonArea(union[0]), 10000);

      // Intersección de figuras idénticas: queda 1 figura idéntica
      const inter = combineRings('intersect', [ringA], [ringA]);
      assert.strictEqual(inter.length, 1);
      assert.strictEqual(polygonArea(inter[0]), 10000);

      // Sustracción de figuras idénticas: se cancela (vacío)
      const sub = combineRings('subtract', [ringA], [ringA]);
      assert.strictEqual(sub.length, 0);

      // Exclusión de figuras idénticas: se cancela (vacío)
      const excl = combineRings('exclude', [ringA], [ringA]);
      assert.strictEqual(excl.length, 0);
    });

    it('Casos límite: figura completamente contenida dentro de otra', () => {
      const outerSquare = [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 200 },
        { x: 0, y: 200 },
      ];
      const innerSquare = [
        { x: 50, y: 50 },
        { x: 150, y: 50 },
        { x: 150, y: 150 },
        { x: 50, y: 150 },
      ];

      // Unión: el cuadrado exterior absorbe al interior
      const union = combineRings('union', [outerSquare], [innerSquare]);
      assert.strictEqual(union.length, 1);
      assert.strictEqual(polygonArea(union[0]), 40000);

      // Intersección: el resultado es el cuadrado interior
      const inter = combineRings('intersect', [outerSquare], [innerSquare]);
      assert.strictEqual(inter.length, 1);
      assert.strictEqual(polygonArea(inter[0]), 10000);

      // Sustracción exterior menos interior: genera un contorno exterior y un hueco interior
      const sub = combineRings('subtract', [outerSquare], [innerSquare]);
      assert.strictEqual(sub.length, 2);
      const bridged = processHolesAndIslands(sub);
      assert.strictEqual(bridged.length, 1);
      const subArea = polygonArea(bridged[0]);
      assert.ok(Math.abs(subArea - 30000) < 100);

      // Sustracción interior menos exterior: el interior es completamente eliminado
      const subInvert = combineRings('subtract', [innerSquare], [outerSquare]);
      assert.strictEqual(subInvert.length, 0);
    });
  });

  describe('4. executeBooleanOperation con reducción multi-figura y herencia de estilo', () => {
    it('ejecuta Unión sobre 3 figuras solapadas heredando estilos de la figura inferior S0', () => {
      const rect0: Rectangle = {
        id: 'r0',
        name: 'Rect 0',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        fill: '#ff5500',
        stroke: '#111111',
        strokeWidth: 4,
        strokeDashArray: [5, 5],
        opacity: 0.85,
      };
      const rect1: Rectangle = {
        id: 'r1',
        name: 'Rect 1',
        type: 'rectangle',
        x: 50,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        fill: '#00ff00',
        stroke: 'none',
        strokeWidth: 1,
        opacity: 1,
      };
      const rect2: Rectangle = {
        id: 'r2',
        name: 'Rect 2',
        type: 'rectangle',
        x: 100,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        fill: '#0000ff',
        stroke: 'none',
        strokeWidth: 1,
        opacity: 1,
      };

      const results = executeBooleanOperation('union', [rect0, rect1, rect2]);
      assert.strictEqual(results.length, 1);
      const res = results[0];
      assert.strictEqual(res.type, 'path');
      assert.strictEqual(res.closed, true);
      // Hereda atributos visuales de rect0
      assert.strictEqual(res.fill, '#ff5500');
      assert.strictEqual(res.stroke, '#111111');
      assert.strictEqual(res.strokeWidth, 4);
      assert.deepStrictEqual(res.strokeDashArray, [5, 5]);
      assert.strictEqual(res.opacity, 0.85);

      // Ancho combinado de 0 a 200, alto 100 -> área = 20000
      const poly = shapeToPolygon(res);
      assert.strictEqual(polygonArea(poly), 20000);
    });

    it('combina Rectangle y Ellipse en Unión y Sustracción', () => {
      const baseRect: Rectangle = {
        id: 'base-rect',
        name: 'Base Rect',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        fill: '#aa00aa',
        stroke: 'none',
        strokeWidth: 1,
        opacity: 1,
      };
      // Círculo centrado en (100, 50) de radio 50 (solapa la mitad derecha del rect)
      const cutterCircle: Ellipse = {
        id: 'cutter-circle',
        name: 'Cutter Circle',
        type: 'ellipse',
        x: 100,
        y: 50,
        radiusX: 50,
        radiusY: 50,
        rotation: 0,
        fill: '#ffff00',
        stroke: 'none',
        strokeWidth: 1,
        opacity: 1,
      };

      // Sustracción
      const subResults = executeBooleanOperation('subtract', [baseRect, cutterCircle]);
      assert.strictEqual(subResults.length, 1);
      const subPoly = shapeToPolygon(subResults[0]);
      // Rectángulo con una mordida semicircular en el lado derecho
      // Área aproximada: 10000 - (PI * 50^2 / 2) = 10000 - 3927 = ~6073
      const subArea = polygonArea(subPoly);
      assert.ok(subArea > 5800 && subArea < 6300);

      // Unión
      const unionResults = executeBooleanOperation('union', [baseRect, cutterCircle]);
      assert.strictEqual(unionResults.length, 1);
      const unionPoly = shapeToPolygon(unionResults[0]);
      // Área aproximada: 10000 + (PI * 50^2 / 2) = 10000 + 3927 = ~13927
      const unionArea = polygonArea(unionPoly);
      assert.ok(unionArea > 13600 && unionArea < 14200);
    });
  });

  describe('5. BooleanOperationCommand con Undo y Redo', () => {
    it('ejecuta comando, sustituye figuras de origen, actualiza selección y deshace/rehace fielmente', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const defaultLayerId = stateManager.getActiveLayer()?.id || stateManager.getState().children[0].id;

      const r1: Rectangle = {
        id: 'r1',
        name: 'R1',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        fill: '#112233',
        stroke: '#445566',
        strokeWidth: 2,
        opacity: 1,
      };
      const r2: Rectangle = {
        id: 'r2',
        name: 'R2',
        type: 'rectangle',
        x: 50,
        y: 50,
        width: 100,
        height: 100,
        rotation: 0,
        fill: '#778899',
        stroke: 'none',
        strokeWidth: 1,
        opacity: 1,
      };

      stateManager.addShape(defaultLayerId, r1);
      stateManager.addShape(defaultLayerId, r2);
      stateManager.setSelection(['r1', 'r2']);

      const initialDoc = stateManager.getState();
      assert.strictEqual(initialDoc.children[0].children.length, 2);

      // Ejecución del comando
      const cmd = new BooleanOperationCommand(stateManager, 'union', [r1, r2]);
      commandManager.executeCommand(cmd);

      // Después de ejecutar: r1 y r2 deben ser eliminados, y se inserta el nuevo Path
      const docAfter = stateManager.getState();
      const layerChildren = docAfter.children[0].children;
      assert.strictEqual(layerChildren.length, 1);
      const createdPath = layerChildren[0] as Path;
      assert.strictEqual(createdPath.type, 'path');
      assert.strictEqual(createdPath.closed, true);
      assert.strictEqual(createdPath.fill, '#112233');

      // La selección se actualiza al nuevo Path
      assert.deepStrictEqual(stateManager.getSelection(), [createdPath.id]);
      assert.strictEqual(Object.isFrozen(docAfter), true);

      // Deshacer (Undo)
      commandManager.undo();
      const docAfterUndo = stateManager.getState();
      assert.strictEqual(docAfterUndo.children[0].children.length, 2);
      assert.ok(stateManager.findNode('r1'));
      assert.ok(stateManager.findNode('r2'));
      assert.deepStrictEqual(stateManager.getSelection(), ['r1', 'r2']);
      assert.strictEqual(Object.isFrozen(docAfterUndo), true);

      // Rehacer (Redo)
      commandManager.redo();
      const docAfterRedo = stateManager.getState();
      assert.strictEqual(docAfterRedo.children[0].children.length, 1);
      assert.strictEqual(docAfterRedo.children[0].children[0].id, createdPath.id);
      assert.deepStrictEqual(stateManager.getSelection(), [createdPath.id]);
    });

    it('gestiona adecuadamente figuras pertenecientes a grupos podando grupos que queden vacíos y restaurándolos en Undo', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();

      const rA: Rectangle = {
        id: 'ra',
        name: 'RA',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        fill: '#ff0000',
        stroke: 'none',
        strokeWidth: 1,
        opacity: 1,
      };
      const rB: Rectangle = {
        id: 'rb',
        name: 'RB',
        type: 'rectangle',
        x: 40,
        y: 40,
        width: 100,
        height: 100,
        rotation: 0,
        fill: '#00ff00',
        stroke: 'none',
        strokeWidth: 1,
        opacity: 1,
      };

      // Añadimos ra y rb en un Group
      const defaultLayerId = stateManager.getActiveLayer()?.id || stateManager.getState().children[0].id;
      const group: Group = {
        id: 'group-1',
        name: 'Mi Grupo',
        type: 'group',
        children: [rA, rB],
      };
      stateManager.addNode(defaultLayerId, group);
      assert.strictEqual(stateManager.findNode('group-1')?.type, 'group');

      // Seleccionamos el grupo completo
      stateManager.setSelection(['group-1']);

      const cmd = new BooleanOperationCommand(stateManager, 'union', [group]);
      commandManager.executeCommand(cmd);

      // Al fusionar todas las figuras del grupo, el grupo original quedó vacío y fue podado
      const docAfter = stateManager.getState();
      assert.strictEqual(stateManager.findNode('group-1'), null);
      // El nuevo trazado se ubica en la capa padre
      assert.strictEqual(docAfter.children[0].children.length, 1);

      // Deshacer restaura el grupo con sus figuras originales
      commandManager.undo();
      const restoredGroup = stateManager.findNode('group-1') as Group;
      assert.ok(restoredGroup);
      assert.strictEqual(restoredGroup.children.length, 2);
      assert.deepStrictEqual(stateManager.getSelection(), ['group-1']);
    });
  });

  describe('6. Integración con SelectionOperations e InputController', () => {
    it('applyBooleanOperation valida cantidad de figuras y figuras bloqueadas', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const canvas = createMockCanvas();
      const inputController = new InputController(canvas, stateManager, commandManager);
      const defaultLayerId = stateManager.getActiveLayer()?.id || stateManager.getState().children[0].id;

      const r1: Rectangle = {
        id: 'r1',
        name: 'R1',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 80,
        height: 80,
        rotation: 0,
        fill: '#111',
        stroke: 'none',
        strokeWidth: 1,
        opacity: 1,
      };
      const r2: Rectangle = {
        id: 'r2',
        name: 'R2',
        type: 'rectangle',
        x: 40,
        y: 40,
        width: 80,
        height: 80,
        rotation: 0,
        fill: '#222',
        stroke: 'none',
        strokeWidth: 1,
        opacity: 1,
      };

      stateManager.addShape(defaultLayerId, r1);
      stateManager.addShape(defaultLayerId, r2);

      // Con 0 o 1 figura seleccionada retorna false
      stateManager.setSelection([]);
      assert.strictEqual(inputController.applyBooleanOperation('union'), false);

      stateManager.setSelection(['r1']);
      assert.strictEqual(inputController.applyBooleanOperation('union'), false);

      // Con figura bloqueada efectiva que reduzca a < 2 retorna false
      stateManager.setSelection(['r1', 'r2']);
      stateManager.setNodeLocked('r2', true);
      assert.strictEqual(inputController.applyBooleanOperation('union'), false);

      // Desbloqueada: re-seleccionamos y ejecuta correctamente retornando true
      stateManager.setNodeLocked('r2', false);
      stateManager.setSelection(['r1', 'r2']);
      assert.strictEqual(inputController.applyBooleanOperation('union'), true);
      assert.strictEqual(stateManager.getState().children[0].children.length, 1);
    });
  });

  describe('7. Interfaz de Usuario y Panel de Propiedades', () => {
    it('conmuta visibilidad de #section-pathfinder según cantidad de figuras cerradas y procesa clics', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const canvas = createMockCanvas();
      const inputController = new InputController(canvas, stateManager, commandManager);

      // Preparamos elementos mock requeridos por setupUIBindings
      const mockElements: Record<string, MockElement> = {
        '#section-pathfinder': new MockElement('section-pathfinder', 'details'),
        '#btn-pathfinder-union': new MockElement('btn-pathfinder-union', 'button'),
        '#btn-pathfinder-subtract': new MockElement('btn-pathfinder-subtract', 'button'),
        '#btn-pathfinder-intersect': new MockElement('btn-pathfinder-intersect', 'button'),
        '#btn-pathfinder-exclude': new MockElement('btn-pathfinder-exclude', 'button'),
        '#menu-item-pathfinder': new MockElement('menu-item-pathfinder', 'button'),
        '#menu-dropdown-pathfinder': new MockElement('menu-dropdown-pathfinder', 'div'),
        '#menu-item-pathfinder-union': new MockElement('menu-item-pathfinder-union', 'button'),
        '#menu-item-pathfinder-subtract': new MockElement('menu-item-pathfinder-subtract', 'button'),
        '#menu-item-pathfinder-intersect': new MockElement('menu-item-pathfinder-intersect', 'button'),
        '#menu-item-pathfinder-exclude': new MockElement('menu-item-pathfinder-exclude', 'button'),
        '#selection-state': new MockElement('selection-state', 'div'),
        '#no-selection-state': new MockElement('no-selection-state', 'div'),
        '#section-align': new MockElement('section-align', 'details'),
        '#menu-item-align': new MockElement('menu-item-align', 'button'),
        '#menu-dropdown-align': new MockElement('menu-dropdown-align', 'div'),
        '#menu-item-distribute': new MockElement('menu-item-distribute', 'button'),
        '#menu-dropdown-distribute': new MockElement('menu-dropdown-distribute', 'div'),
      };

      const docListeners: Record<string, ((e: any) => void)[]> = {};

      // Mock global document
      const origDocument = (globalThis as any).document;
      (globalThis as any).document = {
        activeElement: null,
        querySelector: (sel: string) => mockElements[sel] ?? null,
        querySelectorAll: () => [],
        addEventListener: (event: string, cb: (e: any) => void) => {
          docListeners[event] = docListeners[event] || [];
          docListeners[event].push(cb);
        },
        removeEventListener: (event: string, cb: (e: any) => void) => {
          if (docListeners[event]) {
            docListeners[event] = docListeners[event].filter((fn) => fn !== cb);
          }
        },
        dispatchEvent: (e: any) => {
          if (!e.stopPropagation) e.stopPropagation = () => {};
          if (!e.preventDefault) e.preventDefault = () => {};
          if (docListeners[e.type]) {
            for (const cb of docListeners[e.type]) cb(e);
          }
        },
        body: new MockElement('body', 'body'),
      };

      try {
        const { cleanup } = setupUIBindings(
          inputController,
          commandManager,
          stateManager
        );

        const defaultLayerId = stateManager.getActiveLayer()?.id || stateManager.getState().children[0].id;
        const r1: Rectangle = {
          id: 'rect-a',
          name: 'Rect A',
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 50,
          height: 50,
          rotation: 0,
          fill: '#f00',
          stroke: 'none',
          strokeWidth: 1,
          opacity: 1,
        };
        const r2: Rectangle = {
          id: 'rect-b',
          name: 'Rect B',
          type: 'rectangle',
          x: 30,
          y: 30,
          width: 50,
          height: 50,
          rotation: 0,
          fill: '#0f0',
          stroke: 'none',
          strokeWidth: 1,
          opacity: 1,
        };

        stateManager.addShape(defaultLayerId, r1);
        stateManager.addShape(defaultLayerId, r2);

        // Sin selección: sección pathfinder oculta
        stateManager.setSelection([]);
        assert.strictEqual(mockElements['#section-pathfinder'].style.display, 'none');

        // Con 1 figura: sección oculta
        stateManager.setSelection(['rect-a']);
        assert.strictEqual(mockElements['#section-pathfinder'].style.display, 'none');

        // Con 2 figuras cerradas: sección visible y botones habilitados
        stateManager.setSelection(['rect-a', 'rect-b']);
        assert.strictEqual(mockElements['#section-pathfinder'].style.display, 'block');
        assert.strictEqual(mockElements['#btn-pathfinder-union'].disabled, false);
        assert.strictEqual(mockElements['#menu-item-pathfinder'].disabled, false);

        // Clic en el botón #btn-pathfinder-intersect
        mockElements['#btn-pathfinder-intersect'].click();

        // Debe haber ejecutado la intersección, dejando 1 figura y actualizando selección
        assert.strictEqual(stateManager.getState().children[0].children.length, 1);
        assert.strictEqual(stateManager.getSelection().length, 1);

        // Con 1 figura resultante, la sección pathfinder se vuelve a ocultar automáticamente
        assert.strictEqual(mockElements['#section-pathfinder'].style.display, 'none');

        // Undo restaura las 2 figuras y reactiva la sección
        commandManager.undo();
        assert.strictEqual(stateManager.getState().children[0].children.length, 2);
        assert.strictEqual(mockElements['#section-pathfinder'].style.display, 'block');

        cleanup();
      } finally {
        (globalThis as any).document = origDocument;
      }
    });
  });
});
