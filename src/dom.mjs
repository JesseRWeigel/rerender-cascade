// A jsdom document, installed as globals so react-dom/client can mount into it.
//
// This is real react-dom running a real reconciler, not a simulation. Everything this project
// claims about React comes from running this and watching what happens.
import { JSDOM } from 'jsdom';

let installed = false;

export function installDom() {
  if (installed) return globalThis.document;
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    pretendToBeVisual: true,
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Element = dom.window.Element;
  globalThis.Node = dom.window.Node;
  globalThis.Event = dom.window.Event;
  // react-dom's act() refuses to run without this, and silently batches differently without it.
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  installed = true;
  return globalThis.document;
}

export function freshContainer() {
  const doc = installDom();
  const el = doc.createElement('div');
  doc.body.appendChild(el);
  return el;
}
