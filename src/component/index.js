import Lifecycle from './../core/lifecycle';
import { isNullOrUndefined } from './../core/utils';
import { getActiveNode, resetActiveNode } from './../DOM/utils';

const noOp = 'Inferno Warning: Can only update a mounted or mounting component. This usually means you called setState() or forceUpdate() on an unmounted component. This is a no-op.';

function queueStateChanges(component, newState, callback) {
	for (let stateKey in newState) {
		component._pendingState[stateKey] = newState[stateKey];
	}
	if (component._pendingSetState === false) {
		component._pendingSetState = true;
		applyState(component, false, callback);
	}
}

function applyState(component, force, callback) {
	if (component._deferSetState === false || force) {
		component._pendingSetState = false;
		const pendingState = component._pendingState;
		const oldState = component.state;
		const nextState = { ...oldState, ...pendingState };

		component._pendingState = {};
		const nextNode = component._updateComponent(oldState, nextState, component.props, component.props, force);
		const lastNode = component._lastNode;
		const parentDom = lastNode.dom.parentNode;

		const activeNode = getActiveNode();
		const subLifecycle = new Lifecycle();
		component._patchNode(lastNode, nextNode, parentDom, subLifecycle, component.context, null, false);
		component._lastNode = nextNode;
		subLifecycle.addListener(() => {
			subLifecycle.trigger();
			callback && callback();
		});
		resetActiveNode(activeNode);
	}
}

export default class Component {
	constructor(props) {
		/** @type {object} */
		this.props = props || {};

		/** @type {object} */
		this.state = {};

		/** @type {object} */
		this.refs = {};
		this._blockSetState = false;
		this._deferSetState = false;
		this._pendingSetState = false;
		this._pendingState = {};
		this._lastNode = null;
		this._unmounted = false;
		this.context = {};
		this._patchNode = null;
	}
	render() {}
	forceUpdate(callback) {
		if (this._unmounted === true) {
			throw Error(noOp);
		}
		applyState(this, true, callback);
	}
	setState(newState, callback) {
		if (this._unmounted === true) {
			throw Error(noOp);
		}
		if (this._blockSetState === false) {
			queueStateChanges(this, newState, callback);
		} else {
			throw Error('Inferno Warning: Cannot update state via setState() in componentWillUpdate()');
		}
	}
	componentDidMount() {}
	componentWillMount() {}
	componentWillUnmount() {}
	componentDidUpdate() {}
	shouldComponentUpdate() { return true; }
	componentWillReceiveProps() {}
	componentWillUpdate() {}
	getChildContext() {}
	_updateComponent(prevState, nextState, prevProps, nextProps, force) {
		if (this._unmounted === true) {
			this._unmounted = false;
			return false;
		}
		if (!isNullOrUndefined(nextProps) && isNullOrUndefined(nextProps.children)) {
			nextProps.children = prevProps.children;
		}
		if (prevProps !== nextProps || prevState !== nextState || force) {
			if (prevProps !== nextProps) {
				this._blockSetState = true;
				this.componentWillReceiveProps(nextProps);
				this._blockSetState = false;
			}
			const shouldUpdate = this.shouldComponentUpdate(nextProps, nextState);

			if (shouldUpdate !== false) {
				this._blockSetState = true;
				this.componentWillUpdate(nextProps, nextState);
				this._blockSetState = false;
				this.props = nextProps;
				this.state = nextState;
				const node = this.render();

				this.componentDidUpdate(prevProps, prevState);
				return node;
			}
		}
	}
}
