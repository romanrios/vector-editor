import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { AddGuideCommand } from '../src/commands/AddGuideCommand.ts';
import { RemoveGuideCommand } from '../src/commands/RemoveGuideCommand.ts';
import { MoveGuideCommand } from '../src/commands/MoveGuideCommand.ts';
import { ClearGuidesCommand } from '../src/commands/ClearGuidesCommand.ts';
import { Serializer } from '../src/state/Serializer.ts';
import { ViewportManager } from '../src/utils/viewport.ts';
import { InputController } from '../src/input/InputController.ts';
import { getNiceRulerStep, getRulerSubdivisions, setupRulersController } from '../src/ui/RulersController.ts';
import type { Document, Guide, Rectangle } from '../src/types/scene-graph.ts';

function createBaseDocument(): Document {
  return {
    id: 'doc-test',
    type: 'document',
    name: 'Doc Test',
    width: 800,
    height: 600,
    children: [
      {
        id: 'layer-1',
        type: 'layer',
        name: 'Layer 1',
        visible: true,
        locked: false,
        children: [
          {
            type: 'rectangle',
            id: 'rect-1',
            name: 'Rect 1',
            x: 50,
            y: 50,
            width: 100,
            height: 100,
            rotation: 0,
            fill: '#ff0000',
            stroke: 'none',
            strokeWidth: 0,
            visible: true,
            locked: false,
            opacity: 1,
            zIndex: 0,
          } as Rectangle,
        ],
      },
    ],
    guides: [],
  };
}

function createMockCanvas(): HTMLCanvasElement & { dispatchSimulatedEvent: (type: string, e: unknown) => void } {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};

  return {
    width: 800,
    height: 600,
    style: { cursor: 'default' },
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
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
  } as unknown as HTMLCanvasElement & { dispatchSimulatedEvent: (type: string, e: unknown) => void };
}

