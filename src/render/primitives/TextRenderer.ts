import {
  type Text,
  isGradient,
} from '../../types/scene-graph.ts';
import {
  getTextBaseAABB,
  getTextLineHeight,
  getTextLineRanges,
  measureSingleLineTextWidth,
  measureStyledRun,
} from '../../utils/geometry.ts';
import { isNonePaint } from '../../utils/color.ts';
import { createCanvasGradient } from '../../utils/gradient.ts';
import { clearDropShadow } from '../utils/shadow.ts';
import { splitTextIntoRuns } from '../../utils/textSpans.ts';
import type { TextEditRenderState } from '../types.ts';

/**
 * Renderiza el recuadro de selección de caracteres detrás del texto dibujado,
 * soportando selección multilínea (primera línea desde inicio, intermedias completas, última hasta fin).
 */
export function renderTextSelectionHighlight(
  ctx: CanvasRenderingContext2D,
  text: Text,
  lines: Array<{ text: string; start: number; end: number }>,
  textLength: number,
  selectionStart: number,
  selectionEnd: number,
  fontSize: number,
  lineHeight: number
): void {
  const minIdx = Math.max(0, Math.min(textLength, Math.min(selectionStart, selectionEnd)));
  const maxIdx = Math.max(0, Math.min(textLength, Math.max(selectionStart, selectionEnd)));
  if (minIdx === maxIdx) return;

  ctx.save();
  ctx.fillStyle = 'rgba(59, 130, 246, 0.35)';

  for (let i = 0; i < lines.length; i++) {
    const { text: lineText, start: lineStart, end: lineEnd } = lines[i];
    const selStartInLine = Math.max(lineStart, minIdx);
    const selEndInLine = Math.min(lineEnd, maxIdx);

    const hasSelectionInThisLine = selStartInLine < selEndInLine;
    const nextLineStart = lines[i + 1]?.start ?? lineEnd;
    const isLineBreakSelected = maxIdx > lineEnd && minIdx < nextLineStart;

    if (!hasSelectionInThisLine && !isLineBreakSelected) {
      continue;
    }

    const lineWidth = measureSingleLineTextWidth(text, lineText, ctx, lineStart);
    const hasBoxWidth = typeof text.boxWidth === 'number' && text.boxWidth > 0;
    let lineStartX = text.x;
    if (hasBoxWidth) {
      if (text.textAlign === 'center') {
        lineStartX = text.x + (text.boxWidth! - lineWidth) / 2;
      } else if (text.textAlign === 'right') {
        lineStartX = text.x + text.boxWidth! - lineWidth;
      }
    } else {
      if (text.textAlign === 'center') {
        lineStartX = text.x - lineWidth / 2;
      } else if (text.textAlign === 'right') {
        lineStartX = text.x - lineWidth;
      }
    }

    const charStart = Math.max(0, selStartInLine - lineStart);
    const charEnd = Math.max(charStart, selEndInLine - lineStart);

    const wBefore = measureSingleLineTextWidth(text, lineText.slice(0, charStart), ctx, lineStart);
    let wSelected = charEnd > charStart
      ? measureSingleLineTextWidth(text, lineText.slice(0, charEnd), ctx, lineStart) - wBefore
      : 0;

    if (isLineBreakSelected && wSelected === 0) {
      wSelected = Math.max(6, fontSize * 0.3);
    }

    const lineY = text.y + i * lineHeight;
    ctx.fillRect(lineStartX + wBefore, lineY, wSelected, lineHeight);
  }

  ctx.restore();
}

/**
 * Dibuja un nodo Text de una sola línea o multilínea en Canvas 2D respetando propiedades tipográficas,
 * color de relleno, rotación y alineación.
 *
 * Convención de textBaseline:
 * Se utiliza 'top' de manera consistente para que la coordenada (x, y) represente el ancla
 * superior del texto, asegurando coherencia con las demás figuras del editor (como Rectangle)
 * donde el origen (x, y) define el extremo superior y el eje Y crece hacia abajo.
 */
