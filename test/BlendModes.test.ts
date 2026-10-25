import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { StyleShapesCommand } from '../src/commands/StyleShapesCommand.ts';
import { RenderEngine } from '../src/render/RenderEngine.ts';
import { ViewportManager } from '../src/utils/viewport.ts';
import { exportDocumentToSvg } from '../src/utils/exportSvg.ts';
import { parseSvgString } from '../src/utils/svgImport.ts';
import { renderDocumentToCanvas } from '../src/utils/exportRaster.ts';
import {
  blendModeToCompositeOperation,
  type BlendMode,
  type Document,
  type Layer,
  type Group,
  type Rectangle,
} from '../src/types/scene-graph.ts';
import { setupPropertiesPanelBindings } from '../src/ui/PropertiesPanelController.ts';

// Helper factory para tests
function makeDoc(children: Layer[] = []): Document {
  return {
    type: 'document',
    id: 'doc-1',
    name: 'Documento Test',
    width: 800,
    height: 600,
    children,
    artboards: [{ id: 'ab-1', name: 'Mesa 1', x: 0, y: 0, width: 800, height: 600 }],
  };
}

function makeLayer(id: string, children: any[] = [], blendMode?: BlendMode): Layer {
  return {
    id,
    type: 'layer',
    name: `Capa ${id}`,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode,
    children,
  };
}

function makeRect(id: string, blendMode?: BlendMode): Rectangle {
  return {
    id,
    type: 'rectangle',
    name: `Rect ${id}`,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode,
    x: 10,
    y: 10,
    width: 100,
    height: 100,
    fill: '#ff0000',
    stroke: 'none',
  };
}

function makeGroup(id: string, children: any[] = [], blendMode?: BlendMode): Group {
  return {
    id,
    type: 'group',
    name: `Grupo ${id}`,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode,
    children,
  };
}

// Mock Canvas 2D
function createMockCanvas(): { canvas: HTMLCanvasElement; ctx: any; calls: string[]; compositeOps: string[] } {
  const calls: string[] = [];
  const compositeOps: string[] = [];
  let _gco: GlobalCompositeOperation = 'source-over';

  const mockCtx: any = {
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    setTransform: () => calls.push('setTransform'),
    clearRect: () => calls.push('clearRect'),
    fillRect: () => calls.push('fillRect'),
    beginPath: () => calls.push('beginPath'),
    moveTo: () => calls.push('moveTo'),
    lineTo: () => calls.push('lineTo'),
    rect: () => calls.push('rect'),
    strokeRect: () => calls.push('strokeRect'),
    fill: () => calls.push('fill'),
    stroke: () => calls.push('stroke'),
    translate: () => calls.push('translate'),
    rotate: () => calls.push('rotate'),
    scale: () => calls.push('scale'),
    setLineDash: () => {},
    measureText: (txt: string) => ({ width: txt.length * 10 }),
    get globalCompositeOperation() {
      return _gco;
    },
    set globalCompositeOperation(val: GlobalCompositeOperation) {
      _gco = val;
      compositeOps.push(val);
      calls.push(`gco:${val}`);
    },
    globalAlpha: 1,
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
  };

  const canvas = {
    getContext: () => mockCtx,
    width: 800,
    height: 600,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
  } as unknown as HTMLCanvasElement;

  return { canvas, ctx: mockCtx, calls, compositeOps };
}

