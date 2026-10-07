import type { MusicStyleProfile } from './style-profiles.js';

// Portal to body so the explanation is never clipped by the scrolling style grid.
export function styleTooltip(node: HTMLElement, initial: MusicStyleProfile) {
	let style = initial;
	let popup: HTMLDivElement | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const id = `style-help-${crypto.randomUUID()}`;
	function hide() {
		clearTimeout(timer);
		popup?.remove(); popup = undefined;
		node.removeAttribute('aria-describedby');
	}
	function position() {
		if (!popup) return;
		const box = node.getBoundingClientRect();
		const width = Math.min(360, window.innerWidth - 24);
		popup.style.width = `${width}px`;
		popup.style.maxHeight = `${Math.min(480, window.innerHeight - 32)}px`;
		const height = popup.getBoundingClientRect().height;
		const right = box.right + 12;
		const left = right + width <= window.innerWidth - 12 ? right : Math.max(12, box.left - width - 12);
		popup.style.left = `${Math.min(left, window.innerWidth - width - 12)}px`;
		popup.style.top = `${Math.max(12, Math.min(box.top, window.innerHeight - height - 12))}px`;
	}
	function show() {
		clearTimeout(timer);
		if (popup) return;
		popup = document.createElement('div');
		popup.className = 'style-explanation'; popup.id = id; popup.setAttribute('role', 'tooltip');
		function append(tag: string, text: string, className = '') {
			const el = document.createElement(tag); el.textContent = text; el.className = className; popup!.append(el);
		}
		append('h4', style.name);
		const tempo = style.profile.match(/^\*\*Typical tempo:\*\*\s*(.+)$/m)?.[1];
		append('p', [style.family, tempo].filter(Boolean).join(' · '), 'style-explanation-meta');
		const sections = new Map([...style.profile.matchAll(/^## (.+)\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)].map(match => [match[1].trim(), match[2].trim()]));
		const identity = sections.get('Core Identity');
		if (identity) append('p', identity, 'style-explanation-intro');
		for (const [key, label] of [['Rhythm & Drums', 'Rhythm & drums'], ['Bass & Low End', 'Bass'], ['Harmony, Melody & Sound Palette', 'Sounds & instruments'], ['Vocal / Rap Approach', 'Vocal delivery'], ['Mood & Energy', 'Mood & energy']]) {
			const value = sections.get(key);
			if (value) { append('strong', label); append('p', value); }
		}
		popup.addEventListener('mouseenter', () => clearTimeout(timer));
		popup.addEventListener('mouseleave', leave);
		document.body.append(popup); node.setAttribute('aria-describedby', id); position();
	}
	function enter() { clearTimeout(timer); timer = setTimeout(show, 200); }
	function leave() { clearTimeout(timer); timer = setTimeout(hide, 180); }
	function key(event: KeyboardEvent) { if (event.key === 'Escape') hide(); }
	node.addEventListener('mouseenter', enter); node.addEventListener('mouseleave', leave);
	node.addEventListener('focus', show); node.addEventListener('blur', leave);
	document.addEventListener('keydown', key);
	window.addEventListener('resize', hide); window.addEventListener('scroll', position, true);
	return {
		update(next: MusicStyleProfile) { style = next; },
		destroy() {
			hide(); node.removeEventListener('mouseenter', enter); node.removeEventListener('mouseleave', leave);
			node.removeEventListener('focus', show); node.removeEventListener('blur', leave);
			document.removeEventListener('keydown', key); window.removeEventListener('resize', hide); window.removeEventListener('scroll', position, true);
		}
	};
}