export function renderText(
  ctx: CanvasRenderingContext2D,
  text: Text,
  textEdit: TextEditRenderState | null
): void {
  const isEditingThis = textEdit !== null && textEdit.textId === text.id;
  const hasFill = text.fill === undefined || !isNonePaint(text.fill);
  const hasStroke = !isNonePaint(text.stroke) && (text.strokeWidth ?? 1) > 0;
  if (!hasFill && !hasStroke && !isEditingThis) {
    return;
  }

  ctx.save();

  // 1. Configuración tipográfica (CSS font shorthand: [style] [weight] size family)
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

  // 2. Alineación horizontal y vertical
  ctx.textAlign = text.textAlign ?? 'left';
  // Convención de alineación vertical: 'top' fija (x, y) en el borde superior del texto.
  ctx.textBaseline = 'top';

  if ('letterSpacing' in ctx) {
    const letterSpacing = typeof text.letterSpacing === 'number' && Number.isFinite(text.letterSpacing) ? text.letterSpacing : 0;
    try {
      (ctx as any).letterSpacing = `${letterSpacing}px`;
    } catch (_) {}
  }

  // 3. Color de relleno (negro por defecto si no se indica)
  if (hasFill || isEditingThis) {
    if (isGradient(text.fill)) {
      const baseAABB = getTextBaseAABB(text, ctx);
      ctx.fillStyle = createCanvasGradient(ctx, text.fill, baseAABB);
    } else {
      ctx.fillStyle = hasFill ? (text.fill ?? '#000000') : 'rgba(0, 0, 0, 0.4)';
    }
  }
  if (hasStroke) {
    if (text.strokeDashArray && text.strokeDashArray.length > 0 && typeof ctx.setLineDash === 'function') {
      ctx.setLineDash([...text.strokeDashArray]);
    }
    ctx.lineCap = text.strokeLineCap ?? 'round';
    ctx.lineJoin = text.strokeLineJoin ?? 'round';
    if (isGradient(text.stroke)) {
      const baseAABB = getTextBaseAABB(text, ctx);
      ctx.strokeStyle = createCanvasGradient(ctx, text.stroke, baseAABB);
    } else {
      ctx.strokeStyle = text.stroke!;
    }
    ctx.lineWidth = text.strokeWidth ?? 1;
  }

  // 4. Transformación de rotación respecto a la posición (x, y) del nodo
  if (text.rotation) {
    ctx.translate(text.x, text.y);
    ctx.rotate((text.rotation * Math.PI) / 180);
    ctx.translate(-text.x, -text.y);
  }

  // 5. Dibujo del texto (soporta multilínea y word-wrapping con boxWidth)
  const displayText = isEditingThis ? textEdit.text : (text.text ?? '');
  const textWithContent: Text = {
    ...text,
    text: displayText,
    spans: isEditingThis && textEdit.spans !== undefined ? textEdit.spans : text.spans,
  };
  const lineHeight = getTextLineHeight(textWithContent);

  const lines = getTextLineRanges(textWithContent, ctx);

  // 6. Si está en edición y existe selección de caracteres, renderizar el resaltado DETRÁS del texto
  if (
    isEditingThis &&
    textEdit.selectionStart !== undefined &&
    textEdit.selectionEnd !== undefined &&
    textEdit.selectionStart !== textEdit.selectionEnd
  ) {
    renderTextSelectionHighlight(
      ctx,
      textWithContent,
      lines,
      displayText.length,
      textEdit.selectionStart,
      textEdit.selectionEnd,
      fontSize,
      lineHeight
    );
  }

  // 7. Dibujo de cada línea de texto
  const hasBoxWidth = typeof text.boxWidth === 'number' && text.boxWidth > 0;
  const hasSpans = textWithContent.spans && textWithContent.spans.length > 0;

  if (hasSpans) {
    ctx.textAlign = 'left';
    for (let i = 0; i < lines.length; i++) {
      const { text: lineText, start: lineStart, end: lineEnd } = lines[i];
      const lineY = text.y + i * lineHeight;
      const lineWidth = measureSingleLineTextWidth(textWithContent, lineText, ctx, lineStart);

      let lineStartX = text.x;
      if (hasBoxWidth) {
        if (text.textAlign === 'center') {
          lineStartX = text.x + (text.boxWidth! - lineWidth) / 2;
        } else if (text.textAlign === 'right') {
          lineStartX = text.x + text.boxWidth! - lineWidth;
        }
      } else {
        if (text.textAlign === 'center') {
          lineStartX = text.x - lineWidth / 2;
        } else if (text.textAlign === 'right') {
          lineStartX = text.x - lineWidth;
        }
      }

      const runs = splitTextIntoRuns(textWithContent, lineStart, lineEnd);
      let runX = lineStartX;

      for (let r = 0; r < runs.length; r++) {
        const run = runs[r];
        const rFontParts: string[] = [];
        if (run.style.fontStyle && run.style.fontStyle !== 'normal') {
          rFontParts.push(run.style.fontStyle);
        }
        if (run.style.fontWeight && run.style.fontWeight !== 'normal' && run.style.fontWeight !== 400) {
          rFontParts.push(String(run.style.fontWeight));
        }
        const rFontFamily = run.style.fontFamily;
        const rSafeFamily =
          rFontFamily.includes(' ') && !rFontFamily.startsWith('"') && !rFontFamily.startsWith("'")
            ? `"${rFontFamily}"`
            : rFontFamily;
        rFontParts.push(`${run.style.fontSize}px`);
        rFontParts.push(rSafeFamily);
        ctx.font = rFontParts.join(' ');

        if (hasFill || isEditingThis) {
          ctx.fillStyle = run.style.fill as string;
          ctx.fillText(run.text, runX, lineY);
          if (hasStroke) {
            clearDropShadow(ctx);
          }
        }
        if (hasStroke) {
          ctx.strokeText(run.text, runX, lineY);
        }

        const runW = measureStyledRun(run.text, run.style, ctx);
        runX += runW;
      }
    }
  } else {
    let textAnchorX = text.x;
    if (hasBoxWidth) {
      if (text.textAlign === 'center') {
        textAnchorX = text.x + text.boxWidth! / 2;
      } else if (text.textAlign === 'right') {
        textAnchorX = text.x + text.boxWidth!;
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const lineY = text.y + i * lineHeight;
      if (hasFill || isEditingThis) {
        ctx.fillText(lines[i].text, textAnchorX, lineY);
        if (hasStroke) {
          clearDropShadow(ctx);
        }
      }
      if (hasStroke) {
        ctx.strokeText(lines[i].text, textAnchorX, lineY);
      }
    }
  }

  ctx.restore();
}
