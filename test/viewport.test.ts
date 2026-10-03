import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  type Viewport,
  MIN_ZOOM,
  MAX_ZOOM,
  DEFAULT_VIEWPORT,
  screenToWorld,
  worldToScreen,
  zoomAt,
  panBy,
  fitToBounds,
  resetZoom,
  ViewportManager,
} from '../src/utils/viewport.ts';
import type { Vector2D, AABB } from '../src/types/scene-graph.ts';

function assertCloseTo(actual: number, expected: number, epsilon: number = 1e-6, message?: string) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${message ? message + ': ' : ''}Esperado ${actual} cercano a ${expected} (diferencia: ${Math.abs(actual - expected)})`
  );
}

describe('Modelo de Vista (Viewport, Zoom y Pan)', () => {
  it('DEFAULT_VIEWPORT define un estado inicial inmutable (zoom 1:1, pan 0,0)', () => {
    assert.equal(DEFAULT_VIEWPORT.zoom, 1);
    assert.equal(DEFAULT_VIEWPORT.panX, 0);
    assert.equal(DEFAULT_VIEWPORT.panY, 0);
    assert.equal(Object.isFrozen(DEFAULT_VIEWPORT), true);
  });

  describe('screenToWorld y worldToScreen', () => {
    it('proyecta 1:1 con viewport por defecto', () => {
      const pt: Vector2D = { x: 120, y: 340 };
      const world = screenToWorld(DEFAULT_VIEWPORT, pt);
      assert.equal(world.x, 120);
      assert.equal(world.y, 340);

      const screen = worldToScreen(DEFAULT_VIEWPORT, world);
      assert.equal(screen.x, 120);
      assert.equal(screen.y, 340);
    });

    it('aplica correctamente la escala de zoom y el desplazamiento pan', () => {
      const vp: Viewport = { zoom: 2, panX: 100, panY: 50 };

      // mundo -> pantalla: pantalla = mundo * 2 + pan
      const worldPt: Vector2D = { x: 40, y: 30 };
      const screenPt = worldToScreen(vp, worldPt);
      assert.equal(screenPt.x, 40 * 2 + 100); // 180
      assert.equal(screenPt.y, 30 * 2 + 50);  // 110

      // pantalla -> mundo: mundo = (pantalla - pan) / 2
      const roundtripWorld = screenToWorld(vp, screenPt);
      assert.equal(roundtripWorld.x, 40);
      assert.equal(roundtripWorld.y, 30);
    });

    it('cumple la propiedad de reversibilidad (ida y vuelta) con diversos zooms y desplazamientos', () => {
      const testCases: Viewport[] = [
        { zoom: 0.1, panX: -500, panY: -300 },
        { zoom: 0.5, panX: 200, panY: -150 },
        { zoom: 1, panX: 0, panY: 0 },
        { zoom: 2.75, panX: 1250, panY: 740 },
        { zoom: 10, panX: -2400, panY: 1800 },
        { zoom: 32, panX: 5000, panY: -3000 },
      ];

      const testPoints: Vector2D[] = [
        { x: 0, y: 0 },
        { x: 100, y: 250 },
        { x: -450.75, y: 890.33 },
        { x: 1920, y: 1080 },
        { x: -5000, y: -2500 },
      ];

      for (const vp of testCases) {
        for (const pt of testPoints) {
          // screen -> world -> screen
          const world = screenToWorld(vp, pt);
          const screenBack = worldToScreen(vp, world);
          assertCloseTo(screenBack.x, pt.x, 1e-6, 'screenToWorld -> worldToScreen (X)');
          assertCloseTo(screenBack.y, pt.y, 1e-6, 'screenToWorld -> worldToScreen (Y)');

          // world -> screen -> world
          const screen = worldToScreen(vp, pt);
          const worldBack = screenToWorld(vp, screen);
          assertCloseTo(worldBack.x, pt.x, 1e-6, 'worldToScreen -> screenToWorld (X)');
          assertCloseTo(worldBack.y, pt.y, 1e-6, 'worldToScreen -> screenToWorld (Y)');
        }
      }
    });
  });

  describe('zoomAt', () => {
    it('mantiene fijo el punto del mundo que está exactamente bajo el cursor', () => {
      const initialVp: Viewport = { zoom: 1, panX: 50, panY: 100 };
      const cursorScreen: Vector2D = { x: 300, y: 250 };

      // Punto del mundo antes del zoom
      const worldPointBefore = screenToWorld(initialVp, cursorScreen);

      // Aplicar zoom in (factor 2)
      const zoomedVp = zoomAt(initialVp, cursorScreen, 2);
      assert.equal(zoomedVp.zoom, 2);
      assert.equal(Object.isFrozen(zoomedVp), true);

      // El mismo punto del mundo debe seguir proyectándose exactamente en la coordenada del cursor
      const screenPointAfter = worldToScreen(zoomedVp, worldPointBefore);
      assertCloseTo(screenPointAfter.x, cursorScreen.x, 1e-6);
      assertCloseTo(screenPointAfter.y, cursorScreen.y, 1e-6);

      // Y a la inversa, el cursor en pantalla debe apuntar al mismo punto del mundo
      const worldPointAfter = screenToWorld(zoomedVp, cursorScreen);
      assertCloseTo(worldPointAfter.x, worldPointBefore.x, 1e-6);
      assertCloseTo(worldPointAfter.y, worldPointBefore.y, 1e-6);
    });

    it('funciona correctamente al alejar (zoom out con factor < 1)', () => {
      const initialVp: Viewport = { zoom: 4, panX: -200, panY: -150 };
      const cursorScreen: Vector2D = { x: 500, y: 350 };

      const worldPointBefore = screenToWorld(initialVp, cursorScreen);

      const zoomedOutVp = zoomAt(initialVp, cursorScreen, 0.5);
      assert.equal(zoomedOutVp.zoom, 2);

      const screenPointAfter = worldToScreen(zoomedOutVp, worldPointBefore);
      assertCloseTo(screenPointAfter.x, cursorScreen.x, 1e-6);
      assertCloseTo(screenPointAfter.y, cursorScreen.y, 1e-6);
    });

    it('respeta el límite máximo (MAX_ZOOM = 32) y mantiene el punto fijo al topar con el límite', () => {
      const vp: Viewport = { zoom: 20, panX: -100, panY: 50 };
      const cursorScreen: Vector2D = { x: 400, y: 300 };
      const worldPointBefore = screenToWorld(vp, cursorScreen);

      // Intentar multiplicar por 5 (daría 100, pero debe quedar en 32)
      const clampedVp = zoomAt(vp, cursorScreen, 5);
      assert.equal(clampedVp.zoom, MAX_ZOOM);

      // El punto del mundo debe seguir anclado al cursor
      const screenAfter = worldToScreen(clampedVp, worldPointBefore);
      assertCloseTo(screenAfter.x, cursorScreen.x, 1e-6);
      assertCloseTo(screenAfter.y, cursorScreen.y, 1e-6);
    });

    it('respeta el límite mínimo (MIN_ZOOM = 0.1) y mantiene el punto fijo al topar con el límite', () => {
      const vp: Viewport = { zoom: 0.2, panX: 200, panY: 100 };
      const cursorScreen: Vector2D = { x: 250, y: 180 };
      const worldPointBefore = screenToWorld(vp, cursorScreen);

      // Intentar reducir con factor 0.01 (daría 0.002, pero debe quedar en 0.1)
      const clampedVp = zoomAt(vp, cursorScreen, 0.01);
      assert.equal(clampedVp.zoom, MIN_ZOOM);

      // El punto del mundo debe seguir anclado al cursor
      const screenAfter = worldToScreen(clampedVp, worldPointBefore);
      assertCloseTo(screenAfter.x, cursorScreen.x, 1e-6);
      assertCloseTo(screenAfter.y, cursorScreen.y, 1e-6);
    });

    it('ignora factores no positivos o no numéricos', () => {
      const vp: Viewport = { zoom: 1.5, panX: 10, panY: 20 };
      const pt: Vector2D = { x: 100, y: 100 };

      assert.deepEqual(zoomAt(vp, pt, 0), vp);
      assert.deepEqual(zoomAt(vp, pt, -2), vp);
      assert.deepEqual(zoomAt(vp, pt, NaN), vp);
      assert.deepEqual(zoomAt(vp, pt, Infinity), vp);
    });
  });

  describe('panBy', () => {
    it('desplaza panX y panY por el delta especificado manteniendo el zoom', () => {
      const vp: Viewport = { zoom: 2.5, panX: 100, panY: -50 };
      const moved = panBy(vp, 40, 60);

      assert.equal(moved.zoom, 2.5);
      assert.equal(moved.panX, 140);
      assert.equal(moved.panY, 10);
      assert.equal(Object.isFrozen(moved), true);
    });
  });

  describe('resetZoom', () => {
    it('restablece zoom a 1 manteniendo fijo el centro de pantalla indicado', () => {
      const vp: Viewport = { zoom: 3, panX: -200, panY: -100 };
      const screenCenter: Vector2D = { x: 400, y: 300 };

      const worldPointBefore = screenToWorld(vp, screenCenter);
      const resetVp = resetZoom(vp, screenCenter);

      assert.equal(resetVp.zoom, 1);
      assert.equal(Object.isFrozen(resetVp), true);

      // El punto del mundo debe coincidir exactamente con screenCenter
      const screenAfter = worldToScreen(resetVp, worldPointBefore);
      assertCloseTo(screenAfter.x, screenCenter.x, 1e-6);
      assertCloseTo(screenAfter.y, screenCenter.y, 1e-6);
    });
  });

  describe('fitToBounds', () => {
    const canvasSize = { width: 800, height: 600 };

    it('encaja una caja ancha respetando el margen y centrándola verticalmente', () => {
      // Caja de 1000 x 200 en el mundo (ancho dominante)
      const box: AABB = {
        minX: 100,
        minY: 100,
        maxX: 1100,
        maxY: 300,
        width: 1000,
        height: 200,
      };
      const margin = 50;

      const fitted = fitToBounds(canvasSize, box, margin);

      // Espacio disponible en X = 800 - 2 * 50 = 700; zoom = 700 / 1000 = 0.7
      assertCloseTo(fitted.zoom, 0.7);

      // Las esquinas del mundo deben proyectarse simétricamente respecto a los márgenes
      const leftScreen = worldToScreen(fitted, { x: box.minX, y: 0 });
      const rightScreen = worldToScreen(fitted, { x: box.maxX, y: 0 });
      assertCloseTo(leftScreen.x, 50);
      assertCloseTo(rightScreen.x, 750);

      // El centro de la caja debe coincidir con el centro del canvas (400, 300)
      const boxCenter = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
      const centerScreen = worldToScreen(fitted, boxCenter);
      assertCloseTo(centerScreen.x, 400);
      assertCloseTo(centerScreen.y, 300);
    });

    it('encaja una caja alta respetando el margen y centrándola horizontalmente', () => {
      // Caja de 200 x 1000 en el mundo (alto dominante)
      const box: AABB = {
        minX: 50,
        minY: 50,
        maxX: 250,
        maxY: 1050,
        width: 200,
        height: 1000,
      };
      const margin = 50;

      const fitted = fitToBounds(canvasSize, box, margin);

      // Espacio disponible en Y = 600 - 2 * 50 = 500; zoom = 500 / 1000 = 0.5
      assertCloseTo(fitted.zoom, 0.5);

      const topScreen = worldToScreen(fitted, { x: 0, y: box.minY });
      const bottomScreen = worldToScreen(fitted, { x: 0, y: box.maxY });
      assertCloseTo(topScreen.y, 50);
      assertCloseTo(bottomScreen.y, 550);

      const boxCenter = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
      const centerScreen = worldToScreen(fitted, boxCenter);
      assertCloseTo(centerScreen.x, 400);
      assertCloseTo(centerScreen.y, 300);
    });

    it('encaja una caja mayor que el canvas reduciendo el zoom', () => {
      // Caja de 2400 x 1800 (3x mayor que el canvas)
      const box: AABB = {
        minX: 0,
        minY: 0,
        maxX: 2400,
        maxY: 1800,
        width: 2400,
        height: 1800,
      };

      const fitted = fitToBounds(canvasSize, box, 0);

      // zoom = min(800/2400, 600/1800) = 1/3
      assertCloseTo(fitted.zoom, 1 / 3);

      const boxCenter = { x: 1200, y: 900 };
      const centerScreen = worldToScreen(fitted, boxCenter);
      assertCloseTo(centerScreen.x, 400);
      assertCloseTo(centerScreen.y, 300);
    });

    it('devuelve estado por defecto (zoom 1, centrado) si la caja es nula, indefinida o vacía', () => {
      const expectedCentered = {
        zoom: 1,
        panX: 400,
        panY: 300,
      };

      // Caja nula
      assert.deepEqual(fitToBounds(canvasSize, null), expectedCentered);
      assert.deepEqual(fitToBounds(canvasSize, undefined), expectedCentered);

      // Caja con ancho o alto cero
      const emptyBox1: AABB = { minX: 10, minY: 10, maxX: 10, maxY: 10, width: 0, height: 0 };
      assert.deepEqual(fitToBounds(canvasSize, emptyBox1), expectedCentered);

      // Caja con dimensiones negativas
      const emptyBox2: AABB = { minX: 50, minY: 50, maxX: 40, maxY: 40, width: -10, height: -10 };
      assert.deepEqual(fitToBounds(canvasSize, emptyBox2), expectedCentered);
    });
  });

  describe('ViewportManager', () => {
    it('inicializa con DEFAULT_VIEWPORT o un viewport provisto', () => {
      const managerDefault = new ViewportManager();
      assert.deepEqual(managerDefault.getViewport(), DEFAULT_VIEWPORT);
      assert.deepEqual(managerDefault.viewport, DEFAULT_VIEWPORT);

      const custom: Viewport = { zoom: 2, panX: 15, panY: 25 };
      const managerCustom = new ViewportManager(custom);
      assert.equal(managerCustom.viewport.zoom, 2);
      assert.equal(managerCustom.viewport.panX, 15);
      assert.equal(managerCustom.viewport.panY, 25);
    });

    it('setViewport actualiza el estado, clampa el zoom y notifica a los suscriptores', () => {
      const manager = new ViewportManager();
      const notifications: Viewport[] = [];

      const unsubscribe = manager.subscribe((vp) => {
        notifications.push({ ...vp });
      });

      manager.setViewport({ zoom: 3, panX: 100, panY: -50 });
      assert.equal(notifications.length, 1);
      assert.equal(notifications[0].zoom, 3);
      assert.equal(notifications[0].panX, 100);
      assert.equal(notifications[0].panY, -50);

      // No notifica si el viewport asignado es idéntico
      manager.setViewport({ zoom: 3, panX: 100, panY: -50 });
      assert.equal(notifications.length, 1);

      // Clampa zoom que exceda límites
      manager.setViewport({ zoom: 100, panX: 0, panY: 0 });
      assert.equal(notifications.length, 2);
      assert.equal(notifications[1].zoom, MAX_ZOOM);

      // Desuscribirse detiene notificaciones
      unsubscribe();
      manager.setViewport({ zoom: 1, panX: 0, panY: 0 });
      assert.equal(notifications.length, 2);
    });

    it('los métodos helper (zoomAt, panBy, fitToBounds, resetZoom) actualizan el viewport y notifican', () => {
      const manager = new ViewportManager();
      let callCount = 0;
      manager.subscribe(() => {
        callCount++;
      });

      manager.panBy(30, 40);
      assert.equal(callCount, 1);
      assert.equal(manager.viewport.panX, 30);
      assert.equal(manager.viewport.panY, 40);

      manager.zoomAt({ x: 100, y: 100 }, 2);
      assert.equal(callCount, 2);
      assert.equal(manager.viewport.zoom, 2);

      manager.resetZoom({ x: 200, y: 200 });
      assert.equal(callCount, 3);
      assert.equal(manager.viewport.zoom, 1);

      manager.fitToBounds({ width: 800, height: 600 }, null);
      assert.equal(callCount, 4);
      assert.equal(manager.viewport.zoom, 1);
      assert.equal(manager.viewport.panX, 400);
      assert.equal(manager.viewport.panY, 300);
    });

    it('screenToWorld y worldToScreen delegan en el viewport activo del manager', () => {
      const manager = new ViewportManager({ zoom: 2, panX: 50, panY: 50 });
      const world = manager.screenToWorld({ x: 150, y: 250 });
      assert.equal(world.x, 50);
      assert.equal(world.y, 100);

      const screen = manager.worldToScreen({ x: 50, y: 100 });
      assert.equal(screen.x, 150);
      assert.equal(screen.y, 250);
    });
  });
});
