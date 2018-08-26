import {
  combineFrom,
  isFunction,
  isInvalid,
  isNullOrUndef,
  isString,
  NO_OP,
  throwError,
  warning
} from 'inferno-shared';
import { ChildFlags, VNodeFlags } from 'inferno-vnode-flags';
import { directClone, options, VNode } from '../core/implementation';
import { mount, mountArrayChildren, mountRef, mountTextContent } from './mounting';
import { remove, removeAllChildren, removeTextNode, unmount, unmountAllChildren } from './unmounting';
import {
  appendChild,
  EMPTY_OBJ,
  findDOMfromVNode,
  insertOrAppend,
  removeChild,
  removeVNodeDOM,
  replaceChild
} from './utils/common';
import { isControlledFormElement, processElement } from './wrappers/processElement';
import { patchProp } from './props';
import { handleComponentInput } from './utils/componentutil';
import { validateKeys } from '../core/validate';

function replaceWithNewNode(lastVNode, nextVNode, parentDom, context: Object, isSVG: boolean) {
  unmount(lastVNode);

  if ((lastVNode.flags & VNodeFlags.DOMRef) !== 0 && (nextVNode.flags & VNodeFlags.DOMRef) !== 0) {
    // Single DOM operation, when we have dom references available
    mount(nextVNode, null, context, isSVG, null);
    // Single DOM operation, when we have dom references available
    replaceChild(parentDom, nextVNode.dom, lastVNode.dom);
  } else {
    mount(nextVNode, parentDom, context, isSVG, findDOMfromVNode(lastVNode));
    removeVNodeDOM(lastVNode, parentDom);
  }
}

export function patch(lastVNode: VNode, nextVNode: VNode, parentDom: Element, context: Object, isSVG: boolean, nextNode: Element | null) {
  const nextFlags = nextVNode.flags |= VNodeFlags.InUse;

  if (
    lastVNode.flags !== nextFlags ||
    lastVNode.type !== nextVNode.type ||
    lastVNode.key !== nextVNode.key ||
    (nextFlags & VNodeFlags.ReCreate) > 0) {
    if (lastVNode.flags & VNodeFlags.InUse) {
      replaceWithNewNode(lastVNode, nextVNode, parentDom, context, isSVG);
    } else {
      // Last vNode is not in use, it has crashed at application level. Just mount nextVNode and ignore last one
      mount(nextVNode, parentDom, context, isSVG, nextNode);
    }
  } else if (nextFlags & VNodeFlags.Element) {
    patchElement(lastVNode, nextVNode, parentDom, context, isSVG, nextFlags);
  } else if (nextFlags & VNodeFlags.Component) {
    patchComponent(lastVNode, nextVNode, parentDom, context, isSVG, (nextFlags & VNodeFlags.ComponentClass) > 0, nextNode);
  } else if (nextFlags & VNodeFlags.Text) {
    patchText(lastVNode, nextVNode);
  } else if (nextFlags & VNodeFlags.Void) {
    nextVNode.dom = lastVNode.dom;
  } else if (nextFlags & VNodeFlags.Fragment) {
    patchFragment(lastVNode, nextVNode, parentDom, context, isSVG, nextNode)
  } else {
    patchPortal(lastVNode, nextVNode, context);
  }
}

export function patchSingleTextChild(lastChildren, nextChildren, parentDOM: Element) {
  if (lastChildren !== nextChildren) {
    if (lastChildren !== '') {
      (parentDOM.firstChild as Node).nodeValue = nextChildren;
    } else {
      parentDOM.textContent = nextChildren;
    }
  }
}

function patchContentEditableChildren(dom, nextChildren) {
  if (dom.textContent !== nextChildren) {
    dom.textContent = nextChildren;
  }
}

function patchFragment(lastVNode: VNode, nextVNode: VNode, parentDom: Element, context: Object, isSVG: boolean, nextNode: Element | null) {
  const lastChildren = lastVNode.children as VNode[];
  let _nextNode;

  if (
    (nextVNode.childFlags & ChildFlags.HasVNodeChildren) === 0 &&
    (nextVNode.children as VNode[]).length > lastChildren.length
  ) {
    _nextNode = (findDOMfromVNode(lastChildren[lastChildren.length - 1]) as Element).nextSibling;
  }

  patchChildren(
    lastVNode.childFlags,
    nextVNode.childFlags,
    lastChildren,
    nextVNode.children,
    parentDom,
    context,
    isSVG,
    _nextNode,
    lastVNode
  );
}

