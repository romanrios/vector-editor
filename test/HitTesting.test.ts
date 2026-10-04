import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { InputController } from '../src/input/InputController.ts';
import { ViewportManager } from '../src/utils/viewport.ts';
import { isPointInShape, getShapeAABB, getSelectionHandles } from '../src/utils/geometry.ts';
import type { Rectangle, Ellipse } from '../src/types/scene-graph.ts';

interface MockCanvas extends HTMLCanvasElement {
  dispatchSimulatedEvent(type: string, event: unknown): void;
}

// Mock de Canvas para simular eventos y bounding rect en Node.js
function createMockCanvas(): MockCanvas {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};

  return {
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
    getContext: () => null,
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
  } as unknown as MockCanvas;
}

describe('isPointInShape (función geométrica pura)', () => {
  it('Elipse sin rotación: el centro acierta, la esquina de su AABB falla, el borde con tolerancia acierta', () => {
    const ellipse: Ellipse = {
      id: 'e1',
      type: 'ellipse',
      name: 'Elipse Test',
      x: 200,
      y: 200,
      radiusX: 50,
      radiusY: 30,
    };

    const aabb = getShapeAABB(ellipse);
    assert.equal(aabb.minX, 150);
    assert.equal(aabb.maxX, 250);
    assert.equal(aabb.minY, 170);
    assert.equal(aabb.maxY, 230);

    // 1. Centro acierta
    assert.equal(isPointInShape(200, 200, ellipse, 0), true, 'El centro debe acertar');

    // 2. Esquina de su recuadro (AABB) falla
    assert.equal(
      isPointInShape(150, 170, ellipse, 0),
      false,
      'La esquina del AABB no debe acertar en una elipse'
    );
    assert.equal(
      isPointInShape(250, 230, ellipse, 0),
      false,
      'La otra esquina del AABB tampoco debe acertar'
    );

    // 3. Borde exacto acierta
    assert.equal(isPointInShape(250, 200, ellipse, 0), true, 'Punto en el borde exacto debe acertar');

    // 4. Punto fuera del borde sin tolerancia falla
    assert.equal(isPointInShape(253, 200, ellipse, 0), false, 'Punto a 3px fuera sin tolerancia debe fallar');

    // 5. Borde con tolerancia acierta
    assert.equal(
      isPointInShape(253, 200, ellipse, 4),
      true,
      'Punto a 3px fuera con tolerancia de 4px debe acertar'
    );

    // 6. Punto fuera de la tolerancia falla
    assert.equal(
      isPointInShape(256, 200, ellipse, 4),
      false,
      'Punto a 6px fuera con tolerancia de 4px debe fallar'
    );
  });

  it('Rectángulo rotado 45°: punto dentro acierta, punto dentro de su AABB pero fuera de la figura falla', () => {
    const rectRot: Rectangle = {
      id: 'r-rot-45',
      type: 'rectangle',
      name: 'Rectángulo 45',
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      rotation: 45,
    };

    // Centro del rectángulo está en (150, 150)
    assert.equal(isPointInShape(150, 150, rectRot, 0), true, 'El centro del rectángulo rotado debe acertar');

    // Punto dentro de la figura real: (150, 110)
    assert.equal(
      isPointInShape(150, 110, rectRot, 0),
      true,
      'Punto interior de la figura rotada debe acertar'
    );

    // Esquina del AABB: el AABB en 45° abarca aproximadamente [79.29, 220.71] x [79.29, 220.71]
    const aabb = getShapeAABB(rectRot);
    assert.ok(aabb.minX < 85);
    assert.ok(aabb.maxX > 215);

    // El punto (100, 100) está holgadamente dentro del AABB
    assert.ok(100 > aabb.minX && 100 < aabb.maxX);
    assert.ok(100 > aabb.minY && 100 < aabb.maxY);

    // Pero (100, 100) está fuera de la figura real (distancia al centro es ~70.71px, mientras que el semi-lado es 50px)
    assert.equal(
      isPointInShape(100, 100, rectRot, 0),
      false,
      'Punto dentro del AABB pero fuera del rectángulo rotado debe fallar'
    );
  });

  it('Elipse rotada y con radios distintos (radiusX !== radiusY)', () => {
    const ellipseRot: Ellipse = {
      id: 'e-rot-distinct',
      type: 'ellipse',
      name: 'Elipse Rotada',
      x: 300,
      y: 300,
      radiusX: 100,
      radiusY: 40,
      rotation: 30,
    };

    // 1. Centro geométrico acierta
    assert.equal(isPointInShape(300, 300, ellipseRot, 0), true, 'Centro debe acertar');

    // 2. Punto a lo largo del eje mayor rotado (a 80 unidades del centro en dirección 30°)
    const rad = (30 * Math.PI) / 180;
    const ptMajorInsideX = 300 + 80 * Math.cos(rad);
    const ptMajorInsideY = 300 + 80 * Math.sin(rad);
    assert.equal(
      isPointInShape(ptMajorInsideX, ptMajorInsideY, ellipseRot, 0),
      true,
      'Punto sobre el eje mayor rotado interior debe acertar'
    );

    // 3. Punto a lo largo del eje menor pero más allá del radio menor (a 60 unidades en dirección perpendicular 120°)
    const radPerp = (120 * Math.PI) / 180;
    const ptMinorOutsideX = 300 + 60 * Math.cos(radPerp);
    const ptMinorOutsideY = 300 + 60 * Math.sin(radPerp);

    // Está dentro de su AABB
    const aabb = getShapeAABB(ellipseRot);
    assert.ok(ptMinorOutsideX >= aabb.minX && ptMinorOutsideX <= aabb.maxX);
    assert.ok(ptMinorOutsideY >= aabb.minY && ptMinorOutsideY <= aabb.maxY);

    // Pero debe fallar la detección exacta de la elipse
    assert.equal(
      isPointInShape(ptMinorOutsideX, ptMinorOutsideY, ellipseRot, 0),
      false,
      'Punto fuera del radio menor rotado debe fallar aunque esté en el AABB'
    );
  });

  it('Maneja elipses con radios cero sin dividir por cero', () => {
    const pointEllipse: Ellipse = {
      id: 'e-zero',
      type: 'ellipse',
      name: 'Elipse Cero',
      x: 50,
      y: 50,
      radiusX: 0,
      radiusY: 0,
    };

    assert.equal(isPointInShape(50, 50, pointEllipse, 0), true);
    assert.equal(isPointInShape(51, 50, pointEllipse, 0), false);
    assert.equal(isPointInShape(52, 50, pointEllipse, 3), true);

    const flatEllipse: Ellipse = {
      id: 'e-flat',
      type: 'ellipse',
      name: 'Elipse Plana',
      x: 100,
      y: 100,
      radiusX: 40,
      radiusY: 0,
    };

    assert.equal(isPointInShape(120, 100, flatEllipse, 0), true);
    assert.equal(isPointInShape(120, 102, flatEllipse, 0), false);
    assert.equal(isPointInShape(120, 102, flatEllipse, 3), true);
  });
});

