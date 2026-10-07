import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { serializeDocument, parseDocument, DocumentParseError } from '../src/state/Serializer.ts';
import type { Document, Group, Text, Rectangle, Ellipse, Path } from '../src/types/scene-graph.ts';

describe('Serialización de nodos Text (Exportar / Importar)', () => {
  it('1. Exporta e importa un documento con nodo Text conservando exactamente todas sus propiedades', async () => {
    const textNode: Text = {
      id: 'text-full',
      type: 'text',
      name: 'Titular Principal',
      x: 120,
      y: 240,
      text: 'Diseño Vectorial TypeScript',
      fontFamily: 'Inter',
      fontSize: 48,
      fontWeight: 700,
      fontStyle: 'italic',
      textAlign: 'center',
      fill: '#38bdf8',
      rotation: 30,
      opacity: 0.85,
      visible: true,
      locked: false,
      zIndex: 2,
    };

    const doc: Document = {
      id: 'doc-text-test',
      type: 'document',
      name: 'Documento Texto',
      width: 1920,
      height: 1080,
      children: [
        {
          id: 'layer-1',
          type: 'layer',
          name: 'Capa 1',
          children: [textNode],
        },
      ],
    };

    // 1. Exportar a JSON
    const json = serializeDocument(doc);
    assert.equal(typeof json, 'string');
    assert.ok(json.includes('"type": "text"'));
    assert.ok(json.includes('"text": "Diseño Vectorial TypeScript"'));

    // 2. Importar desde JSON
    const importedDoc = await parseDocument(json);

    // 3, 4, 5, 6. Comprobaciones de fidelidad exacta
    assert.equal(importedDoc.children[0].children.length, 1);
    const importedText = importedDoc.children[0].children[0] as Text;

    assert.equal(importedText.id, 'text-full');
    assert.equal(importedText.type, 'text');
    assert.equal(importedText.name, 'Titular Principal');
    assert.equal(importedText.x, 120, 'Debe conservar la posición x');
    assert.equal(importedText.y, 240, 'Debe conservar la posición y');
    assert.equal(importedText.text, 'Diseño Vectorial TypeScript', 'Debe conservar el contenido text');
    assert.equal(importedText.fontFamily, 'Inter', 'Debe conservar fontFamily');
    assert.equal(importedText.fontSize, 48, 'Debe conservar fontSize');
    assert.equal(importedText.fontWeight, 700, 'Debe conservar fontWeight');
    assert.equal(importedText.fontStyle, 'italic', 'Debe conservar fontStyle');
    assert.equal(importedText.textAlign, 'center', 'Debe conservar textAlign');
    assert.equal(importedText.fill, '#38bdf8', 'Debe conservar color de relleno (fill)');
    assert.equal(importedText.rotation, 30, 'Debe conservar rotation');
    assert.equal(importedText.opacity, 0.85, 'Debe conservar opacity');
    assert.equal(importedText.visible, true);
    assert.equal(importedText.locked, false);
    assert.equal(importedText.zIndex, 2);
  });

  it('2. Conserva nodos Text dentro de múltiples Layers', async () => {
    const textLayer1: Text = {
      id: 'text-layer-1',
      type: 'text',
      name: 'Texto Capa 1',
      x: 10,
      y: 20,
      text: 'Capa Uno',
      fontFamily: 'Arial',
      fontSize: 24,
      fontWeight: 'bold',
      fontStyle: 'normal',
      textAlign: 'left',
      fill: '#10b981',
    };

    const textLayer2: Text = {
      id: 'text-layer-2',
      type: 'text',
      name: 'Texto Capa 2',
      x: 50,
      y: 80,
      text: 'Capa Dos',
      fontFamily: 'Georgia',
      fontSize: 36,
      fontWeight: 400,
      fontStyle: 'italic',
      textAlign: 'right',
      fill: '#f59e0b',
    };

    const doc: Document = {
      id: 'doc-multi-layer',
      type: 'document',
      name: 'Multi Layer Doc',
      width: 800,
      height: 600,
      children: [
        {
          id: 'layer-a',
          type: 'layer',
          name: 'Capa A',
          children: [textLayer1],
        },
        {
          id: 'layer-b',
          type: 'layer',
          name: 'Capa B',
          children: [textLayer2],
        },
      ],
    };

    const json = serializeDocument(doc);
    const imported = await parseDocument(json);

    assert.equal(imported.children.length, 2);
    const importedL1 = imported.children[0].children[0] as Text;
    const importedL2 = imported.children[1].children[0] as Text;

    assert.equal(importedL1.id, 'text-layer-1');
    assert.equal(importedL1.text, 'Capa Uno');
    assert.equal(importedL1.fontFamily, 'Arial');
    assert.equal(importedL1.fontSize, 24);
    assert.equal(importedL1.fontWeight, 'bold');
    assert.equal(importedL1.fill, '#10b981');

    assert.equal(importedL2.id, 'text-layer-2');
    assert.equal(importedL2.text, 'Capa Dos');
    assert.equal(importedL2.fontFamily, 'Georgia');
    assert.equal(importedL2.fontSize, 36);
    assert.equal(importedL2.fontWeight, 400);
    assert.equal(importedL2.fill, '#f59e0b');
  });

  it('3. Conserva nodos Text dentro de Groups y grupos anidados', async () => {
    const textInGroup: Text = {
      id: 'text-in-grp',
      type: 'text',
      name: 'Texto Grupo',
      x: 200,
      y: 150,
      text: 'Elemento Agrupado',
      fontFamily: 'Inter',
      fontSize: 16,
      fontWeight: 500,
      fontStyle: 'normal',
      textAlign: 'left',
      fill: '#ffffff',
    };

    const textNested: Text = {
      id: 'text-nested',
      type: 'text',
      name: 'Texto Anidado',
      x: 300,
      y: 250,
      text: 'Elemento Sub-Agrupado',
      fontFamily: 'Roboto',
      fontSize: 20,
      fontWeight: 600,
      fontStyle: 'normal',
      textAlign: 'center',
      fill: '#a855f7',
    };

    const rectSibling: Rectangle = {
      id: 'rect-sibling',
      type: 'rectangle',
      name: 'Fondo Grupo',
      x: 180,
      y: 130,
      width: 250,
      height: 80,
      fill: '#1e293b',
    };

    const subGroup: Group = {
      id: 'subgroup-1',
      type: 'group',
      name: 'Subgrupo',
      children: [textNested],
    };

    const mainGroup: Group = {
      id: 'main-group',
      type: 'group',
      name: 'Grupo Principal',
      children: [rectSibling, textInGroup, subGroup],
    };

    const doc: Document = {
      id: 'doc-groups-text',
      type: 'document',
      name: 'Doc Con Grupos y Texto',
      width: 1000,
      height: 800,
      children: [
        {
          id: 'layer-root',
          type: 'layer',
          name: 'Capa Base',
          children: [mainGroup],
        },
      ],
    };

    const json = serializeDocument(doc);
    const imported = await parseDocument(json);

    const importedMain = imported.children[0].children[0] as Group;
    assert.equal(importedMain.id, 'main-group');
    assert.equal(importedMain.children.length, 3);

    const importedTextInGrp = importedMain.children[1] as Text;
    assert.equal(importedTextInGrp.id, 'text-in-grp');
    assert.equal(importedTextInGrp.type, 'text');
    assert.equal(importedTextInGrp.x, 200);
    assert.equal(importedTextInGrp.y, 150);
    assert.equal(importedTextInGrp.text, 'Elemento Agrupado');
    assert.equal(importedTextInGrp.fill, '#ffffff');

    const importedSub = importedMain.children[2] as Group;
    assert.equal(importedSub.id, 'subgroup-1');
    assert.equal(importedSub.children.length, 1);

    const importedNestedText = importedSub.children[0] as Text;
    assert.equal(importedNestedText.id, 'text-nested');
    assert.equal(importedNestedText.type, 'text');
    assert.equal(importedNestedText.x, 300);
    assert.equal(importedNestedText.y, 250);
    assert.equal(importedNestedText.text, 'Elemento Sub-Agrupado');
    assert.equal(importedNestedText.fill, '#a855f7');
  });

  it('4. Mantiene total compatibilidad con documentos existentes que no contienen Text', async () => {
    const rect: Rectangle = {
      id: 'rect-only',
      type: 'rectangle',
      name: 'Rect',
      x: 10,
      y: 10,
      width: 100,
      height: 50,
      fill: '#ef4444',
      stroke: '#000000',
      strokeWidth: 2,
    };
    const ellipse: Ellipse = {
      id: 'ellipse-only',
      type: 'ellipse',
      name: 'Ellipse',
      x: 200,
      y: 100,
      radiusX: 50,
      radiusY: 30,
      fill: '#3b82f6',
    };
    const path: Path = {
      id: 'path-only',
      type: 'path',
      name: 'Path',
      x: 0,
      y: 0,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ],
      closed: false,
      stroke: '#22c55e',
      strokeWidth: 3,
    };

    const docWithoutText: Document = {
      id: 'doc-legacy',
      type: 'document',
      name: 'Doc Sin Texto',
      width: 800,
      height: 600,
      children: [
        {
          id: 'layer-legacy',
          type: 'layer',
          name: 'Capa Legacy',
          children: [rect, ellipse, path],
        },
      ],
    };

    const json = serializeDocument(docWithoutText);
    const imported = await parseDocument(json);

    assert.equal(imported.id, 'doc-legacy');
    assert.equal(imported.children[0].children.length, 3);
    assert.equal(imported.children[0].children[0].type, 'rectangle');
    assert.equal(imported.children[0].children[1].type, 'ellipse');
    assert.equal(imported.children[0].children[2].type, 'path');
  });

  it('5. Elimina propiedades transitorias (isDirty, selected) de nodos Text al serializar y parsear', async () => {
    const rawJson = JSON.stringify({
      id: 'doc-transient',
      type: 'document',
      name: 'Doc Transitorio',
      width: 500,
      height: 500,
      isDirty: true,
      selected: ['text-t'],
      children: [
        {
          id: 'layer-t',
          type: 'layer',
          name: 'Capa T',
          isDirty: true,
          selected: false,
          children: [
            {
              id: 'text-t',
              type: 'text',
              name: 'Texto T',
              x: 10,
              y: 10,
              text: 'Prueba',
              isDirty: true,
              selected: true,
            },
          ],
        },
      ],
    });

    const parsed = await parseDocument(rawJson);
    const textNode = parsed.children[0].children[0] as Text;

    assert.equal((parsed as any).isDirty, undefined);
    assert.equal((parsed as any).selected, undefined);
    assert.equal((parsed.children[0] as any).isDirty, undefined);
    assert.equal((parsed.children[0] as any).selected, undefined);
    assert.equal((textNode as any).isDirty, undefined);
    assert.equal((textNode as any).selected, undefined);

    const exported = serializeDocument(parsed);
    assert.ok(!exported.includes('"isDirty"'));
    assert.ok(!exported.includes('"selected"'));
  });

  it('6. Integración con StateManager: carga estado serializado con loadState', async () => {
    const manager = new StateManager();
    const textNode: Text = {
      id: 'text-mgr',
      type: 'text',
      name: 'Texto Manager',
      x: 75,
      y: 85,
      text: 'Texto en StateManager',
      fontFamily: 'Inter',
      fontSize: 32,
      fontWeight: 400,
      fontStyle: 'normal',
      textAlign: 'left',
      fill: '#4f46e5',
    };
    manager.addShape(manager.getState().children[0].id, textNode);

    const serialized = serializeDocument(manager.getState());
    const parsed = await parseDocument(serialized);

    const newManager = new StateManager();
    newManager.loadState(parsed);

    const found = newManager.findNode('text-mgr') as Text;
    assert.ok(found);
    assert.equal(found.type, 'text');
    assert.equal(found.text, 'Texto en StateManager');
    assert.equal(found.fill, '#4f46e5');
    assert.equal(found.fontSize, 32);
    assert.equal(newManager.isDirty, true, 'loadState debe marcar dirty para forzar re-render');
  });

  it('7. Valida errores estructurales específicos para nodo Text', async () => {
    // Falta x o no es finito
    const invalidX = JSON.stringify({
      id: 'doc-err',
      type: 'document',
      name: 'Err',
      width: 100,
      height: 100,
      children: [
        {
          id: 'l-1',
          type: 'layer',
          name: 'L1',
          children: [
            {
              id: 't-1',
              type: 'text',
              name: 'T',
              x: 'no-es-numero',
              y: 10,
              text: 'Hola',
            },
          ],
        },
      ],
    });
    await assert.rejects(
      async () => await parseDocument(invalidX),
      (err: unknown) => {
        assert.ok(err instanceof DocumentParseError);
        assert.match((err as Error).message, /\.x debe ser un número finito/);
        return true;
      }
    );

    // text no es un string
    const invalidText = JSON.stringify({
      id: 'doc-err',
      type: 'document',
      name: 'Err',
      width: 100,
      height: 100,
      children: [
        {
          id: 'l-1',
          type: 'layer',
          name: 'L1',
          children: [
            {
              id: 't-1',
              type: 'text',
              name: 'T',
              x: 10,
              y: 10,
              text: 12345,
            },
          ],
        },
      ],
    });
    await assert.rejects(
      async () => await parseDocument(invalidText),
      (err: unknown) => {
        assert.ok(err instanceof DocumentParseError);
        assert.match((err as Error).message, /\.text debe ser un string/);
        return true;
      }
    );

    // fontSize inválido (negativo o no finito)
    const invalidFontSize = JSON.stringify({
      id: 'doc-err',
      type: 'document',
      name: 'Err',
      width: 100,
      height: 100,
      children: [
        {
          id: 'l-1',
          type: 'layer',
          name: 'L1',
          children: [
            {
              id: 't-1',
              type: 'text',
              name: 'T',
              x: 10,
              y: 10,
              text: 'Hola',
              fontSize: -10,
            },
          ],
        },
      ],
    });
    await assert.rejects(
      async () => await parseDocument(invalidFontSize),
      (err: unknown) => {
        assert.ok(err instanceof DocumentParseError);
        assert.match((err as Error).message, /\.fontSize debe ser un número finito positivo/);
        return true;
      }
    );

    // textAlign inválido
    const invalidTextAlign = JSON.stringify({
      id: 'doc-err',
      type: 'document',
      name: 'Err',
      width: 100,
      height: 100,
      children: [
        {
          id: 'l-1',
          type: 'layer',
          name: 'L1',
          children: [
            {
              id: 't-1',
              type: 'text',
              name: 'T',
              x: 10,
              y: 10,
              text: 'Hola',
              textAlign: 'justify-invalid',
            },
          ],
        },
      ],
    });
    await assert.rejects(
      async () => await parseDocument(invalidTextAlign),
      (err: unknown) => {
        assert.ok(err instanceof DocumentParseError);
        assert.match((err as Error).message, /\.textAlign debe ser 'left', 'center' o 'right'/);
        return true;
      }
    );
  });
});