function patchPortal(lastVNode: VNode, nextVNode: VNode, context) {
  const lastContainer = lastVNode.ref as Element;
  const nextContainer = nextVNode.ref as Element;
  const nextChildren = nextVNode.children as VNode;

  patchChildren(
    lastVNode.childFlags,
    nextVNode.childFlags,
    lastVNode.children as VNode,
    nextChildren,
    lastContainer as Element,
    context,
    false,
    null,
    lastVNode
  );

  nextVNode.dom = lastVNode.dom;

  if (lastContainer !== nextContainer && !isInvalid(nextChildren)) {
    const node = nextChildren.dom as Element;

    removeChild(lastContainer, node);
    appendChild(nextContainer, node);
  }
}

export function patchElement(lastVNode: VNode, nextVNode: VNode, parentDom: Element | null, context: Object, isSVG: boolean, nextFlags: number) {
  const dom = lastVNode.dom as Element;
  const lastProps = lastVNode.props;
  const nextProps = nextVNode.props;
  let isFormElement = false;
  let hasControlledValue = false;
  let nextPropsOrEmpty;

  nextVNode.dom = dom;
  isSVG = isSVG || (nextFlags & VNodeFlags.SvgElement) > 0;

  // inlined patchProps  -- starts --
  if (lastProps !== nextProps) {
    const lastPropsOrEmpty = lastProps || EMPTY_OBJ;
    nextPropsOrEmpty = nextProps || (EMPTY_OBJ as any);

    if (nextPropsOrEmpty !== EMPTY_OBJ) {
      isFormElement = (nextFlags & VNodeFlags.FormElement) > 0;
      if (isFormElement) {
        hasControlledValue = isControlledFormElement(nextPropsOrEmpty);
      }

      for (const prop in nextPropsOrEmpty) {
        const lastValue = lastPropsOrEmpty[prop];
        const nextValue = nextPropsOrEmpty[prop];
        if (lastValue !== nextValue) {
          patchProp(prop, lastValue, nextValue, dom, isSVG, hasControlledValue, lastVNode);
        }
      }
    }
    if (lastPropsOrEmpty !== EMPTY_OBJ) {
      for (const prop in lastPropsOrEmpty) {
        if (!nextPropsOrEmpty.hasOwnProperty(prop) && !isNullOrUndef(lastPropsOrEmpty[prop])) {
          patchProp(prop, lastPropsOrEmpty[prop], null, dom, isSVG, hasControlledValue, lastVNode);
        }
      }
    }
  }
  const nextChildren = nextVNode.children;
  const nextRef = nextVNode.ref;
  const nextClassName = nextVNode.className;

  if (process.env.NODE_ENV !== 'production') {
    validateKeys(nextVNode);
  }
  if (nextFlags & VNodeFlags.ContentEditable) {
    patchContentEditableChildren(dom, nextChildren);
  } else {
    patchChildren(
      lastVNode.childFlags,
      nextVNode.childFlags,
      lastVNode.children,
      nextChildren,
      dom,
      context,
      isSVG && nextVNode.type !== 'foreignObject',
      null,
      lastVNode
    );
  }

  if (isFormElement) {
    processElement(nextFlags, nextVNode, dom, nextPropsOrEmpty, false, hasControlledValue);
  }
  // inlined patchProps  -- ends --
  if (lastVNode.className !== nextClassName) {
    if (isNullOrUndef(nextClassName)) {
      dom.removeAttribute('class');
    } else if (isSVG) {
      dom.setAttribute('class', nextClassName);
    } else {
      dom.className = nextClassName;
    }
  }
  if (isFunction(nextRef) && lastVNode.ref !== nextRef) {
    mountRef(dom as Element, nextRef);
  } else {
    if (process.env.NODE_ENV !== 'production') {
      if (isString(nextRef)) {
        throwError('string "refs" are not supported in Inferno 1.0. Use callback "refs" instead.');
      }
    }
  }
}

