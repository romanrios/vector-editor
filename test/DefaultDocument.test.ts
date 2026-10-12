import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_DOCUMENT, DEFAULT_DOCUMENT_ZOOM } from '../src/state/defaultDocument.ts';
import { Serializer } from '../src/state/Serializer.ts';
import { isGroup, isText } from '../src/types/scene-graph.ts';
import { ViewportManager } from '../src/utils/viewport.ts';

test('el documento inicial usa el diseño predeterminado y el zoom del 50%', () => {
  assert.equal(DEFAULT_DOCUMENT_ZOOM, 0.5);
  assert.equal(new ViewportManager({ zoom: DEFAULT_DOCUMENT_ZOOM, panX: 0, panY: 0 }).zoom, 0.5);
  assert.equal(DEFAULT_DOCUMENT.id, 'doc-root');
  assert.equal(DEFAULT_DOCUMENT.width, 1920);
  assert.equal(DEFAULT_DOCUMENT.height, 1080);

  const children = DEFAULT_DOCUMENT.children[0].children;
  assert.equal(children.length, 5);

  const title = children.find((node) => isText(node) && node.text === 'Vector Editor');
  assert.ok(title && isText(title));
  assert.equal(title.fontFamily, 'Montserrat');
  assert.equal(title.fontSize, 187);
  assert.equal(title.fontWeight, 800);

  const group = children.find(isGroup);
  assert.ok(group);
  assert.equal(group.children.length, 9);
});

test('el documento predeterminado pasa la validación de importación JSON', async () => {
  const parsed = await Serializer.parseDocument(JSON.stringify(DEFAULT_DOCUMENT));

  assert.deepEqual(parsed, DEFAULT_DOCUMENT);
});
