import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { exportDocumentToSvg, escapeXml } from '../src/utils/exportSvg.ts';
import type { Document, Rectangle, Ellipse, Path, Text, Group } from '../src/types/scene-graph.ts';

describe('Exportación a SVG (exportDocumentToSvg)', () => {
  it('escapa correctamente caracteres especiales XML', () => {
    assert.strictEqual(
      escapeXml('Texto con <tags>, & ampersand, "comillas" y \'apóstrofe\''),
      'Texto con &lt;tags&gt;, &amp; ampersand, &quot;comillas&quot; y &apos;apóstrofe&apos;'
    );
  });

  it('exporta un rectángulo con estilos, esquinas redondeadas y rotación', () => {
    const rect: Rectangle = {
      id: 'rect-1',
      name: 'Rectángulo 1',
      type: 'rectangle',
      x: 50,
      y: 60,
      width: 100,
      height: 80,
      fill: '#38bdf8',
      stroke: '#0284c7',
      strokeWidth: 2,
      cornerRadius: 8,
      rotation: 45,
    };

    const doc: Document = {
      id: 'doc-1',
      name: 'Doc',
      type: 'document',
      width: 800,
      height: 600,
      children: [
        {
          id: 'layer-1',
          name: 'Capa 1',
          type: 'layer',
          children: [rect],
        },
      ],
    };

    const svg = exportDocumentToSvg(doc);

    assert.match(svg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg, /viewBox="0 0 800 600"/);
    assert.match(svg, /width="800" height="600"/);
    assert.match(svg, /<rect/);
    assert.match(svg, /id="rect-1"/);
    assert.match(svg, /x="50" y="60" width="100" height="80"/);
    assert.match(svg, /rx="8" ry="8"/);
    assert.match(svg, /fill="#38bdf8"/);
    assert.match(svg, /stroke="#0284c7" stroke-width="2"/);
    // Rotación respecto al centro del rectángulo: cx = 50 + 50 = 100, cy = 60 + 40 = 100
    assert.match(svg, /transform="rotate\(45 100 100\)"/);
  });

  it('exporta una elipse con estilos y rotación', () => {
    const ellipse: Ellipse = {
      id: 'ellipse-1',
      name: 'Elipse 1',
      type: 'ellipse',
      x: 200,
      y: 150,
      radiusX: 60,
      radiusY: 40,
      fill: '#f43f5e',
      stroke: 'none',
      rotation: 30,
    };

    const doc: Document = {
      id: 'doc-1',
      name: 'Doc',
      type: 'document',
      width: 500,
      height: 400,
      children: [
        {
          id: 'layer-1',
          name: 'Capa 1',
          type: 'layer',
          children: [ellipse],
        },
      ],
    };

    const svg = exportDocumentToSvg(doc);
    assert.match(svg, /<ellipse/);
    assert.match(svg, /cx="200" cy="150" rx="60" ry="40"/);
    assert.match(svg, /fill="#f43f5e"/);
    assert.match(svg, /stroke="none"/);
    assert.match(svg, /transform="rotate\(30 200 150\)"/);
  });

  it('exporta trazados Bézier abiertos y cerrados con comandos M, C y Z', () => {
    const pathClosed: Path = {
      id: 'path-1',
      name: 'Trazado Cerrado',
      type: 'path',
      x: 10,
      y: 10,
      closed: true,
      fill: '#10b981',
      stroke: '#047857',
      strokeWidth: 3,
      points: [
        { x: 100, y: 100, handleOut: { x: 120, y: 80 } },
        { x: 200, y: 100, handleIn: { x: 180, y: 80 }, handleOut: { x: 220, y: 120 } },
        { x: 150, y: 180, handleIn: { x: 170, y: 190 }, handleOut: { x: 130, y: 170 } },
      ],
    };

    const doc: Document = {
      id: 'doc-1',
      name: 'Doc',
      type: 'document',
      width: 400,
      height: 400,
      children: [
        {
          id: 'layer-1',
          name: 'Capa 1',
          type: 'layer',
          children: [pathClosed],
        },
      ],
    };

    const svg = exportDocumentToSvg(doc);
    assert.match(svg, /<path/);
    assert.match(svg, /d="M 100 100 C 120 80, 180 80, 200 100 C 220 120, 170 190, 150 180 C 130 170, 100 100, 100 100 Z"/);
    assert.match(svg, /fill="#10b981"/);
    assert.match(svg, /stroke="#047857" stroke-width="3"/);
    assert.match(svg, /stroke-linecap="round" stroke-linejoin="round"/);
  });

  it('exporta texto con propiedades tipográficas, alineación y tspans para multilínea', () => {
    const textNode: Text = {
      id: 'text-1',
      name: 'Título',
      type: 'text',
      x: 40,
      y: 80,
      text: 'Línea 1\nLínea 2',
      fontFamily: 'Montserrat',
      fontSize: 24,
      fontWeight: 'bold',
      fontStyle: 'italic',
      textAlign: 'center',
      fill: '#1e293b',
    };

    const doc: Document = {
      id: 'doc-1',
      name: 'Doc',
      type: 'document',
      width: 600,
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

    const svg = exportDocumentToSvg(doc);
    assert.match(svg, /<text/);
    assert.match(svg, /font-family="Montserrat"/);
    assert.match(svg, /font-size="24"/);
    assert.match(svg, /font-weight="bold"/);
    assert.match(svg, /font-style="italic"/);
    assert.match(svg, /text-anchor="middle"/);
    assert.match(svg, /dominant-baseline="hanging"/);
    assert.match(svg, /<tspan x="40" y="80">Línea 1<\/tspan>/);
    // Line height por defecto para 24 es 24 * 1.2 = 28.8, y = 80 + 28.8 = 108.8
    assert.match(svg, /<tspan x="40" y="108\.8">Línea 2<\/tspan>/);
  });

  it('respeta la jerarquía de grupos y multiplica opacidades', () => {
    const group: Group = {
      id: 'group-1',
      name: 'Grupo Principal',
      type: 'group',
      opacity: 0.5,
      children: [
        {
          id: 'rect-in-group',
          name: 'Rect',
          type: 'rectangle',
          x: 10,
          y: 10,
          width: 50,
          height: 50,
          fill: '#38bdf8',
          opacity: 0.8,
        },
      ],
    };

    const doc: Document = {
      id: 'doc-1',
      name: 'Doc',
      type: 'document',
      width: 300,
      height: 300,
      children: [
        {
          id: 'layer-1',
          name: 'Capa 1',
          type: 'layer',
          opacity: 0.9,
          children: [group],
        },
      ],
    };

    const svg = exportDocumentToSvg(doc);
    assert.match(svg, /<g id="layer-1".*opacity="0\.9"/);
    assert.match(svg, /<g id="group-1".*opacity="0\.5"/);
    assert.match(svg, /<rect.*id="rect-in-group".*opacity="0\.8"/);
  });

  it('omite nodos con visible: false', () => {
    const visibleRect: Rectangle = {
      id: 'visible-rect',
      name: 'Visible',
      type: 'rectangle',
      x: 10,
      y: 10,
      width: 20,
      height: 20,
      visible: true,
      fill: '#10b981',
    };

    const hiddenRect: Rectangle = {
      id: 'hidden-rect',
      name: 'Oculto',
      type: 'rectangle',
      x: 40,
      y: 40,
      width: 20,
      height: 20,
      visible: false,
      fill: '#ef4444',
    };

    const doc: Document = {
      id: 'doc-1',
      name: 'Doc',
      type: 'document',
      width: 200,
      height: 200,
      children: [
        {
          id: 'layer-1',
          name: 'Capa 1',
          type: 'layer',
          children: [visibleRect, hiddenRect],
        },
      ],
    };

    const svg = exportDocumentToSvg(doc);
    assert.match(svg, /id="visible-rect"/);
    assert.doesNotMatch(svg, /id="hidden-rect"/);
  });

  it('soporta exportar únicamente la selección con viewBox ajustado a sus dimensiones', () => {
    const rect1: Rectangle = {
      id: 'rect-1',
      name: 'R1',
      type: 'rectangle',
      x: 100,
      y: 120,
      width: 80,
      height: 60,
      fill: '#38bdf8',
    };

    const rect2: Rectangle = {
      id: 'rect-2',
      name: 'R2',
      type: 'rectangle',
      x: 300,
      y: 300,
      width: 100,
      height: 100,
      fill: '#f59e0b',
    };

    const doc: Document = {
      id: 'doc-1',
      name: 'Doc',
      type: 'document',
      width: 1000,
      height: 1000,
      children: [
        {
          id: 'layer-1',
          name: 'Capa 1',
          type: 'layer',
          children: [rect1, rect2],
        },
      ],
    };

    const svg = exportDocumentToSvg(doc, {
      onlySelected: true,
      selectedIds: ['rect-1'],
    });

    // viewBox ajustado a rect-1: x=100, y=120, w=80, h=60
    assert.match(svg, /viewBox="100 120 80 60"/);
    assert.match(svg, /width="80" height="60"/);
    assert.match(svg, /id="rect-1"/);
    assert.doesNotMatch(svg, /id="rect-2"/);
  });

  it('incluye fondo opaco cuando includeBackground es true', () => {
    const doc: Document = {
      id: 'doc-1',
      name: 'Doc',
      type: 'document',
      width: 500,
      height: 300,
      children: [
        {
          id: 'layer-1',
          name: 'Capa 1',
          type: 'layer',
          children: [
            {
              id: 'r1',
              name: 'R',
              type: 'rectangle',
              x: 10,
              y: 10,
              width: 50,
              height: 50,
              fill: '#000000',
            },
          ],
        },
      ],
    };

    const svgWithDefaultBg = exportDocumentToSvg(doc, { includeBackground: true });
    assert.match(svgWithDefaultBg, /<rect x="0" y="0" width="500" height="300" fill="#ffffff" \/>/);

    const svgWithCustomBg = exportDocumentToSvg(doc, {
      includeBackground: true,
      backgroundColor: '#18181b',
    });
    assert.match(svgWithCustomBg, /<rect x="0" y="0" width="500" height="300" fill="#18181b" \/>/);
  });
});
