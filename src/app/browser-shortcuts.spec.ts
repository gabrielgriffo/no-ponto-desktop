import { afterEach, describe, expect, it } from 'vitest';
import { allowsNativeContextMenu, installAppBehavior, isBrowserShortcut } from './browser-shortcuts';

const key = (k: string, ctrlKey = false) => ({ key: k, ctrlKey, metaKey: false });

describe('isBrowserShortcut', () => {
  it('bloqueia recarregar, imprimir e buscar', () => {
    expect(isBrowserShortcut(key('F5'))).toBe(true);
    expect(isBrowserShortcut(key('r', true))).toBe(true);
    expect(isBrowserShortcut(key('R', true))).toBe(true);
    expect(isBrowserShortcut(key('p', true))).toBe(true);
    expect(isBrowserShortcut(key('f', true))).toBe(true);
    expect(isBrowserShortcut(key('F3'))).toBe(true);
  });

  it('mantém copiar, colar, desfazer e a digitação comum', () => {
    for (const k of ['c', 'v', 'x', 'z', 'a']) expect(isBrowserShortcut(key(k, true))).toBe(false);
    expect(isBrowserShortcut(key('r'))).toBe(false);
    expect(isBrowserShortcut(key('Tab'))).toBe(false);
  });
});

describe('menu de contexto', () => {
  afterEach(() => (document.body.innerHTML = ''));

  it('só fica disponível em campos de texto', () => {
    document.body.innerHTML = '<input id="login"><button id="btn"><span id="icon"></span></button>';
    expect(allowsNativeContextMenu(document.getElementById('login'))).toBe(true);
    expect(allowsNativeContextMenu(document.getElementById('icon'))).toBe(false);
    expect(allowsNativeContextMenu(null)).toBe(false);
  });

  it('o comportamento instalado cancela fora dos campos e libera dentro', () => {
    const doc = document.implementation.createHTMLDocument('app');
    doc.body.innerHTML = '<input id="login"><div id="card"></div>';
    installAppBehavior(doc);

    const open = (id: string) => {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      doc.getElementById(id)!.dispatchEvent(event);
      return event.defaultPrevented;
    };

    expect(open('card')).toBe(true);
    expect(open('login')).toBe(false);
  });

  it('o comportamento instalado cancela F5 e Ctrl+R', () => {
    const doc = document.implementation.createHTMLDocument('app');
    installAppBehavior(doc);

    const press = (init: KeyboardEventInit) => {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      doc.body.dispatchEvent(event);
      return event.defaultPrevented;
    };

    expect(press({ key: 'F5' })).toBe(true);
    expect(press({ key: 'r', ctrlKey: true })).toBe(true);
    expect(press({ key: 'v', ctrlKey: true })).toBe(false);
  });
});