describe('Fase 5.1 - Modos de Fusión (Blend Modes)', () => {
  describe('blendModeToCompositeOperation mapping', () => {
    it('mapea normal y undefined a source-over', () => {
      assert.equal(blendModeToCompositeOperation(undefined), 'source-over');
      assert.equal(blendModeToCompositeOperation('normal'), 'source-over');
    });

    it('mapea correctamente todos los modos de fusión CSS a Canvas 2D', () => {
      const modes: BlendMode[] = [
        'multiply',
        'screen',
        'overlay',
        'darken',
        'lighten',
        'color-dodge',
        'color-burn',
        'hard-light',
        'soft-light',
        'difference',
        'exclusion',
      ];
      for (const mode of modes) {
        assert.equal(blendModeToCompositeOperation(mode), mode);
      }
    });
  });

  describe('StateManager drawingStyle y updateShapesStyle', () => {
    it('inicializa drawingStyle con blendMode normal', () => {
      const stateManager = new StateManager();
      assert.equal(stateManager.getDrawingStyle().blendMode, 'normal');
    });

    it('permite actualizar drawingStyle con un blendMode nuevo', () => {
      const stateManager = new StateManager();
      stateManager.setDrawingStyle({ blendMode: 'multiply' });
      assert.equal(stateManager.getDrawingStyle().blendMode, 'multiply');
    });

    it('aplica blendMode a figuras mediante updateShapesStyle con persistencia estructural', () => {
      const rect1 = makeRect('r1');
      const rect2 = makeRect('r2');
      const layer1 = makeLayer('l1', [rect1]);
      const layer2 = makeLayer('l2', [rect2]);
      const doc = makeDoc([layer1, layer2]);

      const stateManager = new StateManager(doc);
      const initialLayer2 = stateManager.getState().children[1];
      const changed = stateManager.updateShapesStyle([
        { id: 'r1', style: { blendMode: 'screen' } },
      ]);

      assert.equal(changed, true);
      const updatedDoc = stateManager.getState();
      const updatedRect1 = updatedDoc.children[0].children[0] as Rectangle;
      assert.equal(updatedRect1.blendMode, 'screen');

      // Capa 2 no afectada conserva referencia exacta (structural sharing)
      assert.equal(updatedDoc.children[1], initialLayer2);
    });

    it('retorna false si el blendMode ya es igual', () => {
      const rect1 = makeRect('r1', 'multiply');
      const layer1 = makeLayer('l1', [rect1]);
      const doc = makeDoc([layer1]);

      const stateManager = new StateManager(doc);
      const changed = stateManager.updateShapesStyle([
        { id: 'r1', style: { blendMode: 'multiply' } },
      ]);

      assert.equal(changed, false);
    });
  });

  describe('StyleShapesCommand con blendMode', () => {
    it('ejecuta, deshace y rehace cambio de blendMode en una sola operación', () => {
      const rect = makeRect('r1', 'normal');
      const layer = makeLayer('l1', [rect]);
      const doc = makeDoc([layer]);
      const stateManager = new StateManager(doc);
      const commandManager = new CommandManager();

      const cmd = new StyleShapesCommand(stateManager, [
        {
          id: 'r1',
          before: { blendMode: 'normal' },
          after: { blendMode: 'overlay' },
        },
      ]);

      assert.equal(cmd.isAlreadyAtTarget, false);
      cmd.execute();
      commandManager.recordCommand(cmd);

      let currentRect = stateManager.getState().children[0].children[0] as Rectangle;
      assert.equal(currentRect.blendMode, 'overlay');

      commandManager.undo();
      currentRect = stateManager.getState().children[0].children[0] as Rectangle;
      assert.equal(currentRect.blendMode, 'normal');

      commandManager.redo();
      currentRect = stateManager.getState().children[0].children[0] as Rectangle;
      assert.equal(currentRect.blendMode, 'overlay');
    });

    it('detecta isAlreadyAtTarget cuando before y after coinciden', () => {
      const stateManager = new StateManager();
      const cmd = new StyleShapesCommand(stateManager, [
        {
          id: 'r1',
          before: { blendMode: 'darken' },
          after: { blendMode: 'darken' },
        },
      ]);
      assert.equal(cmd.isAlreadyAtTarget, true);
    });
  });

  describe('RenderEngine y composición de Canvas 2D', () => {
    it('aplica globalCompositeOperation al renderizar figuras con blendMode', () => {
      const rect = makeRect('r1', 'multiply');
      const layer = makeLayer('l1', [rect]);
      const doc = makeDoc([layer]);

      const stateManager = new StateManager(doc);
      const viewportManager = new ViewportManager();
      const { canvas, compositeOps } = createMockCanvas();

      const engine = new RenderEngine(canvas, stateManager, { viewportManager });
      engine.render();

      assert.ok(compositeOps.includes('multiply'), 'Debe aplicar globalCompositeOperation multiply');
    });

    it('aplica globalCompositeOperation al renderizar grupos con blendMode', () => {
      const rect = makeRect('r1');
      const group = makeGroup('g1', [rect], 'color-dodge');
      const layer = makeLayer('l1', [group]);
      const doc = makeDoc([layer]);

      const stateManager = new StateManager(doc);
      const viewportManager = new ViewportManager();
      const { canvas, compositeOps } = createMockCanvas();

      const engine = new RenderEngine(canvas, stateManager, { viewportManager });
      engine.render();

      assert.ok(compositeOps.includes('color-dodge'), 'Debe aplicar globalCompositeOperation color-dodge en grupo');
    });

    it('aplica globalCompositeOperation al renderizar capas con blendMode', () => {
      const rect = makeRect('r1');
      const layer = makeLayer('l1', [rect], 'difference');
      const doc = makeDoc([layer]);

      const stateManager = new StateManager(doc);
      const viewportManager = new ViewportManager();
      const { canvas, compositeOps } = createMockCanvas();

      const engine = new RenderEngine(canvas, stateManager, { viewportManager });
      engine.render();

      assert.ok(compositeOps.includes('difference'), 'Debe aplicar globalCompositeOperation difference en capa');
    });
  });

  describe('SVG Export e Import', () => {
    it('exporta mix-blend-mode en el atributo style de la figura', () => {
      const rect = makeRect('r1', 'hard-light');
      const layer = makeLayer('l1', [rect]);
      const doc = makeDoc([layer]);

      const svg = exportDocumentToSvg(doc);
      assert.ok(svg.includes('mix-blend-mode: hard-light'), 'El SVG exportado debe incluir mix-blend-mode: hard-light');
    });

    it('omite mix-blend-mode cuando blendMode es normal o ausente', () => {
      const rect = makeRect('r1', 'normal');
      const layer = makeLayer('l1', [rect]);
      const doc = makeDoc([layer]);

      const svg = exportDocumentToSvg(doc);
      assert.ok(!svg.includes('mix-blend-mode: normal'), 'No debe exportar mix-blend-mode normal redundante');
    });

    it('importa mix-blend-mode desde SVG en figuras y grupos', () => {
      const svgString = `
        <svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
          <g id="group1" style="mix-blend-mode: screen;">
            <rect id="rect1" x="20" y="20" width="100" height="100" fill="#00ff00" style="mix-blend-mode: multiply;" />
          </g>
        </svg>
      `;

      const result = parseSvgString(svgString);
      assert.equal(result.success, true);
      const group = result.shapes[0] as Group;
      assert.equal(group.blendMode, 'screen', 'El grupo importado debe tener blendMode screen');

      const rect = group.children[0] as Rectangle;
      assert.equal(rect.blendMode, 'multiply', 'El rectángulo importado debe tener blendMode multiply');
    });
  });

  describe('Raster Export con blendMode', () => {
    it('aplica globalCompositeOperation en el contexto de exportación ráster', () => {
      // Mock de createElement y Canvas
      const originalCreateElement = (globalThis as any).document?.createElement;
      const { canvas, compositeOps } = createMockCanvas();

      (globalThis as any).document = {
        createElement: (tag: string) => {
          if (tag === 'canvas') return canvas;
          return {};
        },
      };

      try {
        const rect = makeRect('r1', 'soft-light');
        const layer = makeLayer('l1', [rect]);
        const doc = makeDoc([layer]);

        renderDocumentToCanvas(doc);
        assert.ok(compositeOps.includes('soft-light'), 'Export raster debe configurar soft-light');
      } finally {
        if (originalCreateElement) {
          (globalThis as any).document.createElement = originalCreateElement;
        } else {
          delete (globalThis as any).document;
        }
      }
    });
  });

  describe('Properties Panel UI Controller', () => {
    // Mock minimalista de DOM para PropertiesPanelController
    class MockDomElement {
      public value: string = '';
      public placeholder: string = '';
      public textContent: string = '';
      public style: Record<string, string> = {};
      public classList = {
        add: () => {},
        remove: () => {},
        contains: () => false,
        toggle: () => false,
      };
      private listeners = new Map<string, ((e?: any) => void)[]>();

      addEventListener(event: string, fn: (e?: any) => void) {
        if (!this.listeners.has(event)) this.listeners.set(event, []);
        this.listeners.get(event)!.push(fn);
      }
      removeEventListener(event: string, fn: (e?: any) => void) {
        const list = this.listeners.get(event) ?? [];
        this.listeners.set(event, list.filter((f) => f !== fn));
      }
      trigger(event: string, e?: any) {
        for (const fn of this.listeners.get(event) ?? []) {
          fn(e);
        }
      }
      setAttribute() {}
      getAttribute() { return null; }
    }

    it('sincroniza select-blend-mode y registra StyleShapesCommand en cambio de usuario', () => {
      const selectBlendMode = new MockDomElement();
      selectBlendMode.value = 'normal';

      const mockElements: Record<string, any> = {
        '#select-blend-mode': selectBlendMode,
        '#panel-title, .panel-title': new MockDomElement(),
        '#no-selection-state': new MockDomElement(),
        '#selection-state': new MockDomElement(),
        '#section-appearance': new MockDomElement(),
        '#section-transform': new MockDomElement(),
        '#section-artboard': new MockDomElement(),
      };

      const originalQuerySelector = (globalThis as any).document?.querySelector;
      (globalThis as any).document = {
        querySelector: (sel: string) => mockElements[sel] ?? null,
        querySelectorAll: () => [],
      };

      try {
        const rect1 = makeRect('r1', 'normal');
        const layer = makeLayer('l1', [rect1]);
        const doc = makeDoc([layer]);

        const stateManager = new StateManager(doc);
        const commandManager = new CommandManager();
        const inputController = {} as any;

        const controller = setupPropertiesPanelBindings({
          stateManager,
          commandManager,
          inputController,
          canvas: null,
        });

        // Sincronizar sin selección: debe reflejar normal
        controller.syncPropertiesPanel();
        assert.equal(selectBlendMode.value, 'normal');

        // Seleccionar figura
        stateManager.setSelection(['r1']);
        controller.syncPropertiesPanel(stateManager.getSelectedNodes());
        assert.equal(selectBlendMode.value, 'normal');

        // Usuario cambia select-blend-mode a exclusion
        selectBlendMode.value = 'exclusion';
        selectBlendMode.trigger('change');

        // Verificar que el Scene Graph se actualizó
        const updatedRect = stateManager.getState().children[0].children[0] as Rectangle;
        assert.equal(updatedRect.blendMode, 'exclusion');

        // Verificar que el comando se registró en el historial
        assert.equal(commandManager.canUndo(), true);
        commandManager.undo();

        const revertedRect = stateManager.getState().children[0].children[0] as Rectangle;
        assert.equal(revertedRect.blendMode, 'normal');

        controller.cleanup();
      } finally {
        if (originalQuerySelector) {
          (globalThis as any).document.querySelector = originalQuerySelector;
        } else {
          delete (globalThis as any).document;
        }
      }
    });
  });
});
