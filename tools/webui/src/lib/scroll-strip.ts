// Native touch scrolling plus mouse dragging, wheel and keyboard navigation.
export function scrollStrip(node: HTMLElement) {
	let startX = 0, startScroll = 0, pointer: number | undefined, dragged = false;
	function down(event: PointerEvent) {
		if (event.pointerType !== 'mouse' || event.button !== 0) return;
		pointer = event.pointerId;
		startX = event.clientX;
		startScroll = node.scrollLeft;
		dragged = false;
	}
	function move(event: PointerEvent) {
		if (event.pointerId !== pointer) return;
		const distance = event.clientX - startX;
		if (!dragged && Math.abs(distance) < 6) return;
		if (!dragged) {
			dragged = true;
			node.setPointerCapture(event.pointerId);
			node.classList.add('is-dragging');
		}
		event.preventDefault();
		node.scrollLeft = startScroll - distance;
	}
	function up(event: PointerEvent) {
		if (event.pointerId !== pointer) return;
		if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
		pointer = undefined;
		node.classList.remove('is-dragging');
	}
	function click(event: MouseEvent) {
		if (dragged && event.detail !== 0) {
			event.preventDefault();
			event.stopImmediatePropagation();
		}
		dragged = false;
	}
	function wheel(event: WheelEvent) {
		if (event.ctrlKey) return;
		const delta = (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY)
			* (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientWidth : 1);
		const before = node.scrollLeft;
		node.scrollLeft += delta;
		if (node.scrollLeft !== before) event.preventDefault();
	}
	function key(event: KeyboardEvent) {
		if (event.target !== node) return;
		const offsets: Record<string, number> = { ArrowLeft: -180, ArrowRight: 180, Home: -node.scrollWidth, End: node.scrollWidth };
		if (!(event.key in offsets)) return;
		event.preventDefault();
		node.scrollLeft += offsets[event.key];
	}
	const noImageDrag = (event: DragEvent) => event.preventDefault();
	node.addEventListener('pointerdown', down);
	window.addEventListener('pointermove', move);
	window.addEventListener('pointerup', up);
	window.addEventListener('pointercancel', up);
	node.addEventListener('click', click, true);
	node.addEventListener('wheel', wheel, { passive: false });
	node.addEventListener('keydown', key);
	node.addEventListener('dragstart', noImageDrag);
	return { destroy() {
		node.removeEventListener('pointerdown', down);
		window.removeEventListener('pointermove', move);
		window.removeEventListener('pointerup', up);
		window.removeEventListener('pointercancel', up);
		node.removeEventListener('click', click, true);
		node.removeEventListener('wheel', wheel);
		node.removeEventListener('keydown', key);
		node.removeEventListener('dragstart', noImageDrag);
	} };
}
