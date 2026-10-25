import type { SvgElementLike } from './types.ts';

/**
 * Parser elemental de XML en estructura de árbol SvgElementLike para entornos sin DOMParser nativo.
 */
export function parseXmlToElement(xmlText: string): SvgElementLike | null {
  const clean = xmlText
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const idMap = new Map<string, SvgElementLike>();

  const docRef = {
    getElementById(id: string) {
      return idMap.get(id) ?? null;
    },
    querySelector(sel: string) {
      if (sel.startsWith('#')) {
        return idMap.get(sel.slice(1)) ?? null;
      }
      return null;
    },
  };

  function makeElement(tagName: string, attrStr: string): SvgElementLike {
    const attributes: Record<string, string> = {};
    const attrRegex = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let aMatch: RegExpExecArray | null;
    while ((aMatch = attrRegex.exec(attrStr)) !== null) {
      const key = aMatch[1].toLowerCase();
      const val = aMatch[2] ?? aMatch[3] ?? aMatch[4] ?? '';
      attributes[key] = val;
    }

    const children: SvgElementLike[] = [];
    const el: SvgElementLike = {
      tagName: tagName.toLowerCase(),
      children,
      textContent: '',
      ownerDocument: docRef,
      getAttribute(name: string) {
        return attributes[name.toLowerCase()] ?? null;
      },
      hasAttribute(name: string) {
        return attributes[name.toLowerCase()] !== undefined;
      },
      querySelectorAll(selector: string) {
        const results: SvgElementLike[] = [];
        const sel = selector.toLowerCase();
        function search(curr: SvgElementLike) {
          for (let c = 0; c < curr.children.length; c++) {
            const ch = curr.children[c];
            if (ch.tagName === sel) results.push(ch);
            search(ch);
          }
        }
        search(el);
        return results;
      },
      querySelector(selector: string) {
        const sel = selector.toLowerCase();
        function find(curr: SvgElementLike): SvgElementLike | null {
          for (let c = 0; c < curr.children.length; c++) {
            const ch = curr.children[c];
            if (ch.tagName === sel) return ch;
            const nested = find(ch);
            if (nested) return nested;
          }
          return null;
        }
        return find(el);
      },
    };

    if (attributes['id']) {
      idMap.set(attributes['id'], el);
    }

    return el;
  }

  const root = makeElement('__root__', '');
  const stack: SvgElementLike[] = [root];

  const tagRegex = /<(\/)?([a-zA-Z0-9_:-]+)((?:\s+[^=>/]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/)?>|([^<]+)/g;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(clean)) !== null) {
    const isClose = !!match[1];
    const tagName = match[2];
    const attrStr = match[3];
    const isSelfClosing = !!match[4];
    const textContent = match[5];

    if (textContent) {
      if (stack.length > 0) {
        const curr = stack[stack.length - 1];
        (curr as { textContent: string }).textContent += textContent;
      }
      continue;
    }

    if (!tagName) continue;

    if (isClose) {
      for (let s = stack.length - 1; s > 0; s--) {
        if (stack[s].tagName === tagName.toLowerCase()) {
          stack.splice(s);
          break;
        }
      }
    } else {
      const el = makeElement(tagName, attrStr || '');
      const parent = stack[stack.length - 1];
      (parent.children as SvgElementLike[]).push(el);
      if (!isSelfClosing && tagName.toLowerCase() !== 'br' && tagName.toLowerCase() !== 'hr') {
        stack.push(el);
      }
    }
  }

  const svgEl = root.querySelector ? root.querySelector('svg') : null;
  if (svgEl) {
    svgEl.ownerDocument = {
      getElementById(id: string) {
        return idMap.get(id) ?? null;
      },
    };
  }
  return svgEl;
}