describe('Reglas graduadas y Guías de usuario (Rulers & Guides)', () => {
  describe('Matemática de graduación de reglas (getNiceRulerStep y getRulerSubdivisions)', () => {
    it('calcula pasos limpios de escala adaptados a diferentes niveles de zoom', () => {
      // Para distancia objetivo ~100 (zoom 1.0)
      const step100 = getNiceRulerStep(100);
      assert.strictEqual(step100, 100);

      // Para zoom alejado (distancia objetivo 450)
      const step500 = getNiceRulerStep(450);
      assert.strictEqual(step500, 500);

      // Para zoom cercano (distancia objetivo 18)
      const step20 = getNiceRulerStep(18);
      assert.strictEqual(step20, 20);

      // Para zoom muy cercano (distancia objetivo 1.2)
      const step1 = getNiceRulerStep(1.2);
      assert.strictEqual(step1, 1);

      // Para valores límite <= 0 retorna 100 por seguridad
      assert.strictEqual(getNiceRulerStep(0), 100);
      assert.strictEqual(getNiceRulerStep(-50), 100);
    });

    it('calcula subdivisiones coherentes según la primera cifra del paso', () => {
      // Pasos tipo 1 (1, 10, 100) -> 10 subdivisiones
      assert.strictEqual(getRulerSubdivisions(1), 10);
      assert.strictEqual(getRulerSubdivisions(10), 10);
      assert.strictEqual(getRulerSubdivisions(100), 10);

      // Pasos tipo 2 (2, 20, 200) -> 4 subdivisiones (cuartos: 0.25, 0.5, 0.75)
      assert.strictEqual(getRulerSubdivisions(2), 4);
      assert.strictEqual(getRulerSubdivisions(20), 4);
      assert.strictEqual(getRulerSubdivisions(200), 4);

      // Pasos tipo 5 (5, 50, 500) -> 5 subdivisiones
      assert.strictEqual(getRulerSubdivisions(5), 5);
      assert.strictEqual(getRulerSubdivisions(50), 5);
      assert.strictEqual(getRulerSubdivisions(500), 5);
    });
  });

  describe('Gestión de Estado inmutable en StateManager', () => {
    it('obtiene guías vacías inicialmente si no están definidas', () => {
      const commandManager = new CommandManager();
      const stateManager = new StateManager(createBaseDocument(), commandManager);
      assert.deepEqual(stateManager.getGuides(), []);
    });

    it('añade una guía de forma inmutable y congela la colección', () => {
      const commandManager = new CommandManager();
      const stateManager = new StateManager(createBaseDocument(), commandManager);

      const guide1: Guide = { id: 'guide-x-1', axis: 'x', position: 150 };
      stateManager.addGuide(guide1);

      const guides = stateManager.getGuides();
      assert.strictEqual(guides.length, 1);
      assert.deepEqual(guides[0], guide1);
      assert.ok(Object.isFrozen(guides));
      assert.ok(Object.isFrozen(stateManager.getState().guides));
    });

    it('actualiza la posición de una guía existente inmutablemente', () => {
      const commandManager = new CommandManager();
      const stateManager = new StateManager(createBaseDocument(), commandManager);

      stateManager.addGuide({ id: 'guide-y-1', axis: 'y', position: 200 });
      stateManager.updateGuide('guide-y-1', 250);

      const guides = stateManager.getGuides();
      assert.strictEqual(guides.length, 1);
      assert.strictEqual(guides[0].position, 250);
      assert.strictEqual(guides[0].axis, 'y');
    });

    it('elimina una guía por su identificador inmutablemente', () => {
      const commandManager = new CommandManager();
      const stateManager = new StateManager(createBaseDocument(), commandManager);

      stateManager.addGuide({ id: 'guide-1', axis: 'x', position: 100 });
      stateManager.addGuide({ id: 'guide-2', axis: 'y', position: 300 });

      assert.strictEqual(stateManager.getGuides().length, 2);
      stateManager.removeGuide('guide-1');

      const remaining = stateManager.getGuides();
      assert.strictEqual(remaining.length, 1);
      assert.strictEqual(remaining[0].id, 'guide-2');
    });

    it('limpia todas las guías inmutablemente', () => {
      const commandManager = new CommandManager();
      const stateManager = new StateManager(createBaseDocument(), commandManager);

      stateManager.addGuide({ id: 'g1', axis: 'x', position: 50 });
      stateManager.addGuide({ id: 'g2', axis: 'y', position: 80 });
      assert.strictEqual(stateManager.getGuides().length, 2);

      stateManager.clearGuides();
      assert.strictEqual(stateManager.getGuides().length, 0);
    });

    it('gestiona las banderas de visibilidad, bloqueo y ajuste magnético', () => {
      const commandManager = new CommandManager();
      const stateManager = new StateManager(createBaseDocument(), commandManager);

      // Valores predeterminados
      assert.strictEqual(stateManager.isRulersVisible(), true);
      assert.strictEqual(stateManager.isGuidesVisible(), true);
      assert.strictEqual(stateManager.isGuidesLocked(), false);
      assert.strictEqual(stateManager.isGuideSnappingEnabled(), true);

      // Toggles y setters
      stateManager.setRulersVisible(false);
      assert.strictEqual(stateManager.isRulersVisible(), false);

      stateManager.setGuidesVisible(false);
      assert.strictEqual(stateManager.isGuidesVisible(), false);

      stateManager.setGuidesLocked(true);
      assert.strictEqual(stateManager.isGuidesLocked(), true);

      stateManager.setGuideSnappingEnabled(false);
      assert.strictEqual(stateManager.isGuideSnappingEnabled(), false);
    });
  });

  describe('Historial Undo/Redo con Comandos de Guías', () => {
    it('AddGuideCommand: añade y revierte con Deshacer/Rehacer', () => {
      const commandManager = new CommandManager();
      const stateManager = new StateManager(createBaseDocument(), commandManager);
      const guide: Guide = { id: 'g-undo-1', axis: 'x', position: 220 };

      const cmd = new AddGuideCommand(stateManager, guide);
      commandManager.executeCommand(cmd);

      assert.strictEqual(stateManager.getGuides().length, 1);
      assert.strictEqual(stateManager.getGuides()[0].position, 220);

      commandManager.undo();
      assert.strictEqual(stateManager.getGuides().length, 0);

      commandManager.redo();
      assert.strictEqual(stateManager.getGuides().length, 1);
      assert.strictEqual(stateManager.getGuides()[0].id, 'g-undo-1');
    });

    it('RemoveGuideCommand: elimina y restaura con Deshacer/Rehacer', () => {
      const commandManager = new CommandManager();
      const stateManager = new StateManager(createBaseDocument(), commandManager);
      const guide: Guide = { id: 'g-rem-1', axis: 'y', position: 400 };

      stateManager.addGuide(guide);
      assert.strictEqual(stateManager.getGuides().length, 1);

      const cmd = new RemoveGuideCommand(stateManager, guide);
      commandManager.executeCommand(cmd);

      assert.strictEqual(stateManager.getGuides().length, 0);

      commandManager.undo();
      assert.strictEqual(stateManager.getGuides().length, 1);
      assert.strictEqual(stateManager.getGuides()[0].id, 'g-rem-1');

      commandManager.redo();
      assert.strictEqual(stateManager.getGuides().length, 0);
    });

    it('MoveGuideCommand: mueve y restaura posición con Deshacer/Rehacer', () => {
      const commandManager = new CommandManager();
      const stateManager = new StateManager(createBaseDocument(), commandManager);
      const guide: Guide = { id: 'g-mov-1', axis: 'x', position: 100 };

      stateManager.addGuide(guide);

      const cmd = new MoveGuideCommand(stateManager, 'g-mov-1', 100, 350);
      commandManager.executeCommand(cmd);

      assert.strictEqual(stateManager.getGuides()[0].position, 350);

      commandManager.undo();
      assert.strictEqual(stateManager.getGuides()[0].position, 100);

      commandManager.redo();
      assert.strictEqual(stateManager.getGuides()[0].position, 350);
    });

    it('ClearGuidesCommand: borra todas y restaura el lote con Deshacer/Rehacer', () => {
      const commandManager = new CommandManager();
      const stateManager = new StateManager(createBaseDocument(), commandManager);
      const g1: Guide = { id: 'g1', axis: 'x', position: 100 };
      const g2: Guide = { id: 'g2', axis: 'y', position: 200 };

      stateManager.addGuide(g1);
      stateManager.addGuide(g2);
      assert.strictEqual(stateManager.getGuides().length, 2);

      const cmd = new ClearGuidesCommand(stateManager, stateManager.getGuides());
      commandManager.executeCommand(cmd);

      assert.strictEqual(stateManager.getGuides().length, 0);

      commandManager.undo();
      assert.strictEqual(stateManager.getGuides().length, 2);
      assert.strictEqual(stateManager.getGuides()[0].id, 'g1');
      assert.strictEqual(stateManager.getGuides()[1].id, 'g2');

      commandManager.redo();
      assert.strictEqual(stateManager.getGuides().length, 0);
    });
  });

  describe('Ajuste Magnético (Snapping) a Guías de Usuario', () => {
    it('acopla una figura en movimiento a una guía vertical y genera indicador de guía', () => {
      const commandManager = new CommandManager();
      const stateManager = new StateManager(createBaseDocument(), commandManager);
      const canvas = createMockCanvas();
      const inputController = new InputController(canvas, stateManager, commandManager);

      // Añadir guía vertical en x = 200
      stateManager.addGuide({ id: 'gv-200', axis: 'x', position: 200 });

      // Seleccionar rectángulo en x: 50, y: 50, width: 100
      stateManager.setSelection(['rect-1']);

      // Arrastrar el rectángulo para mover su borde derecho (50+100 = 150) cerca de 200 (delta dx = 48 -> borde derecho en 198)
      canvas.dispatchSimulatedEvent('mousedown', {
        clientX: 70,
        clientY: 70,
        button: 0,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
      });

      canvas.dispatchSimulatedEvent('mousemove', {
        clientX: 118, // dx = 48 px en pantalla (zoom 1.0)
        clientY: 70,
        button: 0,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
      });

      // El ajuste magnético debe haber atraído el borde a x = 200 (dx real = 50 en lugar de 48)
      const guides = inputController.activeGuides;
      assert.ok(guides.length > 0, 'Debe haber guías activas de ajuste');
      assert.ok(guides.some((g) => g.axis === 'x' && Math.abs(g.position - 200) < 1e-4));
    });

    it('no realiza ajuste a guías cuando el snapping de guías está desactivado', () => {
      const commandManager = new CommandManager();
      const stateManager = new StateManager(createBaseDocument(), commandManager);
      const canvas = createMockCanvas();
      const inputController = new InputController(canvas, stateManager, commandManager);

      stateManager.addGuide({ id: 'gv-200', axis: 'x', position: 200 });
      stateManager.setGuideSnappingEnabled(false);
      stateManager.setSelection(['rect-1']);

      canvas.dispatchSimulatedEvent('mousedown', {
        clientX: 70,
        clientY: 70,
        button: 0,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
      });

      canvas.dispatchSimulatedEvent('mousemove', {
        clientX: 118,
        clientY: 70,
        button: 0,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
      });

      // Ninguna de las guías activas debe provenir de la guía de usuario en x = 200
      const guides = inputController.activeGuides;
      const hasGuide200 = guides.some((g) => g.axis === 'x' && Math.abs(g.position - 200) < 1e-4);
      assert.strictEqual(hasGuide200, false);
    });

    it('no realiza ajuste a guías cuando las guías están ocultas', () => {
      const commandManager = new CommandManager();
      const stateManager = new StateManager(createBaseDocument(), commandManager);
      const canvas = createMockCanvas();
      const inputController = new InputController(canvas, stateManager, commandManager);

      stateManager.addGuide({ id: 'gv-200', axis: 'x', position: 200 });
      stateManager.setGuidesVisible(false);
      stateManager.setSelection(['rect-1']);

      canvas.dispatchSimulatedEvent('mousedown', {
        clientX: 70,
        clientY: 70,
        button: 0,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
      });

      canvas.dispatchSimulatedEvent('mousemove', {
        clientX: 118,
        clientY: 70,
        button: 0,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
      });

      const guides = inputController.activeGuides;
      const hasGuide200 = guides.some((g) => g.axis === 'x' && Math.abs(g.position - 200) < 1e-4);
      assert.strictEqual(hasGuide200, false);
    });
  });

  describe('Atajos de teclado en InputController', () => {
    it('Ctrl+R conmuta la visibilidad de las reglas', () => {
      const commandManager = new CommandManager();
      const stateManager = new StateManager(createBaseDocument(), commandManager);
      const canvas = createMockCanvas();
      const inputController = new InputController(canvas, stateManager, commandManager);

      assert.strictEqual(stateManager.isRulersVisible(), true);

      // Simular Ctrl+R
      inputController.handleKeyDown({ key: 'r', ctrlKey: true, preventDefault: () => {} } as unknown as KeyboardEvent);
      assert.strictEqual(stateManager.isRulersVisible(), false);

      inputController.handleKeyDown({ key: 'r', ctrlKey: true, preventDefault: () => {} } as unknown as KeyboardEvent);
      assert.strictEqual(stateManager.isRulersVisible(), true);
    });

    it('Ctrl+; conmuta la visibilidad de las guías', () => {
      const commandManager = new CommandManager();
      const stateManager = new StateManager(createBaseDocument(), commandManager);
      const canvas = createMockCanvas();
      const inputController = new InputController(canvas, stateManager, commandManager);

      assert.strictEqual(stateManager.isGuidesVisible(), true);

      inputController.handleKeyDown({ key: ';', ctrlKey: true, preventDefault: () => {} } as unknown as KeyboardEvent);
      assert.strictEqual(stateManager.isGuidesVisible(), false);

      inputController.handleKeyDown({ key: ';', ctrlKey: true, preventDefault: () => {} } as unknown as KeyboardEvent);
      assert.strictEqual(stateManager.isGuidesVisible(), true);
    });

    it('Ctrl+Alt+; conmuta el bloqueo de las guías', () => {
      const commandManager = new CommandManager();
      const stateManager = new StateManager(createBaseDocument(), commandManager);
      const canvas = createMockCanvas();
      const inputController = new InputController(canvas, stateManager, commandManager);

      assert.strictEqual(stateManager.isGuidesLocked(), false);

      inputController.handleKeyDown({ key: ';', ctrlKey: true, altKey: true, preventDefault: () => {} } as unknown as KeyboardEvent);
      assert.strictEqual(stateManager.isGuidesLocked(), true);

      inputController.handleKeyDown({ key: ';', ctrlKey: true, altKey: true, preventDefault: () => {} } as unknown as KeyboardEvent);
      assert.strictEqual(stateManager.isGuidesLocked(), false);
    });
  });

  describe('Serialización y Deserialización de Guías', () => {
    it('guarda y restaura correctamente las guías del documento', async () => {
      const doc = createBaseDocument();
      const g1: Guide = { id: 'guide-x', axis: 'x', position: 123.5 };
      const g2: Guide = { id: 'guide-y', axis: 'y', position: 456.7 };
      (doc as any).guides = [g1, g2];

      const json = Serializer.serializeDocument(doc);
      assert.ok(json.includes('"guides"'));

      const parsed = await Serializer.parseDocument(json);
      assert.ok(parsed.guides);
      assert.strictEqual(parsed.guides.length, 2);
      assert.strictEqual(parsed.guides[0].id, 'guide-x');
      assert.strictEqual(parsed.guides[0].axis, 'x');
      assert.strictEqual(parsed.guides[0].position, 123.5);
      assert.strictEqual(parsed.guides[1].id, 'guide-y');
      assert.strictEqual(parsed.guides[1].axis, 'y');
      assert.strictEqual(parsed.guides[1].position, 456.7);
    });

    it('rechaza documentos con guías corruptas lanzando DocumentParseError', async () => {
      const json = JSON.stringify({
        id: 'doc-corrupted',
        type: 'document',
        name: 'Doc Corrupted',
        width: 800,
        height: 600,
        children: [
          {
            id: 'l1',
            type: 'layer',
            name: 'Layer',
            visible: true,
            locked: false,
            children: [],
          },
        ],
        guides: [
          { id: 'ok-1', axis: 'x', position: 100 },
          { id: 'bad-axis', axis: 'z', position: 200 },
        ],
      });

      await assert.rejects(
        () => Serializer.parseDocument(json),
        /guides\[1\]\.axis debe ser 'x' o 'y'/
      );
    });
  });

  describe('RulersController: ciclo de vida y limpieza', () => {
    it('se inicializa y se limpia correctamente sin errores', () => {
      const commandManager = new CommandManager();
      const stateManager = new StateManager(createBaseDocument(), commandManager);
      const viewportManager = new ViewportManager();

      const controller = setupRulersController({
        canvasContainer: null,
        rulerHorizontal: null,
        rulerVertical: null,
        rulerCorner: null,
        viewportManager,
        stateManager,
        commandManager,
      });

      assert.ok(controller);
      assert.doesNotThrow(() => {
        controller.cleanup();
      });
    });

    it('arrastrar desde la regla horizontal crea y confirma una nueva guía en StateManager', () => {
      const commandManager = new CommandManager();
      const stateManager = new StateManager(createBaseDocument(), commandManager);
      const viewportManager = new ViewportManager();

      const listeners: Record<string, ((e: any) => void)[]> = {};
      const mockContainer = {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0 }),
        addEventListener: (t: string, fn: any) => { (listeners[t] = listeners[t] || []).push(fn); },
        removeEventListener: (t: string, fn: any) => { listeners[t] = (listeners[t] || []).filter((l) => l !== fn); },
        classList: { remove: () => {}, add: () => {} },
      } as any;

      const rulerListeners: Record<string, ((e: any) => void)[]> = {};
      const mockHorizontalCanvas = {
        addEventListener: (t: string, fn: any) => { (rulerListeners[t] = rulerListeners[t] || []).push(fn); },
        removeEventListener: (t: string, fn: any) => { rulerListeners[t] = (rulerListeners[t] || []).filter((l) => l !== fn); },
        getContext: () => null,
      } as any;

      const winListeners: Record<string, ((e: any) => void)[]> = {};
      (globalThis as any).addEventListener = (t: string, fn: any) => { (winListeners[t] = winListeners[t] || []).push(fn); };
      (globalThis as any).removeEventListener = (t: string, fn: any) => { winListeners[t] = (winListeners[t] || []).filter((l) => l !== fn); };

      let dragGuideChange: Guide | null = null;
      const controller = setupRulersController({
        canvasContainer: mockContainer,
        rulerHorizontal: mockHorizontalCanvas,
        rulerVertical: null,
        rulerCorner: null,
        viewportManager,
        stateManager,
        commandManager,
        onGuideDragChange: (g) => { dragGuideChange = g; },
      });

      // Iniciar arrastre en regla horizontal
      rulerListeners['mousedown']?.[0]?.({
        preventDefault: () => {},
        clientY: 10,
        clientX: 100,
      });

      assert.ok(dragGuideChange);
      assert.strictEqual((dragGuideChange as Guide).axis, 'y');
      assert.strictEqual(controller.activeDragGuide?.axis, 'y');

      // Mover el ratón a y = 150 px
      winListeners['mousemove']?.[0]?.({
        clientY: 150,
        clientX: 100,
      });

      assert.strictEqual((dragGuideChange as Guide).position, 150);

      // Soltar el ratón en y = 150 px
      winListeners['mouseup']?.[0]?.({
        clientY: 150,
        clientX: 100,
      });

      assert.strictEqual(dragGuideChange, null);
      assert.strictEqual(controller.activeDragGuide, null);

      // Verificar guía creada
      const guides = stateManager.getGuides();
      assert.strictEqual(guides.length, 1);
      assert.strictEqual(guides[0].axis, 'y');
      assert.strictEqual(guides[0].position, 150);

      // Soporte Undo/Redo
      commandManager.undo();
      assert.strictEqual(stateManager.getGuides().length, 0);
      commandManager.redo();
      assert.strictEqual(stateManager.getGuides().length, 1);
      assert.strictEqual(stateManager.getGuides()[0].position, 150);

      controller.cleanup();
    });

    it('arrastrar desde la regla vertical crea y confirma una nueva guía en StateManager', () => {
      const commandManager = new CommandManager();
      const stateManager = new StateManager(createBaseDocument(), commandManager);
      const viewportManager = new ViewportManager();

      const mockContainer = {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0 }),
        addEventListener: () => {},
        removeEventListener: () => {},
        classList: { remove: () => {}, add: () => {} },
      } as any;

      const rulerListeners: Record<string, ((e: any) => void)[]> = {};
      const mockVerticalCanvas = {
        addEventListener: (t: string, fn: any) => { (rulerListeners[t] = rulerListeners[t] || []).push(fn); },
        removeEventListener: () => {},
        getContext: () => null,
      } as any;

      const winListeners: Record<string, ((e: any) => void)[]> = {};
      (globalThis as any).addEventListener = (t: string, fn: any) => { (winListeners[t] = winListeners[t] || []).push(fn); };
      (globalThis as any).removeEventListener = () => {};

      let dragGuideChange: Guide | null = null;
      const controller = setupRulersController({
        canvasContainer: mockContainer,
        rulerHorizontal: null,
        rulerVertical: mockVerticalCanvas,
        rulerCorner: null,
        viewportManager,
        stateManager,
        commandManager,
        onGuideDragChange: (g) => { dragGuideChange = g; },
      });

      rulerListeners['mousedown']?.[0]?.({
        preventDefault: () => {},
        clientX: 10,
        clientY: 200,
      });

      assert.ok(dragGuideChange);
      assert.strictEqual((dragGuideChange as Guide).axis, 'x');

      winListeners['mousemove']?.[0]?.({
        clientX: 250,
        clientY: 200,
      });

      assert.strictEqual((dragGuideChange as Guide).position, 250);

      winListeners['mouseup']?.[0]?.({
        clientX: 250,
        clientY: 200,
      });

      const guides = stateManager.getGuides();
      assert.strictEqual(guides.length, 1);
      assert.strictEqual(guides[0].axis, 'x');
      assert.strictEqual(guides[0].position, 250);

      controller.cleanup();
    });

    it('doble clic en la regla coloca una guía en la coordenada pulsada', () => {
      const commandManager = new CommandManager();
      const stateManager = new StateManager(createBaseDocument(), commandManager);
      const viewportManager = new ViewportManager();

      const mockContainer = {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0 }),
        addEventListener: () => {},
        removeEventListener: () => {},
        classList: { remove: () => {}, add: () => {} },
      } as any;

      const rulerListeners: Record<string, ((e: any) => void)[]> = {};
      const mockHorizontalCanvas = {
        addEventListener: (t: string, fn: any) => { (rulerListeners[t] = rulerListeners[t] || []).push(fn); },
        removeEventListener: () => {},
        getContext: () => null,
      } as any;

      const controller = setupRulersController({
        canvasContainer: mockContainer,
        rulerHorizontal: mockHorizontalCanvas,
        rulerVertical: null,
        rulerCorner: null,
        viewportManager,
        stateManager,
        commandManager,
      });

      rulerListeners['dblclick']?.[0]?.({
        clientY: 100,
      });

      const guides = stateManager.getGuides();
      assert.strictEqual(guides.length, 1);
      assert.strictEqual(guides[0].axis, 'y');
      assert.strictEqual(guides[0].position, 100);

      controller.cleanup();
    });
  });
});
