import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs))
}

// Type helper for components that expose element refs
export type WithElementRef<T, E extends HTMLElement = HTMLElement> = T & {
	ref?: E | null
}

export function click_outside(node: HTMLElement) {
	const handle_click = (event: MouseEvent) => {
		if (node && !node.contains(event.target as Node) && !event.defaultPrevented) {
			node.dispatchEvent(new CustomEvent('click_outside'))
		}
	}

	document.addEventListener('click', handle_click, true)

	return {
		destroy() {
			document.removeEventListener('click', handle_click, true)
		}
	}
}
