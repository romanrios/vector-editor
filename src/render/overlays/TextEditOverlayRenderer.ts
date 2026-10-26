import type { Text } from '../../types/scene-graph.ts';
import {
  getTextBaseAABB,
  getTextLineHeight,
  getTextLineRanges,
  measureSingleLineTextWidth,
} from '../../utils/geometry.ts';
import type { TextEditRenderState } from '../types.ts';

/**
 * Dibuja la indicación visual de un nodo Text en modo de edición interactiva.
 * Incluye recuadro punteado de acento y cursor/caret en la posición y línea exacta según métricas reales.
 */
export function renderTextEditOverlay(
  ctx: CanvasRenderingContext2D,
  text: Text,
  textEdit: TextEditRenderState,
  zoom: number
): void {
  const currentText = textEdit.text;
  const tempNode: Text = { ...text, text: currentText };
  const baseAABB = getTextBaseAABB(tempNode, ctx);
  const lineHeight = getTextLineHeight(tempNode);

  ctx.save();

  if (text.rotation) {
    ctx.translate(text.x, text.y);
    ctx.rotate((text.rotation * Math.PI) / 180);
    ctx.translate(-text.x, -text.y);
  }

  const padding = 3 / zoom;
  const boxX = baseAABB.minX - padding;
  const boxY = baseAABB.minY - padding;
  const boxW = Math.max(6, baseAABB.width) + padding * 2;
  const boxH = Math.max(12, baseAABB.height) + padding * 2;

  // 1. Fondo sutil translúcido para destacar el área activa de escritura
  ctx.fillStyle = 'rgba(37, 99, 235, 0.08)';
  ctx.fillRect(boxX, boxY, boxW, boxH);

  // 2. Borde punteado azul primario
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 1.5 / zoom;
  ctx.setLineDash([4 / zoom, 2 / zoom]);
  ctx.strokeRect(boxX, boxY, boxW, boxH);

  // 3. Cursor / Caret visible en la posición calculada según métrica tipográfica real
  if (textEdit.cursorVisible !== false) {
    const cursorIndex = Math.max(0, Math.min(currentText.length, textEdit.cursorIndex ?? currentText.length));

    // Configurar fuente para medir prefijo
    const fontParts: string[] = [];
    if (text.fontStyle && text.fontStyle !== 'normal') {
      fontParts.push(text.fontStyle);
    }
    if (text.fontWeight && text.fontWeight !== 'normal' && text.fontWeight !== 400) {
      fontParts.push(String(text.fontWeight));
    }
    const fontSize = typeof text.fontSize === 'number' && text.fontSize > 0 ? text.fontSize : 16;
    const fontFamily = text.fontFamily ?? 'sans-serif';
    const safeFontFamily = fontFamily.includes(' ') && !fontFamily.startsWith('"') && !fontFamily.startsWith("'")
      ? `"${fontFamily}"`
      : fontFamily;
    fontParts.push(`${fontSize}px`);
    fontParts.push(safeFontFamily);
    ctx.font = fontParts.join(' ');

    if ('letterSpacing' in ctx) {
      const letterSpacing = typeof text.letterSpacing === 'number' && Number.isFinite(text.letterSpacing) ? text.letterSpacing : 0;
      try {
        (ctx as any).letterSpacing = `${letterSpacing}px`;
      } catch (_) {}
    }

    // Determinar en qué línea está el cursor
    const lines = getTextLineRanges(tempNode, ctx);
    let lineIdx = 0;
    for (let i = 0; i < lines.length; i++) {
      if (cursorIndex <= lines[i].end || i === lines.length - 1) {
        lineIdx = i;
        break;
      }
    }

    const currentLine = lines[lineIdx]?.text ?? '';
    const lineStart = lines[lineIdx]?.start ?? 0;
    const col = Math.max(0, Math.min(currentLine.length, cursorIndex - lineStart));
    const lineWidth = measureSingleLineTextWidth(tempNode, currentLine, ctx);

    const hasBoxWidth = typeof tempNode.boxWidth === 'number' && tempNode.boxWidth > 0;
    let lineStartX = text.x;
    if (hasBoxWidth) {
      if (text.textAlign === 'center') {
        lineStartX = text.x + (tempNode.boxWidth! - lineWidth) / 2;
      } else if (text.textAlign === 'right') {
        lineStartX = text.x + tempNode.boxWidth! - lineWidth;
      }
    } else {
      if (text.textAlign === 'center') {
        lineStartX = text.x - lineWidth / 2;
      } else if (text.textAlign === 'right') {
        lineStartX = text.x - lineWidth;
      }
    }

    const cursorOffset = measureSingleLineTextWidth(tempNode, currentLine.slice(0, col), ctx);
    const caretX = lineStartX + cursorOffset;
    const caretY = text.y + lineIdx * lineHeight;

    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(caretX, caretY);
    ctx.lineTo(caretX, caretY + lineHeight);
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 1.5 / zoom;
    ctx.stroke();
  }

  ctx.restore();
}
