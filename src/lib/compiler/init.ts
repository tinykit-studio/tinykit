import { registerProcessors } from './component.js'
import * as processors from './processors.js'

// Register the HTML and CSS processors
registerProcessors({
	html: processors.html,
	css: processors.css
})

export { processCode, processCSS } from './utils'
export { dynamic_iframe_srcdoc, static_iframe_srcdoc, generate_design_css } from './iframe.js'
export { extract_web_fonts } from './fonts.js'