function patchChildren(
  lastChildFlags: ChildFlags,
  nextChildFlags: ChildFlags,
  lastChildren,
  nextChildren,
  parentDOM: Element,
  context: Object,
  isSVG: boolean,
  nextNode: Element | null,
  parentVNode: VNode
) {
  switch (lastChildFlags) {
    case ChildFlags.HasVNodeChildren:
      switch (nextChildFlags) {
        case ChildFlags.HasVNodeChildren:
          patch(lastChildren, nextChildren, parentDOM, context, isSVG, nextNode);
          break;
        case ChildFlags.HasInvalidChildren:
          remove(lastChildren, parentDOM);
          break;
        case ChildFlags.HasTextChildren:
          unmount(lastChildren);
          mountTextContent(parentDOM, nextChildren);
          break;
        default:
          remove(lastChildren, parentDOM);
          mountArrayChildren(nextChildren, parentDOM, context, isSVG, nextNode);
          break;
      }
      break;
    case ChildFlags.HasInvalidChildren:
      switch (nextChildFlags) {
        case ChildFlags.HasVNodeChildren:
          mount(nextChildren, parentDOM, context, isSVG, nextNode);
          break;
        case ChildFlags.HasInvalidChildren:
          break;
        case ChildFlags.HasTextChildren:
          mountTextContent(parentDOM, nextChildren);
          break;
        default:
          mountArrayChildren(nextChildren, parentDOM, context, isSVG, nextNode);
          break;
      }
      break;
    case ChildFlags.HasTextChildren:
      switch (nextChildFlags) {
        case ChildFlags.HasTextChildren:
          patchSingleTextChild(lastChildren, nextChildren, parentDOM);
          break;
        case ChildFlags.HasVNodeChildren:
          removeTextNode(parentDOM);
          mount(nextChildren, parentDOM, context, isSVG, nextNode);
          break;
        case ChildFlags.HasInvalidChildren:
          removeTextNode(parentDOM);
          break;
        default:
          removeTextNode(parentDOM);
          mountArrayChildren(nextChildren, parentDOM, context, isSVG, nextNode);
          break;
      }
      break;
    default:
      switch (nextChildFlags) {
        case ChildFlags.HasTextChildren:
          unmountAllChildren(lastChildren);
          mountTextContent(parentDOM, nextChildren);
          break;
        case ChildFlags.HasVNodeChildren:
          removeAllChildren(parentDOM, parentVNode, lastChildren);
          mount(nextChildren, parentDOM, context, isSVG, nextNode);
          break;
        case ChildFlags.HasInvalidChildren:
          removeAllChildren(parentDOM, parentVNode, lastChildren);
          break;
        default:
          const lastLength = lastChildren.length;
          const nextLength = nextChildren.length;

          // Fast path's for both algorithms
          if (lastLength === 0) {
            if (nextLength > 0) {
              mountArrayChildren(nextChildren, parentDOM, context, isSVG, nextNode);
            }
          } else if (nextLength === 0) {
            removeAllChildren(parentDOM, parentVNode, lastChildren);
          } else if (nextChildFlags === ChildFlags.HasKeyedChildren && lastChildFlags === ChildFlags.HasKeyedChildren) {
            patchKeyedChildren(lastChildren, nextChildren, parentDOM, context, isSVG, lastLength, nextLength, nextNode, parentVNode);
          } else {
            patchNonKeyedChildren(lastChildren, nextChildren, parentDOM, context, isSVG, lastLength, nextLength, nextNode);
          }
          break;
      }
  }
}

