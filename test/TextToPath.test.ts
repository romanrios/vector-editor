import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { Document, Text } from '../src/types/scene-graph.ts';
import {
  resolveFontPath,
  loadFont,
  parseFontWeight,
  convertTextToPaths,
  convertTextToGroup,
  convertDocumentTextToCurves,
} from '../src/utils/textToPath.ts';
import { ConvertTextToCurvesCommand } from '../src/commands/ConvertTextToCurvesCommand.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { StateManager } from '../src/state/StateManager.ts';
import { InputController } from '../src/input/InputController.ts';

describe('Text to Curves (Vectorización de tipografía)', () => {
  it('resolveFontPath resuelve rutas válidas para fuentes locales y del sistema', () => {
    assert.strictEqual(resolveFontPath('Inter', 400, 'normal'), 'fonts/inter/InterVariable.ttf');
    assert.strictEqual(resolveFontPath('Inter', 700, 'italic'), 'fonts/inter/InterVariable-Italic.ttf');
    assert.strictEqual(resolveFontPath('Montserrat', 400, 'normal'), 'fonts/montserrat/Montserrat[wght].ttf');
    assert.strictEqual(resolveFontPath('Arial', 400, 'normal'), 'fonts/inter/InterVariable.ttf');
    assert.strictEqual(resolveFontPath('Georgia', 400, 'normal'), 'fonts/merriweather/merriweather-latin-wght-normal.ttf');
    assert.strictEqual(resolveFontPath('Courier New', 400, 'normal'), 'fonts/roboto-mono/roboto-mono-latin-wght-normal.ttf');
    assert.strictEqual(resolveFontPath('Poppins', 600, 'normal'), 'fonts/poppins/poppins-latin-600-normal.woff');
  });

  it('loadFont carga y parsea correctamente fuentes locales TrueType y OpenType', async () => {
    const font = await loadFont('Inter', 400, 'normal');
    assert.ok(font);
    assert.strictEqual(font.unitsPerEm, 2048);
  });

  it('convertTextToPaths genera trazados Path vectoriales con curvas de Bézier', async () => {
    const textNode: Text = {
      id: 'text-1',
      name: 'Mi Título',
      type: 'text',
      x: 100,
      y: 150,
      text: 'ABC',
      fontSize: 32,
      fontFamily: 'Inter',
      fill: '#ff0000',
    };

    const paths = await convertTextToPaths(textNode);
    assert.strictEqual(paths.length, 3);

    const first = paths[0];
    assert.strictEqual(first.type, 'path');
    assert.strictEqual(first.fill, '#ff0000');
    assert.strictEqual(first.closed, true);
    assert.strictEqual(first.fillRule, 'nonzero');
    assert.ok(first.points.length > 5);
    // Verificar que los puntos tienen coordenadas cerca de (100, 150)
    assert.ok(first.points.every((pt) => pt.x >= 95 && pt.y >= 140));
  });

  it('parseFontWeight normaliza valores numéricos y nombres comunes de peso', () => {
    assert.strictEqual(parseFontWeight('normal'), 400);
    assert.strictEqual(parseFontWeight('bold'), 700);
    assert.strictEqual(parseFontWeight('bolder'), 700);
    assert.strictEqual(parseFontWeight('lighter'), 300);
    assert.strictEqual(parseFontWeight(700), 700);
    assert.strictEqual(parseFontWeight('900'), 900);
    assert.strictEqual(parseFontWeight('100'), 100);
    assert.strictEqual(parseFontWeight(1200), 900); // clamped max
    assert.strictEqual(parseFontWeight(50), 100);   // clamped min
    assert.strictEqual(parseFontWeight(undefined), 400);
  });

  it('convertTextToPaths preserva fielmente el peso tipográfico (fontWeight) en fuentes variables', async () => {
    const textRegular: Text = {
      id: 'text-reg',
      name: 'Regular',
      type: 'text',
      x: 0,
      y: 100,
      text: 'B',
      fontSize: 48,
      fontFamily: 'Inter',
      fontWeight: 400,
    };

    const textBold: Text = {
      id: 'text-bold',
      name: 'Bold',
      type: 'text',
      x: 0,
      y: 100,
      text: 'B',
      fontSize: 48,
      fontFamily: 'Inter',
      fontWeight: 700,
    };

    const pathsReg = await convertTextToPaths(textRegular);
    const pathsBold = await convertTextToPaths(textBold);

    assert.strictEqual(pathsReg.length, 1);
    assert.strictEqual(pathsBold.length, 1);

    // Calcular ancho de envolvente de cada glifo
    const ptsReg = pathsReg[0].points;
    const ptsBold = pathsBold[0].points;
    const widthReg = Math.max(...ptsReg.map((p) => p.x)) - Math.min(...ptsReg.map((p) => p.x));
    const widthBold = Math.max(...ptsBold.map((p) => p.x)) - Math.min(...ptsBold.map((p) => p.x));

    // El glifo en negrita (700) debe ser apreciablemente más ancho y grueso que el regular (400)
    assert.ok(
      widthBold > widthReg,
      `El glifo en negrita (${widthBold}px) debe ser más ancho que el regular (${widthReg}px)`
    );

    // Ambos deben usar fillRule: 'nonzero' para evitar agujeros transparentes en superposiciones
    assert.strictEqual(pathsReg[0].fillRule, 'nonzero');
    assert.strictEqual(pathsBold[0].fillRule, 'nonzero');
  });

  it('convertTextToPaths soporta spans con pesos tipográficos mixtos dentro de la misma línea', async () => {
    const textMixed: Text = {
      id: 'text-mixed',
      name: 'Mixed',
      type: 'text',
      x: 0,
      y: 50,
      text: 'AB',
      fontSize: 32,
      fontFamily: 'Inter',
      fontWeight: 400,
      spans: [
        {
          start: 1,
          end: 2,
          fontWeight: 700,
        },
      ],
    };

    const paths = await convertTextToPaths(textMixed);
    assert.strictEqual(paths.length, 2);

    // El primer glifo ('A') tiene peso 400, el segundo ('B') tiene peso 700
    assert.strictEqual(paths[0].fillRule, 'nonzero');
    assert.strictEqual(paths[1].fillRule, 'nonzero');
  });

  it('convertTextToPaths respeta la rotación geométrica', async () => {
    const textNode: Text = {
      id: 'text-rot',
      name: 'Text Rot',
      type: 'text',
      x: 200,
      y: 200,
      text: 'H',
      fontSize: 40,
      fontFamily: 'Inter',
      rotation: 90,
    };

    const paths = await convertTextToPaths(textNode);
    assert.strictEqual(paths.length, 1);
    const glyph = paths[0];
    assert.strictEqual(glyph.type, 'path');
    assert.ok(glyph.points.length > 0);
  });

  it('convertTextToGroup agrupa los glifos conservando propiedades y metadatos', async () => {
    const textNode: Text = {
      id: 'text-group',
      name: 'Logo',
      type: 'text',
      x: 50,
      y: 80,
      text: 'Vectedit',
      fontSize: 24,
      fontFamily: 'Montserrat',
      fill: '#10b981',
      opacity: 0.85,
    };

    const group = await convertTextToGroup(textNode);
    assert.strictEqual(group.type, 'group');
    assert.strictEqual(group.name, 'Logo');
    assert.strictEqual(group.opacity, 0.85);
    assert.strictEqual(group.children.length, 8); // 'Vectedit' tiene 8 letras
  });

  it('convertDocumentTextToCurves reemplaza nodos Text por Groups vectoriales en todo el árbol', async () => {
    const doc: Document = {
      id: 'doc-1',
      type: 'document',
      name: 'Doc',
      width: 800,
      height: 600,
      children: [
        {
          id: 'layer-1',
          name: 'Capa 1',
          type: 'layer',
          children: [
            {
              id: 'text-doc',
              name: 'Text Doc',
              type: 'text',
              x: 10,
              y: 20,
              text: 'Hola',
              fontSize: 20,
              fontFamily: 'Inter',
            },
            {
              id: 'rect-1',
              name: 'Rect 1',
              type: 'rectangle',
              x: 100,
              y: 100,
              width: 50,
              height: 50,
            },
            {
              id: 'group-nested',
              name: 'Group Nested',
              type: 'group',
              children: [
                {
                  id: 'text-nested',
                  name: 'Text Nested',
                  type: 'text',
                  x: 30,
                  y: 40,
                  text: 'Mundo',
                  fontSize: 16,
                  fontFamily: 'Roboto',
                },
              ],
            },
          ],
        },
      ],
    };

    const outlined = await convertDocumentTextToCurves(doc);

    // Comprobar inmutabilidad: el documento original no fue modificado
    assert.strictEqual(doc.children[0].children[0].type, 'text');

    // Comprobar que en el clon resultante no hay ningún nodo Text
    const rootChild0 = outlined.children[0].children[0];
    assert.strictEqual(rootChild0.type, 'group');
    if (rootChild0.type === 'group') {
      assert.strictEqual(rootChild0.children.length, 4); // 'Hola'
    }

    const rootChild1 = outlined.children[0].children[1];
    assert.strictEqual(rootChild1.type, 'rectangle');

    const rootChild2 = outlined.children[0].children[2];
    assert.strictEqual(rootChild2.type, 'group');
    if (rootChild2.type === 'group') {
      const nestedChild = rootChild2.children[0];
      assert.strictEqual(nestedChild.type, 'group');
      if (nestedChild.type === 'group') {
        assert.strictEqual(nestedChild.children.length, 5); // 'Mundo'
      }
    }
  });

  it('ConvertTextToCurvesCommand reemplaza el nodo de texto y soporta Undo/Redo sincronizado', async () => {
    const textNode: Text = {
      id: 'text-cmd-1',
      name: 'Texto Hola',
      type: 'text',
      x: 10,
      y: 20,
      text: 'OK',
      fontSize: 24,
      fontFamily: 'Inter',
    };

    const initialDoc: Document = {
      id: 'doc-cmd',
      type: 'document',
      name: 'Doc',
      width: 500,
      height: 400,
      children: [
        {
          id: 'layer-1',
          name: 'Capa 1',
          type: 'layer',
          children: [textNode],
        },
      ],
    };

    const cmdManager = new CommandManager();
    const stateManager = new StateManager(initialDoc, cmdManager);

    const groupNode = await convertTextToGroup(textNode);
    const cmd = new ConvertTextToCurvesCommand(stateManager, textNode, groupNode);

    // Ejecutar
    cmdManager.executeCommand(cmd);

    const afterExec = stateManager.getState();
    assert.strictEqual(afterExec.children[0].children.length, 1);
    assert.strictEqual(afterExec.children[0].children[0].type, 'group');
    assert.strictEqual(stateManager.getSelection()[0], groupNode.id);

    // Undo
    cmdManager.undo();
    const afterUndo = stateManager.getState();
    assert.strictEqual(afterUndo.children[0].children.length, 1);
    assert.strictEqual(afterUndo.children[0].children[0].type, 'text');
    assert.strictEqual(stateManager.getSelection()[0], textNode.id);

    // Redo
    cmdManager.redo();
    const afterRedo = stateManager.getState();
    assert.strictEqual(afterRedo.children[0].children[0].type, 'group');
    assert.strictEqual(stateManager.getSelection()[0], groupNode.id);
  });

  it('InputController.convertTextToCurves convierte textos seleccionados y soporta selección múltiple con BatchCommand', async () => {
    const text1: Text = {
      id: 'text-multi-1',
      name: 'Text 1',
      type: 'text',
      x: 10,
      y: 10,
      text: 'A',
      fontSize: 20,
      fontFamily: 'Inter',
    };
    const text2: Text = {
      id: 'text-multi-2',
      name: 'Text 2',
      type: 'text',
      x: 50,
      y: 50,
      text: 'B',
      fontSize: 20,
      fontFamily: 'Inter',
    };

    const doc: Document = {
      id: 'doc-ctrl',
      type: 'document',
      name: 'Doc',
      width: 500,
      height: 400,
      children: [
        {
          id: 'layer-1',
          name: 'Capa 1',
          type: 'layer',
          children: [text1, text2],
        },
      ],
    };

    const cmdManager = new CommandManager();
    const stateManager = new StateManager(doc, cmdManager);
    const mockCanvas = {
      width: 500,
      height: 400,
      addEventListener: () => {},
      removeEventListener: () => {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 500, height: 400 }),
    } as any;

    const controller = new InputController(mockCanvas, stateManager, cmdManager, {
      enableKeyboardShortcuts: true,
    });

    // Seleccionar ambos textos
    stateManager.setSelection(['text-multi-1', 'text-multi-2']);

    const res = await controller.convertTextToCurves();
    assert.strictEqual(res, true);

    const state = stateManager.getState();
    assert.strictEqual(state.children[0].children[0].type, 'group');
    assert.strictEqual(state.children[0].children[1].type, 'group');

    // Comprobar que ambas figuras resultantes están seleccionadas
    assert.strictEqual(stateManager.getSelection().length, 2);

    // Undo debe revertir a los 2 textos en 1 solo paso (BatchCommand)
    cmdManager.undo();
    const undoneState = stateManager.getState();
    assert.strictEqual(undoneState.children[0].children[0].type, 'text');
    assert.strictEqual(undoneState.children[0].children[1].type, 'text');

    // Atajo Ctrl+Shift+O
    stateManager.setSelection(['text-multi-1']);
    controller.handleKeyDown({
      key: 'o',
      code: 'KeyO',
      ctrlKey: true,
      shiftKey: true,
      preventDefault: () => {},
    } as any);

    // Permitir ciclo microtask para completar conversión async
    await new Promise((r) => setTimeout(r, 50));

    const stateAfterShortcut = stateManager.getState();
    assert.strictEqual(stateAfterShortcut.children[0].children[0].type, 'group');
  });
});
