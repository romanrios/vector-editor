import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { injectSampleShapes } from '../src/state/injectSampleShapes.ts';
import { serializeDocument, downloadJson, parseDocument, DocumentParseError } from '../src/state/Serializer.ts';
import type { Document, Path } from '../src/types/scene-graph.ts';

describe('Serializer (serializeDocument & downloadJson)', () => {
  it('serializeDocument convierte el estado en JSON puro omitiendo propiedades computadas como isDirty', () => {
    const manager = new StateManager();
    injectSampleShapes(manager);

    const samplePath: Path = {
      id: 'path-test',
      type: 'path',
      name: 'Path Test',
      x: 50,
      y: 50,
      points: [
        { x: 50, y: 50, handleOut: { x: 70, y: 60 } },
        { x: 100, y: 100, handleIn: { x: 80, y: 90 } },
      ],
      closed: true,
      fill: '#ffffff',
      stroke: '#000000',
    };
    manager.addShape(manager.getState().children[0].id, samplePath);

    const docState = manager.getState();
    assert.equal(docState.isDirty, true, 'El documento original tiene isDirty = true');

    const jsonString = serializeDocument(docState);
    assert.equal(typeof jsonString, 'string');

    // Comprobar que no contiene isDirty en el JSON generado
    assert.ok(!jsonString.includes('"isDirty"'), 'El JSON no debe contener la propiedad isDirty');

    // Deserializar para comprobar fidelidad de datos
    const parsed = JSON.parse(jsonString) as Document;
    assert.equal(parsed.id, docState.id);
    assert.equal(parsed.type, 'document');
    assert.equal(parsed.children.length, docState.children.length);
    assert.equal(parsed.children[0].children.length, 4);

    const parsedPath = parsed.children[0].children.find((s) => s.id === 'path-test') as Path;
    assert.ok(parsedPath);
    assert.equal(parsedPath.points.length, 2);
    assert.equal(parsedPath.points[0].handleOut?.x, 70);
    assert.equal(parsedPath.closed, true);
    assert.equal((parsedPath as any).isDirty, undefined);
  });

  it('serializeDocument soporta formato compacto cuando pretty es false', () => {
    const manager = new StateManager();
    const compactJson = serializeDocument(manager.getState(), false);
    assert.ok(!compactJson.includes('\n'), 'No debe tener saltos de línea en modo compacto');
    const parsed = JSON.parse(compactJson);
    assert.equal(parsed.type, 'document');
  });

  it('downloadJson no falla en entornos no-navegador (donde window/document no existen)', () => {
    // En Node.js puro sin mocks de DOM, no debe arrojar ninguna excepción
    assert.doesNotThrow(() => {
      downloadJson('test.json', '{"test": true}');
    });
  });

  it('downloadJson crea Blob, elemento <a> oculto, simula clic y revoca URL en el navegador', () => {
    let createdBlobContent = '';
    let createdBlobType = '';
    let objectUrlCreated = false;
    let objectUrlRevoked = false;
    let clicked = false;
    let appended = false;
    let removed = false;

    // Mock de Blob y URL
    class MockBlob {
      constructor(parts: any[], options?: any) {
        createdBlobContent = parts.join('');
        createdBlobType = options?.type || '';
      }
    }

    const mockAnchor = {
      href: '',
      download: '',
      style: { display: '' },
      setAttribute: (_name: string, _val: string) => {},
      click: () => {
        clicked = true;
      },
    };

    const mockBody = {
      appendChild: (el: any) => {
        if (el === mockAnchor) appended = true;
      },
      removeChild: (el: any) => {
        if (el === mockAnchor) removed = true;
      },
    };

    (globalThis as any).Blob = MockBlob;
    (globalThis as any).URL = {
      createObjectURL: (_blob: any) => {
        objectUrlCreated = true;
        return 'blob:mock-url-123';
      },
      revokeObjectURL: (url: string) => {
        if (url === 'blob:mock-url-123') objectUrlRevoked = true;
      },
    };
    (globalThis as any).window = {};
    (globalThis as any).document = {
      createElement: (tag: string) => (tag === 'a' ? mockAnchor : {}),
      body: mockBody,
    };

    const testJson = '{"vector": "scene"}';
    downloadJson('my-scene', testJson);

    assert.equal(createdBlobContent, testJson);
    assert.equal(createdBlobType, 'application/json;charset=utf-8');
    assert.equal(mockAnchor.download, 'my-scene.json', 'Debe normalizar la extensión .json');
    assert.equal(mockAnchor.href, 'blob:mock-url-123');
    assert.equal(mockAnchor.style.display, 'none');
    assert.equal(appended, true);
    assert.equal(clicked, true);
    assert.equal(removed, true);
    assert.equal(objectUrlCreated, true);
    assert.equal(objectUrlRevoked, true);

    // Limpieza de mocks
    delete (globalThis as any).Blob;
    delete (globalThis as any).URL;
    delete (globalThis as any).window;
    delete (globalThis as any).document;
  });

  it('parseDocument: parsea y valida exitosamente un Document válido', async () => {
    const manager = new StateManager();
    injectSampleShapes(manager);
    const originalDoc = manager.getState();

    const json = serializeDocument(originalDoc);
    const parsedDoc = await parseDocument(json);

    assert.equal(parsedDoc.type, 'document');
    assert.equal(parsedDoc.id, originalDoc.id);
    assert.equal(parsedDoc.children.length, originalDoc.children.length);
    assert.equal(parsedDoc.children[0].children.length, originalDoc.children[0].children.length);
  });

  it('parseDocument: lanza DocumentParseError cuando el JSON tiene sintaxis inválida', async () => {
    await assert.rejects(
      async () => {
        await parseDocument('{ invalid json format');
      },
      (err: any) => {
        assert.ok(err instanceof DocumentParseError);
        assert.equal(err.name, 'DocumentParseError');
        assert.match(err.message, /Sintaxis JSON inválida/);
        return true;
      }
    );
  });

  it('parseDocument: lanza DocumentParseError si el valor raíz no es un objeto', async () => {
    await assert.rejects(
      async () => {
        await parseDocument('"cadena de texto"');
      },
      (err: any) => {
        assert.ok(err instanceof DocumentParseError);
        assert.match(err.message, /objeto raíz que represente un Document/);
        return true;
      }
    );

    await assert.rejects(
      async () => {
        await parseDocument('[1, 2, 3]');
      },
      (err: any) => {
        assert.ok(err instanceof DocumentParseError);
        assert.match(err.message, /objeto raíz que represente un Document/);
        return true;
      }
    );
  });

  it('parseDocument: lanza DocumentParseError si el type no es document', async () => {
    const invalidTypeJson = JSON.stringify({
      id: 'layer-1',
      type: 'layer',
      children: [],
    });

    await assert.rejects(
      async () => {
        await parseDocument(invalidTypeJson);
      },
      (err: any) => {
        assert.ok(err instanceof DocumentParseError);
        assert.match(err.message, /El tipo de nodo raíz debe ser 'document'/);
        return true;
      }
    );
  });

  it('parseDocument: lanza DocumentParseError si falta la propiedad children o no es un array', async () => {
    const missingChildrenJson = JSON.stringify({
      id: 'doc-1',
      type: 'document',
    });

    await assert.rejects(
      async () => {
        await parseDocument(missingChildrenJson);
      },
      (err: any) => {
        assert.ok(err instanceof DocumentParseError);
        assert.match(err.message, /La propiedad 'children' del Document debe ser un array/);
        return true;
      }
    );

    const nonArrayChildrenJson = JSON.stringify({
      id: 'doc-1',
      type: 'document',
      children: 'not-an-array',
    });

    await assert.rejects(
      async () => {
        await parseDocument(nonArrayChildrenJson);
      },
      (err: any) => {
        assert.ok(err instanceof DocumentParseError);
        assert.match(err.message, /La propiedad 'children' del Document debe ser un array/);
        return true;
      }
    );
  });
});