export function updateClassComponent(
  instance,
  nextState,
  nextProps,
  parentDom: Element,
  context,
  isSVG: boolean,
  force: boolean,
  fromSetState: boolean,
  nextNode: Element | null
) {
  const lastState = instance.state;
  const lastProps = instance.props;
  let renderOutput;

  if (instance.$UN) {
    if (process.env.NODE_ENV !== 'production') {
      warning(
        'Inferno Error: Can only update a mounted or mounting component. This usually means you called setState() or forceUpdate() on an unmounted component. This is a no-op.'
      );
    }
    return;
  }
  if (lastProps !== nextProps || nextProps === EMPTY_OBJ) {
    if (!fromSetState && isFunction(instance.componentWillReceiveProps)) {
      instance.$BR = true;
      instance.componentWillReceiveProps(nextProps, context);
      // If instance component was removed during its own update do nothing...
      if (instance.$UN) {
        return;
      }
      instance.$BR = false;
    }
    if (instance.$PSS) {
      nextState = combineFrom(nextState, instance.$PS) as any;
      instance.$PSS = false;
      instance.$PS = null;
    }
  }
  /* Update if scu is not defined, or it returns truthy value or force */
  const hasSCU = Boolean(instance.shouldComponentUpdate);

  if (force || !hasSCU || (hasSCU && (instance.shouldComponentUpdate as Function)(nextProps, nextState, context))) {
    if (isFunction(instance.componentWillUpdate)) {
      instance.$BS = true;
      instance.componentWillUpdate(nextProps, nextState, context);
      instance.$BS = false;
    }

    instance.props = nextProps;
    instance.state = nextState;
    instance.context = context;

    if (isFunction(options.beforeRender)) {
      options.beforeRender(instance);
    }
    renderOutput = instance.render(nextProps, nextState, context);

    if (isFunction(options.afterRender)) {
      options.afterRender(instance);
    }

    const didUpdate = renderOutput !== NO_OP;

    let childContext;
    if (isFunction(instance.getChildContext)) {
      childContext = instance.getChildContext();
    }
    if (isNullOrUndef(childContext)) {
      childContext = context;
    } else {
      childContext = combineFrom(context, childContext);
    }
    instance.$CX = childContext;

    if (didUpdate) {
      const lastInput = instance.$LI;
      const nextInput = handleComponentInput(renderOutput);

      patch(lastInput, nextInput, parentDom, childContext, isSVG, nextNode);

      // Dont update Last input, until patch has been succesfully executed
      instance.$LI = nextInput;

      if (isFunction(instance.componentDidUpdate)) {
        instance.componentDidUpdate(lastProps, lastState);
      }
    }
  } else {
    instance.props = nextProps;
    instance.state = nextState;
    instance.context = context;
  }
}

function patchComponent(lastVNode, nextVNode, parentDom, context, isSVG: boolean, isClass: boolean, nextNode: Element | null): void {
  const nextProps = nextVNode.props || EMPTY_OBJ;

  if (isClass) {
    const instance = nextVNode.children = lastVNode.children;
    instance.$UPD = true;
    updateClassComponent(instance, instance.state, nextProps, parentDom, context, isSVG, false, false, nextNode);
    instance.$UPD = false;
  } else {
    let shouldUpdate: any = true;
    const lastProps = lastVNode.props;
    const nextHooks = nextVNode.ref;
    const nextHooksDefined = !isNullOrUndef(nextHooks);
    const lastInput = lastVNode.children;

    nextVNode.children = lastInput;

    if (nextHooksDefined && isFunction(nextHooks.onComponentShouldUpdate)) {
      shouldUpdate = nextHooks.onComponentShouldUpdate(lastProps, nextProps);
    }

    if (shouldUpdate !== false) {
      if (nextHooksDefined && isFunction(nextHooks.onComponentWillUpdate)) {
        nextHooks.onComponentWillUpdate(lastProps, nextProps);
      }
      let nextInput = nextVNode.type(nextProps, context);

      if (nextInput !== NO_OP) {
        nextInput = handleComponentInput(nextInput);
        patch(lastInput, nextInput, parentDom, context, isSVG, nextNode);
        nextVNode.children = nextInput;
        if (nextHooksDefined && isFunction(nextHooks.onComponentDidUpdate)) {
          nextHooks.onComponentDidUpdate(lastProps, nextProps);
        }
      }
    }
  }
}

function patchText(lastVNode: VNode, nextVNode: VNode) {
  const nextText = nextVNode.children as string;
  const dom = lastVNode.dom;

  if (nextText !== lastVNode.children) {
    (dom as Element).nodeValue = nextText;
  }

  nextVNode.dom = dom;
}

