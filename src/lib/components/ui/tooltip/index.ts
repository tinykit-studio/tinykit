import { Tooltip as TooltipPrimitive } from "bits-ui"
import Content from "./tooltip-content.svelte"

const Root = TooltipPrimitive.Root
const Trigger = TooltipPrimitive.Trigger
const Provider = TooltipPrimitive.Provider

export {
	Root,
	Content,
	Trigger,
	Provider,
	//
	Root as Tooltip,
	Content as TooltipContent,
	Trigger as TooltipTrigger,
	Provider as TooltipProvider
}
