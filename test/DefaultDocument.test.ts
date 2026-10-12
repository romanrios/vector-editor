import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_DOCUMENT, DEFAULT_DOCUMENT_ZOOM } from '../src/state/defaultDocument.ts';
import { Serializer } from '../src/state/Serializer.ts';
import { isText } from '../src/types/scene-graph.ts';
import { ViewportManager } from '../src/utils/viewport.ts';

test('el documento inicial usa el diseño predeterminado y el zoom del 50%', () => {
  assert.equal(DEFAULT_DOCUMENT_ZOOM, 0.5);
  assert.equal(new ViewportManager({ zoom: DEFAULT_DOCUMENT_ZOOM, panX: 0, panY: 0 }).zoom, 0.5);
  assert.equal(DEFAULT_DOCUMENT.id, 'doc-root');
  assert.equal(DEFAULT_DOCUMENT.width, 1920);
  assert.equal(DEFAULT_DOCUMENT.height, 1080);

  const children = DEFAULT_DOCUMENT.children[0].children;
  assert.equal(children.length, 13);

  const title = children.find((node) => isText(node) && node.text === 'Vectedit');
  assert.ok(title && isText(title));
  assert.equal(title.x, 299.31669095553843);
  assert.equal(title.y, 403.0819841145182);
  assert.equal(title.fontFamily, 'Montserrat');
  assert.equal(title.fontSize, 287);
  assert.equal(title.fontWeight, 800);

  const subtitle = children.find(
    (node) => isText(node) && node.text === 'Editor gráfico vectorial 2D sobre Canvas nativo'
  );
  assert.ok(subtitle && isText(subtitle));
  assert.equal(subtitle.fontSize, 58);
  assert.equal(children.filter((node) => node.type === 'rectangle' || node.type === 'path').length, 9);
});

test('el documento predeterminado pasa la validación de importación JSON', async () => {
  const parsed = await Serializer.parseDocument(JSON.stringify(DEFAULT_DOCUMENT));

  assert.deepEqual(parsed, DEFAULT_DOCUMENT);
});