function patchNonKeyedChildren(lastChildren, nextChildren, dom, context: Object, isSVG: boolean, lastChildrenLength: number, nextChildrenLength: number, nextNode: Element | null) {
  const commonLength = lastChildrenLength > nextChildrenLength ? nextChildrenLength : lastChildrenLength;
  let i = 0;
  let nextChild;
  let lastChild;

  for (; i < commonLength; i++) {
    nextChild = nextChildren[i];
    lastChild = lastChildren[i];

    if (nextChild.flags & VNodeFlags.InUse) {
      nextChild = nextChildren[i] = directClone(nextChild);
    }

    patch(lastChild, nextChild, dom, context, isSVG, nextNode);
    lastChildren[i] = nextChild;
  }
  if (lastChildrenLength < nextChildrenLength) {
    for (i = commonLength; i < nextChildrenLength; i++) {
      nextChild = nextChildren[i];

      if (nextChild.flags & VNodeFlags.InUse) {
        nextChild = nextChildren[i] = directClone(nextChild);
      }
      mount(nextChild, dom, context, isSVG, nextNode);
    }
  } else if (lastChildrenLength > nextChildrenLength) {
    for (i = commonLength; i < lastChildrenLength; i++) {
      remove(lastChildren[i], dom);
    }
  }
}