describe('InputController.hitTest con detección exacta de figuras', () => {
  it('Elipse: centro acierta y esquina de su recuadro falla en hitTest', () => {
    const stateManager = new StateManager();
    const layerId = stateManager.getState().children[0].id;
    const ellipse: Ellipse = {
      id: 'ellipse-target',
      type: 'ellipse',
      name: 'Target Ellipse',
      x: 200,
      y: 200,
      radiusX: 60,
      radiusY: 40,
    };
    stateManager.addShape(layerId, ellipse);

    const canvas = createMockCanvas();
    const controller = new InputController(canvas, stateManager);

    // Clic en el centro
    const hitCenter = controller.hitTest(200, 200);
    assert.ok(hitCenter !== null);
    assert.equal(hitCenter!.id, 'ellipse-target');

    // Clic en la esquina del AABB (200 - 60, 200 - 40) = (140, 160)
    const hitCorner = controller.hitTest(140, 160);
    assert.equal(hitCorner, null, 'El clic en la esquina del recuadro de la elipse no debe seleccionarla');
  });

  it('Rectángulo rotado 45°: dentro acierta y esquina del AABB falla en hitTest', () => {
    const stateManager = new StateManager();
    const layerId = stateManager.getState().children[0].id;
    const rect: Rectangle = {
      id: 'rect-rot-target',
      type: 'rectangle',
      name: 'Target Rect',
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      rotation: 45,
    };
    stateManager.addShape(layerId, rect);

    const canvas = createMockCanvas();
    const controller = new InputController(canvas, stateManager);

    // Centro acierta
    const hitCenter = controller.hitTest(150, 150);
    assert.ok(hitCenter !== null);
    assert.equal(hitCenter!.id, 'rect-rot-target');

    // (100, 100) está dentro del AABB pero fuera del rombo rotado
    const hitCorner = controller.hitTest(100, 100);
    assert.equal(hitCorner, null, 'Punto dentro del AABB pero fuera de la figura rotada debe ser null');
  });

  it('Elipse rotada y con radios distintos (radiusX !== radiusY) en hitTest', () => {
    const stateManager = new StateManager();
    const layerId = stateManager.getState().children[0].id;
    const ellipse: Ellipse = {
      id: 'ellipse-rot-target',
      type: 'ellipse',
      name: 'Target Rotated Ellipse',
      x: 300,
      y: 300,
      radiusX: 100,
      radiusY: 40,
      rotation: 30,
    };
    stateManager.addShape(layerId, ellipse);

    const canvas = createMockCanvas();
    const controller = new InputController(canvas, stateManager);

    // Centro acierta
    const hitCenter = controller.hitTest(300, 300);
    assert.ok(hitCenter !== null);
    assert.equal(hitCenter!.id, 'ellipse-rot-target');

    // Punto interior a lo largo del eje mayor rotado
    const rad = (30 * Math.PI) / 180;
    const ptInsideX = 300 + 80 * Math.cos(rad);
    const ptInsideY = 300 + 80 * Math.sin(rad);
    const hitMajor = controller.hitTest(ptInsideX, ptInsideY);
    assert.ok(hitMajor !== null);
    assert.equal(hitMajor!.id, 'ellipse-rot-target');

    // Punto dentro del AABB pero fuera del radio menor rotado
    const radPerp = (120 * Math.PI) / 180;
    const ptOutsideX = 300 + 60 * Math.cos(radPerp);
    const ptOutsideY = 300 + 60 * Math.sin(radPerp);
    const hitOutside = controller.hitTest(ptOutsideX, ptOutsideY);
    assert.equal(hitOutside, null, 'Punto fuera de la elipse rotada debe ser null en hitTest');
  });

  it('La tolerancia se mantiene constante en pantalla con zoom 0.5, 1 y 8', () => {
    const stateManager = new StateManager();
    const layerId = stateManager.getState().children[0].id;
    const rect: Rectangle = {
      id: 'rect-zoom',
      type: 'rectangle',
      name: 'Zoom Rect',
      x: 100,
      y: 100,
      width: 100,
      height: 100,
    };
    stateManager.addShape(layerId, rect);
    const canvas = createMockCanvas();

    // 1. Zoom = 0.5: tolerancia de 4px en pantalla equivale a 8 unidades de documento
    {
      const viewportManager = new ViewportManager({ zoom: 0.5, panX: 0, panY: 0 });
      const controller = new InputController(canvas, stateManager, undefined, { viewportManager });

      // 7 unidades mundo fuera = 3.5px pantalla (dentro de los 4px) -> acierta
      const hit = controller.hitTest(207, 150);
      assert.ok(hit !== null, 'Zoom 0.5: a 7 unidades del mundo debe acertar');

      // 9 unidades mundo fuera = 4.5px pantalla (fuera de los 4px) -> falla
      const miss = controller.hitTest(209, 150);
      assert.equal(miss, null, 'Zoom 0.5: a 9 unidades del mundo debe fallar');
    }

    // 2. Zoom = 1: tolerancia de 4px en pantalla equivale a 4 unidades de documento
    {
      const viewportManager = new ViewportManager({ zoom: 1, panX: 0, panY: 0 });
      const controller = new InputController(canvas, stateManager, undefined, { viewportManager });

      // 3.5 unidades mundo fuera = 3.5px pantalla -> acierta
      const hit = controller.hitTest(203.5, 150);
      assert.ok(hit !== null, 'Zoom 1: a 3.5 unidades del mundo debe acertar');

      // 4.5 unidades mundo fuera = 4.5px pantalla -> falla
      const miss = controller.hitTest(204.5, 150);
      assert.equal(miss, null, 'Zoom 1: a 4.5 unidades del mundo debe fallar');
    }

    // 3. Zoom = 8: tolerancia de 4px en pantalla equivale a 0.5 unidades de documento
    {
      const viewportManager = new ViewportManager({ zoom: 8, panX: 0, panY: 0 });
      const controller = new InputController(canvas, stateManager, undefined, { viewportManager });

      // 0.4 unidades mundo fuera = 3.2px pantalla -> acierta
      const hit = controller.hitTest(200.4, 150);
      assert.ok(hit !== null, 'Zoom 8: a 0.4 unidades del mundo debe acertar');

      // 0.6 unidades mundo fuera = 4.8px pantalla -> falla
      const miss = controller.hitTest(200.6, 150);
      assert.equal(miss, null, 'Zoom 8: a 0.6 unidades del mundo debe fallar');
    }
  });

  it('Con dos figuras superpuestas se elige la de arriba', () => {
    const stateManager = new StateManager();
    const layerId = stateManager.getState().children[0].id;

    const bottomRect: Rectangle = {
      id: 'shape-bottom',
      type: 'rectangle',
      name: 'Fondo',
      x: 100,
      y: 100,
      width: 200,
      height: 200,
    };
    const topEllipse: Ellipse = {
      id: 'shape-top',
      type: 'ellipse',
      name: 'Frente',
      x: 200,
      y: 200,
      radiusX: 60,
      radiusY: 60,
    };

    stateManager.addShape(layerId, bottomRect);
    stateManager.addShape(layerId, topEllipse);

    const canvas = createMockCanvas();
    const controller = new InputController(canvas, stateManager);

    // En (200, 200), ambas figuras colisionan. La elipse está encima en la capa.
    const hit = controller.hitTest(200, 200);
    assert.ok(hit !== null);
    assert.equal(hit!.id, 'shape-top', 'Debe elegir la figura de arriba (topEllipse)');

    // En (110, 110), solo está el rectángulo de fondo (la elipse no llega ahí)
    const hitOnlyBottom = controller.hitTest(110, 110);
    assert.ok(hitOnlyBottom !== null);
    assert.equal(hitOnlyBottom!.id, 'shape-bottom', 'Debe elegir shape-bottom donde la de arriba no colisiona');
  });

  it('Salta figuras ocultas o bloqueadas al hacer hit-testing', () => {
    const stateManager = new StateManager();
    const layerId = stateManager.getState().children[0].id;

    const visibleBottom: Rectangle = {
      id: 'visible-bottom',
      type: 'rectangle',
      name: 'Fondo Visible',
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      visible: true,
      locked: false,
    };
    const hiddenTop: Rectangle = {
      id: 'hidden-top',
      type: 'rectangle',
      name: 'Superior Oculta',
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      visible: false,
      locked: false,
    };

    stateManager.addShape(layerId, visibleBottom);
    stateManager.addShape(layerId, hiddenTop);

    const canvas = createMockCanvas();
    const controller = new InputController(canvas, stateManager);

    const hitHidden = controller.hitTest(150, 150);
    assert.ok(hitHidden !== null);
    assert.equal(hitHidden!.id, 'visible-bottom', 'Debe saltar la figura oculta superior');

    // Ahora bloqueamos la figura superior visible
    stateManager.updateShape(hiddenTop.id, { visible: true, locked: true });
    const hitLocked = controller.hitTest(150, 150);
    assert.ok(hitLocked !== null);
    assert.equal(hitLocked!.id, 'visible-bottom', 'Debe saltar la figura bloqueada superior');
  });

  it('getSelectionHandles y hover del cursor funcionan coherentemente con la detección exacta', () => {
    const stateManager = new StateManager();
    const layerId = stateManager.getState().children[0].id;

    const ellipse: Ellipse = {
      id: 'hover-ellipse',
      type: 'ellipse',
      name: 'Elipse Hover',
      x: 200,
      y: 200,
      radiusX: 60,
      radiusY: 40,
    };
    stateManager.addShape(layerId, ellipse);

    const canvas = createMockCanvas();
    const controller = new InputController(canvas, stateManager);

    // 1. Hover sobre zona vacía (esquina del AABB de la elipse): cursor 'default'
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 140, clientY: 160 } as MouseEvent);
    assert.equal(canvas.style.cursor, 'default', 'Esquina vacía de la elipse debe mantener cursor default');

    // 2. Hover sobre la figura real (centro): cursor 'pointer'
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 200, clientY: 200 } as MouseEvent);
    assert.equal(canvas.style.cursor, 'pointer', 'Sobrevolar figura real debe poner cursor pointer');

    // 3. Seleccionar la elipse: getSelectionHandles devuelve 5 manejadores válidos
    stateManager.selectNode(ellipse.id);
    const selected = stateManager.getSelectedNode()!;
    const handles = getSelectionHandles(selected, 8, 30);
    assert.equal(handles.length, 5);
    assert.equal(handles[4].type, 'rotation-handle');

    // 4. Hover sobre el manejador de rotación: cursor 'crosshair'
    const rotHandle = handles[4];
    const rotCenterX = (rotHandle.minX + rotHandle.maxX) / 2;
    const rotCenterY = (rotHandle.minY + rotHandle.maxY) / 2;
    canvas.dispatchSimulatedEvent('mousemove', { clientX: rotCenterX, clientY: rotCenterY } as MouseEvent);
    assert.equal(canvas.style.cursor, 'crosshair', 'Sobrevolar el tirador de rotación debe poner cursor crosshair');

    controller.destroy();
  });
});
