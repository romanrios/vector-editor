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
import { SpatialIndex } from '../src/spatial/SpatialIndex.ts';
import { expandAABBWithShadow, getShapeVisualAABB } from '../src/utils/geometry.ts';
import {
  isDropShadowEqual,
  type DropShadow,
  type Document,
  type Layer,
  type Rectangle,
} from '../src/types/scene-graph.ts';
import { setupPropertiesPanelBindings } from '../src/ui/PropertiesPanelController.ts';

function makeDoc(children: Layer[] = []): Document {
  return {
    type: 'document',
    id: 'doc-shadow-test',
    name: 'Documento Test Sombra',
    width: 800,
    height: 600,
    children,
    artboards: [{ id: 'ab-1', name: 'Mesa 1', x: 0, y: 0, width: 800, height: 600 }],
  };
}

function makeLayer(id: string, children: any[] = []): Layer {
  return {
    id,
    type: 'layer',
    name: `Capa ${id}`,
    visible: true,
    locked: false,
    opacity: 1,
    children,
  };
}

function makeRect(id: string, shadow?: DropShadow | null, fill: string = '#ff0000', stroke: string = 'none'): Rectangle {
  return {
    id,
    type: 'rectangle',
    name: `Rect ${id}`,
    visible: true,
    locked: false,
    opacity: 1,
    dropShadow: shadow ?? undefined,
    x: 100,
    y: 100,
    width: 200,
    height: 150,
    fill,
    stroke,
    strokeWidth: 2,
  };
}

function createMockCanvas(): { canvas: HTMLCanvasElement; ctx: any; calls: string[]; shadowHistory: Array<{ color: string; offsetX: number; offsetY: number; blur: number }> } {
  const calls: string[] = [];
  const shadowHistory: Array<{ color: string; offsetX: number; offsetY: number; blur: number }> = [];

  let _shadowColor = 'transparent';
  let _shadowOffsetX = 0;
  let _shadowOffsetY = 0;
  let _shadowBlur = 0;

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
    fill: () => {
      calls.push(`fill(shadow:${mockCtx.shadowColor},blur:${mockCtx.shadowBlur})`);
    },
    stroke: () => {
      calls.push(`stroke(shadow:${mockCtx.shadowColor},blur:${mockCtx.shadowBlur})`);
    },
    translate: () => calls.push('translate'),
    rotate: () => calls.push('rotate'),
    scale: () => calls.push('scale'),
    setLineDash: () => {},
    measureText: (txt: string) => ({ width: txt.length * 10 }),
    get shadowColor() {
      return _shadowColor;
    },
    set shadowColor(val: string) {
      _shadowColor = val;
      shadowHistory.push({
        color: _shadowColor,
        offsetX: _shadowOffsetX,
        offsetY: _shadowOffsetY,
        blur: _shadowBlur,
      });
      calls.push(`shadowColor:${val}`);
    },
    get shadowOffsetX() {
      return _shadowOffsetX;
    },
    set shadowOffsetX(val: number) {
      _shadowOffsetX = val;
    },
    get shadowOffsetY() {
      return _shadowOffsetY;
    },
    set shadowOffsetY(val: number) {
      _shadowOffsetY = val;
    },
    get shadowBlur() {
      return _shadowBlur;
    },
    set shadowBlur(val: number) {
      _shadowBlur = val;
    },
    globalCompositeOperation: 'source-over',
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

  return { canvas, ctx: mockCtx, calls, shadowHistory };
}

