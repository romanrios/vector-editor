import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { AddArtboardCommand } from '../src/commands/AddArtboardCommand.ts';
import { DeleteArtboardCommand } from '../src/commands/DeleteArtboardCommand.ts';
import { UpdateArtboardCommand } from '../src/commands/UpdateArtboardCommand.ts';
import { Serializer } from '../src/state/Serializer.ts';
import { exportDocumentToSvg } from '../src/utils/exportSvg.ts';
import { calculateExportBounds } from '../src/utils/exportRaster.ts';
import { InputController } from '../src/input/InputController.ts';
import type { Artboard, Document } from '../src/types/scene-graph.ts';
import { isArtboard } from '../src/types/scene-graph.ts';

function createMockCanvas(): HTMLCanvasElement {
  return {
    width: 800,
    height: 600,
    style: {} as CSSStyleDeclaration,
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
    getContext: () => ({
      save: () => {},
      restore: () => {},
      setTransform: () => {},
      clearRect: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      arc: () => {},
      fill: () => {},
      stroke: () => {},
      fillText: () => {},
      measureText: (text: string) => ({ width: text.length * 10 }),
      setLineDash: () => {},
    }),
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as HTMLCanvasElement;
}

function createTestDocument(width = 800, height = 600): Document {
  return {
    id: 'test-doc',
    type: 'document',
    name: 'Test Doc',
    width,
    height,
    children: [
      {
        id: 'layer-1',
        type: 'layer',
        name: 'Capa 1',
        visible: true,
        locked: false,
        children: [],
      },
    ],
  };
}

describe('Hito 3.4: Múltiples Mesas de Trabajo (Multi-Artboards)', () => {
  describe('1. StateManager y Scene Graph de Mesas de Trabajo', () => {
    it('isArtboard valida correctamente la estructura de un Artboard', () => {
      assert.equal(
        isArtboard({ id: 'ab-1', name: 'Mesa 1', x: 0, y: 0, width: 800, height: 600 }),
        true
      );
      assert.equal(isArtboard(null), false);
      assert.equal(isArtboard({ id: 'ab-1' }), false);
      assert.equal(isArtboard({ id: 123, name: 'Mesa 1' }), false);
    });

    it('devuelve una mesa de trabajo virtual por defecto cuando document.artboards no está definido', () => {
      const sm = new StateManager(createTestDocument(800, 600));
      const artboards = sm.getArtboards();
      assert.equal(artboards.length, 1);
      assert.equal(artboards[0].x, 0);
      assert.equal(artboards[0].y, 0);
      assert.equal(artboards[0].width, 800);
      assert.equal(artboards[0].height, 600);

      const active = sm.getActiveArtboard();
      assert.equal(active.id, artboards[0].id);
    });

    it('addArtboard añade una nueva mesa de trabajo y la establece como activa', () => {
      const sm = new StateManager();
      const initialDirty = sm.isDirty;
      assert.equal(initialDirty, true);

      const newAb: Artboard = {
        id: 'ab-2',
        name: 'Mesa Móvil',
        x: 900,
        y: 0,
        width: 375,
        height: 812,
        backgroundColor: '#ffffff',
      };

      sm.addArtboard(newAb);

      const artboards = sm.getArtboards();
      assert.equal(artboards.length, 2);
      assert.equal(artboards[1].id, 'ab-2');
      assert.equal(artboards[1].name, 'Mesa Móvil');
      assert.equal(sm.getActiveArtboardId(), 'ab-2');
      assert.equal(sm.getActiveArtboard().name, 'Mesa Móvil');
      assert.equal(sm.isDirty, true);
    });

    it('addArtboard valida parámetros y rechaza anchos o altos inválidos', () => {
      const sm = new StateManager();
      assert.throws(() => sm.addArtboard(null as any));
      assert.throws(() => sm.addArtboard({ id: '', name: 'Mesa', x: 0, y: 0, width: 100, height: 100 }));
      assert.throws(() => sm.addArtboard({ id: 'ab', name: 'Mesa', x: 0, y: 0, width: 0, height: 100 }));
      assert.throws(() => sm.addArtboard({ id: 'ab', name: 'Mesa', x: 0, y: 0, width: 100, height: -10 }));
    });

    it('updateArtboard actualiza propiedades y sincroniza dimensiones si es la mesa primaria', () => {
      const sm = new StateManager();
      const defaultId = sm.getArtboards()[0].id;

      sm.updateArtboard(defaultId, { width: 1024, height: 768, name: 'Principal Renombrada' });

      const updated = sm.getActiveArtboard();
      assert.equal(updated.width, 1024);
      assert.equal(updated.height, 768);
      assert.equal(updated.name, 'Principal Renombrada');
      assert.equal(sm.getState().width, 1024);
      assert.equal(sm.getState().height, 768);
    });

    it('removeArtboard elimina una mesa y no permite eliminar si solo queda una', () => {
      const sm = new StateManager();
      const defaultId = sm.getArtboards()[0].id;

      assert.throws(
        () => sm.removeArtboard(defaultId),
        /No se puede eliminar la única Mesa de Trabajo/
      );

      sm.addArtboard({ id: 'ab-2', name: 'Mesa 2', x: 900, y: 0, width: 400, height: 400 });
      assert.equal(sm.getArtboards().length, 2);

      sm.removeArtboard('ab-2');
      assert.equal(sm.getArtboards().length, 1);
      assert.equal(sm.getActiveArtboardId(), defaultId);
    });

    it('getArtboardAt localiza qué mesa de trabajo contiene el punto especificado', () => {
      const sm = new StateManager(createTestDocument(800, 600));
      sm.addArtboard({ id: 'ab-right', name: 'Derecha', x: 1000, y: 200, width: 500, height: 500 });

      const hitDefault = sm.getArtboardAt(400, 300);
      assert.ok(hitDefault);
      assert.equal(hitDefault?.x, 0);

      const hitRight = sm.getArtboardAt(1200, 300);
      assert.ok(hitRight);
      assert.equal(hitRight?.id, 'ab-right');

      const hitEmpty = sm.getArtboardAt(850, 100);
      assert.equal(hitEmpty, null);
    });
  });

  describe('2. Comandos Reversibles de Mesas de Trabajo', () => {
    it('AddArtboardCommand ejecuta y deshace la creación de una mesa', () => {
      const cm = new CommandManager();
      const sm = new StateManager(undefined, cm);

      const newAb: Artboard = {
        id: 'ab-cmd-1',
        name: 'Mesa Comando',
        x: 1000,
        y: 0,
        width: 600,
        height: 400,
      };

      const cmd = new AddArtboardCommand(sm, newAb);
      cm.executeCommand(cmd);

      assert.equal(sm.getArtboards().length, 2);
      assert.equal(sm.getActiveArtboardId(), 'ab-cmd-1');

      cm.undo();
      assert.equal(sm.getArtboards().length, 1);

      cm.redo();
      assert.equal(sm.getArtboards().length, 2);
      assert.equal(sm.getActiveArtboardId(), 'ab-cmd-1');
    });

    it('DeleteArtboardCommand elimina y restaura la mesa con undo', () => {
      const cm = new CommandManager();
      const sm = new StateManager(undefined, cm);

      const newAb: Artboard = {
        id: 'ab-to-delete',
        name: 'Mesa a Borrar',
        x: 1000,
        y: 0,
        width: 500,
        height: 500,
      };
      sm.addArtboard(newAb);
      assert.equal(sm.getArtboards().length, 2);

      const delCmd = new DeleteArtboardCommand(sm, newAb);
      cm.executeCommand(delCmd);

      assert.equal(sm.getArtboards().length, 1);

      cm.undo();
      assert.equal(sm.getArtboards().length, 2);
      assert.equal(sm.getArtboards()[1].id, 'ab-to-delete');

      cm.redo();
      assert.equal(sm.getArtboards().length, 1);
    });

    it('UpdateArtboardCommand actualiza posición y dimensiones con undo/redo', () => {
      const cm = new CommandManager();
      const sm = new StateManager(undefined, cm);

      const ab: Artboard = {
        id: 'ab-update',
        name: 'Mesa Antes',
        x: 100,
        y: 100,
        width: 400,
        height: 400,
      };
      sm.addArtboard(ab);

      const updateCmd = new UpdateArtboardCommand(
        sm,
        'ab-update',
        { x: 100, y: 100, width: 400, height: 400, name: 'Mesa Antes' },
        { x: 250, y: 150, width: 600, height: 500, name: 'Mesa Después' }
      );

      cm.executeCommand(updateCmd);
      const after = sm.getArtboards().find((a) => a.id === 'ab-update');
      assert.equal(after?.x, 250);
      assert.equal(after?.y, 150);
      assert.equal(after?.width, 600);
      assert.equal(after?.height, 500);
      assert.equal(after?.name, 'Mesa Después');

      cm.undo();
      const before = sm.getArtboards().find((a) => a.id === 'ab-update');
      assert.equal(before?.x, 100);
      assert.equal(before?.width, 400);
      assert.equal(before?.name, 'Mesa Antes');

      cm.redo();
      const redoAfter = sm.getArtboards().find((a) => a.id === 'ab-update');
      assert.equal(redoAfter?.x, 250);
      assert.equal(redoAfter?.width, 600);
    });
  });

  describe('3. Serialización y Persistencia de Mesas de Trabajo', () => {
    it('Serializer conserva artboards y activeArtboardId al serializar y deserializar', async () => {
      const sm = new StateManager();
      sm.addArtboard({
        id: 'ab-phone',
        name: 'iPhone 15',
        x: 1000,
        y: 50,
        width: 393,
        height: 852,
        backgroundColor: '#fafafa',
      });

      const doc = sm.getState();
      const json = Serializer.serializeDocument(doc);

      const restored = await Serializer.parseDocument(json);
      assert.ok(restored.artboards);
      assert.equal(restored.artboards?.length, 2);
      assert.equal(restored.artboards?.[1].name, 'iPhone 15');
      assert.equal(restored.artboards?.[1].backgroundColor, '#fafafa');
      assert.equal(restored.activeArtboardId, 'ab-phone');
    });
  });

  describe('4. Exportación Acotada a Mesa de Trabajo (SVG y Ráster)', () => {
    it('exportDocumentToSvg ajusta viewBox al artboard especificado por artboardId', () => {
      const sm = new StateManager();
      sm.addArtboard({
        id: 'ab-export-target',
        name: 'Export Scope',
        x: 1200,
        y: 400,
        width: 500,
        height: 350,
      });

      const svg = exportDocumentToSvg(sm.getState(), {
        artboardId: 'ab-export-target',
      });

      assert.ok(svg.includes('viewBox="1200 400 500 350"'));
      assert.ok(svg.includes('width="500"'));
      assert.ok(svg.includes('height="350"'));
    });

    it('calculateExportBounds retorna las coordenadas y dimensiones de la mesa seleccionada', () => {
      const sm = new StateManager();
      sm.addArtboard({
        id: 'ab-raster-target',
        name: 'Raster Target',
        x: 2000,
        y: 100,
        width: 1080,
        height: 1080,
      });

      const bounds = calculateExportBounds(sm.getState(), false, [], 'ab-raster-target');
      assert.deepEqual(bounds, {
        x: 2000,
        y: 100,
        width: 1080,
        height: 1080,
      });
    });
  });

  describe('5. Herramienta ArtboardTool en InputController', () => {
    it('permite cambiar a la herramienta artboard y emite toolChange', () => {
      const canvas = createMockCanvas();
      const sm = new StateManager();
      const cm = new CommandManager();
      const ic = new InputController(canvas, sm, cm);

      let emittedTool = '';
      ic.on('toolChange', (tool) => {
        emittedTool = tool;
      });

      ic.setTool('artboard');
      assert.equal(ic.currentTool, 'artboard');
      assert.equal(emittedTool, 'artboard');
      assert.ok(ic.artboardOverlayState);
      assert.equal(ic.artboardOverlayState?.isArtboardToolActive, true);
    });

    it('Shift+O conmuta a la herramienta artboard', () => {
      const canvas = createMockCanvas();
      const sm = new StateManager();
      const cm = new CommandManager();
      const ic = new InputController(canvas, sm, cm);

      const event = {
        key: 'O',
        shiftKey: true,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        preventDefault: () => {},
      } as unknown as KeyboardEvent;

      ic.handleKeyDown(event);
      assert.equal(ic.currentTool, 'artboard');
    });

    it('clic simple en el vacío crea una nueva mesa de trabajo y la registra en el historial', () => {
      const canvas = createMockCanvas();
      const sm = new StateManager(createTestDocument(800, 600));
      const cm = new CommandManager();
      const ic = new InputController(canvas, sm, cm);

      ic.setTool('artboard');
      assert.equal(sm.getArtboards().length, 1);

      // Simular clic en (1000, 100) en el vacío
      ic.artboardToolHandler.onMouseDown({ button: 0 } as MouseEvent, { x: 1000, y: 100 });
      ic.artboardToolHandler.onMouseUp({ button: 0 } as MouseEvent, { x: 1000, y: 100 });

      assert.equal(sm.getArtboards().length, 2);
      const created = sm.getArtboards()[1];
      assert.equal(created.x, 1000);
      assert.equal(created.y, 100);
      assert.equal(created.width, 800);
      assert.equal(created.height, 600);

      // Undo elimina la mesa
      cm.undo();
      assert.equal(sm.getArtboards().length, 1);

      // Redo la vuelve a añadir
      cm.redo();
      assert.equal(sm.getArtboards().length, 2);
    });

    it('arrastre en el vacío crea una mesa con el tamaño personalizado arrastrado', () => {
      const canvas = createMockCanvas();
      const sm = new StateManager(createTestDocument(800, 600));
      const cm = new CommandManager();
      const ic = new InputController(canvas, sm, cm);

      ic.setTool('artboard');

      ic.artboardToolHandler.onMouseDown({ button: 0 } as MouseEvent, { x: 1000, y: 700 });
      ic.artboardToolHandler.onMouseMove({ button: 0 } as MouseEvent, { x: 1350, y: 1100 });

      assert.ok(ic.artboardToolHandler.isCreating);
      assert.deepEqual(ic.artboardToolHandler.creationBox, {
        x: 1000,
        y: 700,
        width: 350,
        height: 400,
      });

      ic.artboardToolHandler.onMouseUp({ button: 0 } as MouseEvent, { x: 1350, y: 1100 });

      assert.equal(sm.getArtboards().length, 2);
      const created = sm.getArtboards()[1];
      assert.equal(created.x, 1000);
      assert.equal(created.y, 700);
      assert.equal(created.width, 350);
      assert.equal(created.height, 400);
    });

    it('arrastrar un tirador redimensiona la mesa activa y registra UpdateArtboardCommand', () => {
      const canvas = createMockCanvas();
      const sm = new StateManager(createTestDocument(800, 600));
      const cm = new CommandManager();
      const ic = new InputController(canvas, sm, cm);

      ic.setTool('artboard');
      const activeAb = sm.getActiveArtboard();
      assert.ok(activeAb);

      // Clic sobre el tirador 'se' (esquina inferior derecha: 800, 600)
      ic.artboardToolHandler.onMouseDown({ button: 0 } as MouseEvent, { x: 800, y: 600 });
      assert.equal(ic.artboardToolHandler.isResizing, true);

      // Arrastrar hasta (950, 750)
      ic.artboardToolHandler.onMouseMove({ button: 0 } as MouseEvent, { x: 950, y: 750 });
      ic.artboardToolHandler.onMouseUp({ button: 0 } as MouseEvent, { x: 950, y: 750 });

      const resized = sm.getActiveArtboard();
      assert.equal(resized.width, 950);
      assert.equal(resized.height, 750);

      // Undo restaura las dimensiones previas
      cm.undo();
      const restored = sm.getActiveArtboard();
      assert.equal(restored.width, 800);
      assert.equal(restored.height, 600);
    });

    it('pulsar Supr o Backspace elimina la mesa activa si hay más de una', () => {
      const canvas = createMockCanvas();
      const sm = new StateManager();
      const cm = new CommandManager();
      const ic = new InputController(canvas, sm, cm);

      sm.addArtboard({ id: 'ab-del-key', name: 'Mesa Tecla', x: 1000, y: 0, width: 400, height: 400 });
      assert.equal(sm.getArtboards().length, 2);

      ic.setTool('artboard');
      const event = { key: 'Delete', preventDefault: () => {} } as unknown as KeyboardEvent;
      ic.handleKeyDown(event);

      assert.equal(sm.getArtboards().length, 1);

      cm.undo();
      assert.equal(sm.getArtboards().length, 2);
    });
  });
});