function patchKeyedChildren(a: VNode[], b: VNode[], dom, context, isSVG: boolean, aLength: number, bLength: number, outerEdge: Element | null, parentVNode: VNode) {
  let aEnd = aLength - 1;
  let bEnd = bLength - 1;
  let i: number;
  let j: number = 0;
  let aNode: VNode = a[j];
  let bNode: VNode = b[j];
  let nextPos: number;
  let nextNode;

  // Step 1
  // tslint:disable-next-line
  outer: {
    // Sync nodes with the same key at the beginning.
    while (aNode.key === bNode.key) {
      if (bNode.flags & VNodeFlags.InUse) {
        b[j] = bNode = directClone(bNode);
      }
      patch(aNode, bNode, dom, context, isSVG, outerEdge);
      a[j] = bNode;
      j++;
      if (j > aEnd || j > bEnd) {
        break outer;
      }
      aNode = a[j];
      bNode = b[j];
    }

    aNode = a[aEnd];
    bNode = b[bEnd];

    // Sync nodes with the same key at the end.
    while (aNode.key === bNode.key) {
      if (bNode.flags & VNodeFlags.InUse) {
        b[bEnd] = bNode = directClone(bNode);
      }
      patch(aNode, bNode, dom, context, isSVG, outerEdge);
      a[aEnd] = bNode;
      aEnd--;
      bEnd--;
      if (j > aEnd || j > bEnd) {
        break outer;
      }
      aNode = a[aEnd];
      bNode = b[bEnd];
    }
  }

  if (j > aEnd) {
    if (j <= bEnd) {
      nextPos = bEnd + 1;
      nextNode = nextPos < bLength ? findDOMfromVNode(b[nextPos]) : outerEdge;

      while (j <= bEnd) {
        bNode = b[j];
        if (bNode.flags & VNodeFlags.InUse) {
          b[j] = bNode = directClone(bNode);
        }
        j++;
        mount(bNode, dom, context, isSVG, nextNode);
      }
    }
  } else if (j > bEnd) {
    while (j <= aEnd) {
      remove(a[j++], dom);
    }
  } else {
    let aStart = j;
    const bStart = j;
    const aLeft: number = aEnd - j + 1;
    const bLeft: number = bEnd - j + 1;
    const sources: number[] = [];
    for (i = 0; i < bLeft; i++) {
      sources.push(0);
    }
    // Keep track if its possible to remove whole DOM using textContent = '';
    let canRemoveWholeContent: boolean = aLeft === aLength;
    let moved: boolean = false;
    let pos: number = 0;
    let patched: number = 0;

    // When sizes are small, just loop them through
    if (bLength < 4 || (aLeft | bLeft) < 32) {
      for (i = aStart; i <= aEnd; i++) {
        aNode = a[i];
        if (patched < bLeft) {
          for (j = bStart; j <= bEnd; j++) {
            bNode = b[j];
            if (aNode.key === bNode.key) {
              sources[j - bStart] = i + 1;
              if (canRemoveWholeContent) {
                canRemoveWholeContent = false;
                while (i > aStart) {
                  remove(a[aStart++], dom);
                }
              }
              if (pos > j) {
                moved = true;
              } else {
                pos = j;
              }
              if (bNode.flags & VNodeFlags.InUse) {
                b[j] = bNode = directClone(bNode);
              }
              patch(aNode, bNode, dom, context, isSVG, outerEdge);
              patched++;
              break;
            }
          }
          if (!canRemoveWholeContent && j > bEnd) {
            remove(aNode, dom);
          }
        } else if (!canRemoveWholeContent) {
          remove(aNode, dom);
        }
      }
    } else {
      const keyIndex: Record<string, number> = {};

      // Map keys by their index
      for (i = bStart; i <= bEnd; i++) {
        keyIndex[b[i].key as string | number] = i;
      }

      // Try to patch same keys
      for (i = aStart; i <= aEnd; i++) {
        aNode = a[i];

        if (patched < bLeft) {
          j = keyIndex[aNode.key as string | number];

          if (j !== void 0) {
            if (canRemoveWholeContent) {
              canRemoveWholeContent = false;
              while (i > aStart) {
                remove(a[aStart++], dom);
              }
            }
            bNode = b[j];
            sources[j - bStart] = i + 1;
            if (pos > j) {
              moved = true;
            } else {
              pos = j;
            }
            if (bNode.flags & VNodeFlags.InUse) {
              b[j] = bNode = directClone(bNode);
            }
            patch(aNode, bNode, dom, context, isSVG, outerEdge);
            patched++;
          } else if (!canRemoveWholeContent) {
            remove(aNode, dom);
          }
        } else if (!canRemoveWholeContent) {
          remove(aNode, dom);
        }
      }
    }
    // fast-path: if nothing patched remove all old and add all new
    if (canRemoveWholeContent) {
      removeAllChildren(dom, parentVNode, a);
      mountArrayChildren(b, dom, context, isSVG, outerEdge);
    } else {
      if (moved) {
        const seq = lis_algorithm(sources);
        j = seq.length - 1;
        for (i = bLeft - 1; i >= 0; i--) {
          if (sources[i] === 0) {
            pos = i + bStart;
            bNode = b[pos];
            if (bNode.flags & VNodeFlags.InUse) {
              b[pos] = bNode = directClone(bNode);
            }
            nextPos = pos + 1;
            mount(bNode, dom, context, isSVG, nextPos < bLength ? findDOMfromVNode(b[nextPos]): outerEdge);
          } else if (j < 0 || i !== seq[j]) {
            pos = i + bStart;
            bNode = b[pos];
            nextPos = pos + 1;
            nextNode = nextPos < bLength ? findDOMfromVNode(b[nextPos]) : outerEdge;

            if ((bNode.flags & VNodeFlags.Fragment) && bNode.childFlags & ChildFlags.MultipleChildren) {
              for (let k = 0, len = (bNode.children as VNode[]).length; k < len; k++) {
                insertOrAppend(dom, findDOMfromVNode((bNode.children as VNode[])[k]), nextNode);
              }
            } else {
              insertOrAppend(dom, findDOMfromVNode(bNode), nextNode);
            }
          } else {
            j--;
          }
        }
      } else if (patched !== bLeft) {
        // when patched count doesn't match b length we need to insert those new ones
        // loop backwards so we can use insertBefore
        for (i = bLeft - 1; i >= 0; i--) {
          if (sources[i] === 0) {
            pos = i + bStart;
            bNode = b[pos];
            if (bNode.flags & VNodeFlags.InUse) {
              b[pos] = bNode = directClone(bNode);
            }
            nextPos = pos + 1;
            mount(bNode, dom, context, isSVG, nextPos < bLength ? findDOMfromVNode(b[nextPos]): outerEdge);
          }
        }
      }
    }
  }
}

// https://en.wikipedia.org/wiki/Longest_increasing_subsequence
function lis_algorithm(arr: number[]): number[] {
  const p = arr.slice();
  const result: number[] = [0];
  let i;
  let j;
  let u;
  let v;
  let c;
  const len = arr.length;

  for (i = 0; i < len; i++) {
    const arrI = arr[i];

    if (arrI !== 0) {
      j = result[result.length - 1];
      if (arr[j] < arrI) {
        p[i] = j;
        result.push(i);
        continue;
      }

      u = 0;
      v = result.length - 1;

      while (u < v) {
        c = ((u + v) / 2) | 0;
        if (arr[result[c]] < arrI) {
          u = c + 1;
        } else {
          v = c;
        }
      }

      if (arrI < arr[result[u]]) {
        if (u > 0) {
          p[i] = result[u - 1];
        }
        result[u] = i;
      }
    }
  }

  u = result.length;
  v = result[u - 1];

  while (u-- > 0) {
    result[u] = v;
    v = p[v];
  }

  return result;
}