describe('Fase 5.2 - Efectos de Sombra Paralela (Drop Shadow)', () => {
  describe('1. Comparador isDropShadowEqual', () => {
    it('reconoce igualdad cuando ambos son nulos o undefined', () => {
      assert.equal(isDropShadowEqual(undefined, undefined), true);
      assert.equal(isDropShadowEqual(null, null), true);
      assert.equal(isDropShadowEqual(undefined, null), true);
      assert.equal(isDropShadowEqual(null, undefined), true);
    });

    it('detecta diferencias si uno es nulo y otro no', () => {
      const sh: DropShadow = { color: '#000000', offsetX: 0, offsetY: 4, blur: 8 };
      assert.equal(isDropShadowEqual(sh, null), false);
      assert.equal(isDropShadowEqual(undefined, sh), false);
    });

    it('compara todas las propiedades correctamente (color, opacidad, offsets, blur)', () => {
      const a: DropShadow = { color: '#112233', opacity: 0.8, offsetX: 5, offsetY: 10, blur: 12 };
      const b: DropShadow = { color: '#112233', opacity: 0.8, offsetX: 5, offsetY: 10, blur: 12 };
      assert.equal(isDropShadowEqual(a, b), true);

      // Distinto color
      assert.equal(isDropShadowEqual(a, { ...b, color: '#000000' }), false);
      // Distinta opacidad
      assert.equal(isDropShadowEqual(a, { ...b, opacity: 0.5 }), false);
      // Distinto offsetX
      assert.equal(isDropShadowEqual(a, { ...b, offsetX: 6 }), false);
      // Distinto offsetY
      assert.equal(isDropShadowEqual(a, { ...b, offsetY: 9 }), false);
      // Distinto blur
      assert.equal(isDropShadowEqual(a, { ...b, blur: 20 }), false);
    });

    it('asume opacidad 1 por defecto al comparar si no está definida', () => {
      const a: DropShadow = { color: '#000000', offsetX: 2, offsetY: 2, blur: 4 };
      const b: DropShadow = { color: '#000000', opacity: 1, offsetX: 2, offsetY: 2, blur: 4 };
      assert.equal(isDropShadowEqual(a, b), true);
    });
  });

  describe('2. Expansión geométrica AABB y visual bounds', () => {
    const baseAABB = { minX: 100, minY: 100, maxX: 300, maxY: 250, width: 200, height: 150 };

    it('retorna la misma caja si no hay sombra o es transparente con blur 0', () => {
      const expanded1 = expandAABBWithShadow(baseAABB, null);
      assert.deepEqual(expanded1, baseAABB);

      const expanded2 = expandAABBWithShadow(baseAABB, undefined);
      assert.deepEqual(expanded2, baseAABB);
    });

    it('expande la caja considerando desplazamientos positivos y radio de desenfoque', () => {
      const shadow: DropShadow = { color: '#000000', offsetX: 10, offsetY: 15, blur: 6 };
      const expanded = expandAABBWithShadow(baseAABB, shadow);

      // minX: min(100, 100 + 10 - 6) = 100
      // minY: min(100, 100 + 15 - 6) = 100
      // maxX: max(300, 300 + 10 + 6) = 316
      // maxY: max(250, 250 + 15 + 6) = 271
      assert.equal(expanded.minX, 100);
      assert.equal(expanded.minY, 100);
      assert.equal(expanded.maxX, 316);
      assert.equal(expanded.maxY, 271);
      assert.equal(expanded.width, 216);
      assert.equal(expanded.height, 171);
    });

    it('expande hacia arriba e izquierda con desplazamientos negativos', () => {
      const shadow: DropShadow = { color: '#000000', offsetX: -20, offsetY: -30, blur: 10 };
      const expanded = expandAABBWithShadow(baseAABB, shadow);

      // minX: min(100, 100 - 20 - 10) = 70
      // minY: min(100, 100 - 30 - 10) = 60
      // maxX: max(300, 300 - 20 + 10) = 300
      // maxY: max(250, 250 - 30 + 10) = 250
      assert.equal(expanded.minX, 70);
      assert.equal(expanded.minY, 60);
      assert.equal(expanded.maxX, 300);
      assert.equal(expanded.maxY, 250);
    });

    it('getShapeVisualAABB delega correctamente para figuras con sombra', () => {
      const shadow: DropShadow = { color: '#000000', offsetX: 15, offsetY: 25, blur: 10 };
      const rect = makeRect('r1', shadow);
      const visualAABB = getShapeVisualAABB(rect);

      assert.equal(visualAABB.minX, 100);
      assert.equal(visualAABB.minY, 100);
      assert.equal(visualAABB.maxX, 300 + 15 + 10);
      assert.equal(visualAABB.maxY, 250 + 25 + 10);
    });
  });

  describe('3. Índice Espacial (SpatialIndex) con Visual Bounds', () => {
    it('detecta figuras cuando la consulta interseca solo el halo de la sombra', () => {
      const shadow: DropShadow = { color: '#000000', offsetX: 50, offsetY: 50, blur: 20 };
      const rect = makeRect('r-shadow', shadow);
      const layer = makeLayer('l1', [rect]);
      const doc = makeDoc([layer]);

      const spatialIndex = new SpatialIndex();
      spatialIndex.buildFromDocument(doc);

      // Consulta en la zona donde solo llega la sombra: x: 330..360, y: 270..300
      // (el rectángulo termina en x: 300, y: 250)
      const shadowOnlyBox = { minX: 330, minY: 270, maxX: 360, maxY: 300, width: 30, height: 30 };
      const hits = spatialIndex.queryBox(shadowOnlyBox).map((item) => item.id);

      assert.equal(hits.includes('r-shadow'), true);
    });
  });

  describe('4. Gestión de Estado (StateManager)', () => {
    it('permite definir y recuperar dropShadow en DrawingStyle', () => {
      const doc = makeDoc([makeLayer('l1')]);
      const stateManager = new StateManager(doc);

      const shadow: DropShadow = { color: '#3b82f6', opacity: 0.75, offsetX: 2, offsetY: 6, blur: 10 };
      stateManager.setDrawingStyle({ dropShadow: shadow });

      assert.deepEqual(stateManager.getDrawingStyle().dropShadow, shadow);
    });

    it('aplica dropShadow a figuras seleccionadas con inmutabilidad estricta', () => {
      const rect = makeRect('r1', null);
      const layer = makeLayer('l1', [rect]);
      const doc = makeDoc([layer]);

      const stateManager = new StateManager(doc);
      const shadow: DropShadow = { color: '#10b981', opacity: 0.9, offsetX: 4, offsetY: 4, blur: 8 };

      stateManager.updateShapesStyle([{ id: 'r1', style: { dropShadow: shadow } }]);

      const updated = stateManager.findNode('r1') as Rectangle;
      assert.deepEqual(updated.dropShadow, shadow);
      assert.equal(Object.isFrozen(updated), true);
    });

    it('elimina la propiedad dropShadow cuando se actualiza con null', () => {
      const shadow: DropShadow = { color: '#000000', offsetX: 4, offsetY: 4, blur: 8 };
      const rect = makeRect('r1', shadow);
      const layer = makeLayer('l1', [rect]);
      const doc = makeDoc([layer]);

      const stateManager = new StateManager(doc);
      stateManager.updateShapesStyle([{ id: 'r1', style: { dropShadow: null } }]);

      const updated = stateManager.findNode('r1') as Rectangle;
      assert.equal(updated.dropShadow, undefined);
    });
  });

  describe('5. Historial Undo/Redo con StyleShapesCommand', () => {
    it('registra, deshace y rehace la aplicación de dropShadow', () => {
      const rect = makeRect('r1', null);
      const layer = makeLayer('l1', [rect]);
      const doc = makeDoc([layer]);

      const stateManager = new StateManager(doc);
      const commandManager = new CommandManager();

      const shadow: DropShadow = { color: '#ef4444', opacity: 0.6, offsetX: 0, offsetY: 8, blur: 16 };

      const command = new StyleShapesCommand(stateManager, [
        {
          id: 'r1',
          before: { dropShadow: null },
          after: { dropShadow: shadow },
        },
      ]);

      command.execute();
      commandManager.recordCommand(command);

      const afterExec = stateManager.findNode('r1') as Rectangle;
      assert.deepEqual(afterExec.dropShadow, shadow);

      // Deshacer
      commandManager.undo();
      const afterUndo = stateManager.findNode('r1') as Rectangle;
      assert.equal(afterUndo.dropShadow, undefined);

      // Rehacer
      commandManager.redo();
      const afterRedo = stateManager.findNode('r1') as Rectangle;
      assert.deepEqual(afterRedo.dropShadow, shadow);
    });
  });

  describe('6. Renderizado Canvas 2D en RenderEngine', () => {
    it('aplica shadowColor, shadowOffsetX, shadowOffsetY y shadowBlur al renderizar figura con sombra', () => {
      const shadow: DropShadow = { color: '#000000', opacity: 0.5, offsetX: 4, offsetY: 6, blur: 10 };
      const rect = makeRect('r1', shadow, '#ff0000', 'none');
      const layer = makeLayer('l1', [rect]);
      const doc = makeDoc([layer]);

      const stateManager = new StateManager(doc);
      const { canvas, ctx } = createMockCanvas();
      const viewportManager = new ViewportManager();
      const renderEngine = new RenderEngine(canvas, stateManager, { viewportManager });

      renderEngine.render();

      assert.equal(ctx.shadowOffsetX, 4);
      assert.equal(ctx.shadowOffsetY, 6);
      assert.equal(ctx.shadowBlur, 10);
    });

    it('evita artefactos de doble sombra limpiando la sombra tras el fill si existe stroke', () => {
      const shadow: DropShadow = { color: '#000000', opacity: 1, offsetX: 5, offsetY: 5, blur: 8 };
      // Rectángulo con relleno Y contorno
      const rect = makeRect('r1', shadow, '#ff0000', '#000000');
      const layer = makeLayer('l1', [rect]);
      const doc = makeDoc([layer]);

      const stateManager = new StateManager(doc);
      const { canvas, calls } = createMockCanvas();
      const viewportManager = new ViewportManager();
      const renderEngine = new RenderEngine(canvas, stateManager, { viewportManager });

      renderEngine.render();

      // Buscar cuándo se ejecutó fill y stroke
      const fillCall = calls.find((c) => c.startsWith('fill'));
      const strokeCall = calls.find((c) => c.startsWith('stroke'));

      assert.ok(fillCall, 'Debe haber llamado a fill()');
      assert.ok(strokeCall, 'Debe haber llamado a stroke()');

      // En el momento de stroke, shadowBlur debe ser 0 o shadowColor transparente
      assert.ok(
        strokeCall.includes('blur:0') || strokeCall.includes('shadow:transparent'),
        `El stroke no debe duplicar la sombra: ${strokeCall}`
      );
    });
  });

  describe('7. Exportación SVG con <feDropShadow>', () => {
    it('emite <filter id="shadow-..."> con <feDropShadow> en <defs> y filter="url(...)" en el elemento', () => {
      const shadow: DropShadow = { color: '#2563eb', opacity: 0.8, offsetX: 6, offsetY: 8, blur: 12 };
      const rect = makeRect('r-export', shadow);
      const layer = makeLayer('l1', [rect]);
      const doc = makeDoc([layer]);

      const svg = exportDocumentToSvg(doc);

      // Debe incluir <defs>
      assert.equal(svg.includes('<defs>'), true);
      // Debe incluir el filtro feDropShadow
      assert.equal(svg.includes('<filter id="shadow-r-export"'), true);
      assert.equal(svg.includes('dx="6"'), true);
      assert.equal(svg.includes('dy="8"'), true);
      // stdDeviation = blur / 2 = 6
      assert.equal(svg.includes('stdDeviation="6"'), true);
      assert.equal(svg.includes('flood-color="#2563eb"'), true);
      assert.equal(svg.includes('flood-opacity="0.8"'), true);
      // El elemento debe tener el atributo filter
      assert.equal(svg.includes('filter="url(#shadow-r-export)"'), true);
    });
  });

  describe('8. Importación SVG con filtros de sombra y CSS drop-shadow', () => {
    it('importa y decodifica correctamente <feDropShadow> vinculado por filter="url(#...)"', () => {
      const svgText = `
        <svg viewBox="0 0 400 300" width="400" height="300" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <filter id="my-shadow" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="4" dy="6" stdDeviation="5" flood-color="#ff00ff" flood-opacity="0.75" />
            </filter>
          </defs>
          <rect id="rect-import" x="50" y="50" width="100" height="80" fill="#00ffff" filter="url(#my-shadow)" />
        </svg>
      `;

      const result = parseSvgString(svgText);
      assert.equal(result.success, true);
      assert.equal(result.shapes.length, 1);

      const importedRect = result.shapes[0] as Rectangle;
      assert.ok(importedRect.dropShadow);
      assert.equal(importedRect.dropShadow.offsetX, 4);
      assert.equal(importedRect.dropShadow.offsetY, 6);
      // blur = stdDeviation * 2 = 10
      assert.equal(importedRect.dropShadow.blur, 10);
      assert.equal(importedRect.dropShadow.color, '#ff00ff');
      assert.equal(importedRect.dropShadow.opacity, 0.75);
    });

    it('importa estilos inline CSS filter: drop-shadow(...)', () => {
      const svgText = `
        <svg viewBox="0 0 400 300" width="400" height="300" xmlns="http://www.w3.org/2000/svg">
          <rect id="rect-css-shadow" x="20" y="20" width="80" height="60" fill="#10b981" style="filter: drop-shadow(5px 10px 8px #1e293b);" />
        </svg>
      `;

      const result = parseSvgString(svgText);
      assert.equal(result.success, true);

      const importedRect = result.shapes[0] as Rectangle;
      assert.ok(importedRect.dropShadow);
      assert.equal(importedRect.dropShadow.offsetX, 5);
      assert.equal(importedRect.dropShadow.offsetY, 10);
      assert.equal(importedRect.dropShadow.blur, 8);
      assert.equal(importedRect.dropShadow.color, '#1e293b');
    });
  });

  describe('9. Exportación Ráster (renderDocumentToCanvas)', () => {
    it('aplica las propiedades de sombra en el contexto de exportación ráster', () => {
      const originalCreateElement = (globalThis as any).document?.createElement;
      const { canvas, ctx } = createMockCanvas();

      (globalThis as any).document = {
        createElement: (tag: string) => {
          if (tag === 'canvas') return canvas;
          return {};
        },
      };

      try {
        const shadow: DropShadow = { color: '#000000', opacity: 0.5, offsetX: 8, offsetY: 12, blur: 16 };
        const rect = makeRect('r-raster', shadow);
        const layer = makeLayer('l1', [rect]);
        const doc = makeDoc([layer]);

        renderDocumentToCanvas(doc);

        assert.equal(ctx.shadowOffsetX, 8);
        assert.equal(ctx.shadowOffsetY, 12);
        assert.equal(ctx.shadowBlur, 16);
      } finally {
        if (originalCreateElement) {
          (globalThis as any).document.createElement = originalCreateElement;
        } else {
          delete (globalThis as any).document;
        }
      }
    });
  });

  describe('10. Panel de Propiedades y Controladores UI', () => {
    class MockDomElement {
      value: string = '';
      checked: boolean = false;
      indeterminate: boolean = false;
      style: Record<string, string> = {};
      listeners: Map<string, Array<(e?: any) => void>> = new Map();

      addEventListener(event: string, fn: (e?: any) => void) {
        if (!this.listeners.has(event)) {
          this.listeners.set(event, []);
        }
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
    }

    it('sincroniza controles de sombra con la selección y conmuta visibilidad', () => {
      const checkDropShadow = new MockDomElement();
      const groupDropShadowControls = new MockDomElement();
      const inputShadowColor = new MockDomElement();
      const inputShadowHex = new MockDomElement();
      const swatchShadowPreview = new MockDomElement();
      const inputShadowOpacity = new MockDomElement();
      const inputShadowOpacityValue = new MockDomElement();
      const inputShadowOffsetX = new MockDomElement();
      const inputShadowOffsetY = new MockDomElement();
      const inputShadowBlur = new MockDomElement();

      const mockElements: Record<string, any> = {
        '#check-drop-shadow': checkDropShadow,
        '#group-drop-shadow-controls': groupDropShadowControls,
        '#input-shadow-color': inputShadowColor,
        '#input-shadow-hex': inputShadowHex,
        '#swatch-shadow-preview': swatchShadowPreview,
        '#input-shadow-opacity': inputShadowOpacity,
        '#input-shadow-opacity-value': inputShadowOpacityValue,
        '#input-shadow-offset-x': inputShadowOffsetX,
        '#input-shadow-offset-y': inputShadowOffsetY,
        '#input-shadow-blur': inputShadowBlur,
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
        const shadow: DropShadow = { color: '#334455', opacity: 0.6, offsetX: 5, offsetY: 7, blur: 14 };
        const rect1 = makeRect('r1', shadow);
        const rect2 = makeRect('r2', null);
        const layer = makeLayer('l1', [rect1, rect2]);
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

        // 1. Sincronizar sin selección
        controller.syncPropertiesPanel();
        assert.equal(checkDropShadow.checked, false);
        assert.equal(groupDropShadowControls.style.display, 'none');

        // 2. Seleccionar figura con sombra
        stateManager.setSelection(['r1']);
        controller.syncPropertiesPanel(stateManager.getSelectedNodes());

        assert.equal(checkDropShadow.checked, true);
        assert.equal(groupDropShadowControls.style.display, 'flex');
        assert.equal(inputShadowHex.value, '#334455');
        assert.equal(inputShadowOpacity.value, '60');
        assert.equal(inputShadowOffsetX.value, '5');
        assert.equal(inputShadowOffsetY.value, '7');
        assert.equal(inputShadowBlur.value, '14');

        // 3. Modificar desenfoque mediante input
        inputShadowBlur.value = '20';
        inputShadowBlur.trigger('change');

        const updatedRect = stateManager.findNode('r1') as Rectangle;
        assert.equal(updatedRect.dropShadow?.blur, 20);

        // 4. Deshacer
        assert.equal(commandManager.canUndo(), true);
        commandManager.undo();
        const revertedRect = stateManager.findNode('r1') as Rectangle;
        assert.equal(revertedRect.dropShadow?.blur, 14);

        // 5. Desmarcar checkbox de sombra
        checkDropShadow.checked = false;
        checkDropShadow.trigger('change');

        const disabledShadowRect = stateManager.findNode('r1') as Rectangle;
        assert.equal(disabledShadowRect.dropShadow, undefined);

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
