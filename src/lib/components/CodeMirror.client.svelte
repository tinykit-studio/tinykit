<script lang="ts" module>
  // Module-level caches (survive component remounts)
  const scroll_cache = new Map<string, number>();
  const folds_cache = new Map<string, Array<{ from: number; to: number }>>();
</script>

<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher, tick } from "svelte";
  import { fade } from "svelte/transition";
  import { debounce } from "lodash-es";
  import { current_builder_theme } from "$lib/builder_themes";
  import { watch } from "runed";
  import type { EditorSnapshot } from "../../routes/tinykit/types";

  let {
    value = "",
    language = "html",
    onChange = () => {},
    cache_key = "", // Key for scroll position cache (e.g., file path)
    initial_snapshot = null as EditorSnapshot | null,
    onSnapshotChange = (_snapshot: EditorSnapshot) => {},
    disable_mobile_focus = true, // Prevent auto-focus on mobile
  } = $props();

  // Detect mobile device
  const is_mobile = typeof window !== "undefined" &&
    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  const dispatch = createEventDispatcher();

  // Debounce onChange to reduce reactive cascade on every keystroke
  const debounced_onChange = debounce((value: string) => {
    onChange(value);
  }, 150);

  let containerElement: HTMLDivElement;
  let wrapperElement: HTMLDivElement;
  let editorElement: HTMLDivElement;
  let editorView: any;
  let is_focused = $state(false);
  let mod_key_held = $state(false);
  let theme_compartment: any;
  let language_compartment: any;
  let emmet_compartment: any;
  let EditorView: any;
  let EditorState: any;
  let Compartment: any;
  let foldedRanges: any;
  let foldEffect: any;
  let extensionsModule: any;

  // Class style tooltip state
  let tooltip_visible = $state(false);
  let tooltip_x = $state(0);
  let tooltip_y = $state(0);
  let tooltip_class = $state("");
  let tooltip_editable = $state(false);
  let tooltip_rules: Array<{
    selector: string;
    properties: string;
    original_full: string;
    media_query?: string;
  }> = [];
  let tooltip_editor_element: HTMLDivElement;
  let tooltip_editor_view: any;
  let tooltip_save_timeout: ReturnType<typeof setTimeout> | null = null;
  let tooltip_theme_compartment: any;

  // Helper: extract word at position
  function get_word_at_pos(
    doc: string,
    pos: number,
  ): { word: string; start: number; end: number } | null {
    const word_chars = /[a-zA-Z0-9_-]/;
    let start = pos;
    let end = pos;

    while (start > 0 && word_chars.test(doc[start - 1])) start--;
    while (end < doc.length && word_chars.test(doc[end])) end++;

    if (start === end) return null;
    return { word: doc.slice(start, end), start, end };
  }

  // Helper: check if position is inside a class attribute
  function is_in_class_attr(doc: string, pos: number): boolean {
    // Look backwards for class=" and ensure we haven't passed a closing "
    const before = doc.slice(Math.max(0, pos - 200), pos);
    const class_match = before.match(/class\s*=\s*["']([^"']*)$/);
    return class_match !== null;
  }

  // Helper: parse CSS from style blocks - returns rules with properties
  function extract_styles_for_class(
    doc: string,
    class_name: string,
  ): Array<{
    selector: string;
    properties: string;
    original_full: string;
    media_query?: string;
  }> {
    // Break up the regex pattern to avoid confusing the Svelte preprocessor
    const style_regex = new RegExp(
      "<" + "style[^>]*>([\\s\\S]*?)</" + "style>",
      "i",
    );
    const style_match = doc.match(style_regex);
    if (!style_match) return [];

    const css = style_match[1];
    const rules: Array<{
      selector: string;
      properties: string;
      original_full: string;
      media_query?: string;
    }> = [];

    const class_pattern = new RegExp(`\\.${class_name}(?:[.:\\s\\[,]|$)`);

    // First, extract rules NOT in media queries
    // Remove media query blocks temporarily to get top-level rules
    const css_without_media = css.replace(/@media[^{]+\{[\s\S]*?\}\s*\}/g, "");
    const rule_regex = /([^{}]+)\{([^{}]+)\}/g;
    let match;

    while ((match = rule_regex.exec(css_without_media)) !== null) {
      const selector = match[1].trim();
      const raw_props = match[2].trim();
      const original_full = match[0];

      if (class_pattern.test(selector)) {
        const properties =
          raw_props
            .split(";")
            .map((p) => p.trim())
            .filter((p) => p)
            .join(";\n") + ";";
        rules.push({ selector, properties, original_full });
      }
    }

    // Now extract rules inside media queries
    const media_regex = /@media\s*([^{]+)\{([\s\S]*?\})\s*\}/g;
    let media_match;

    while ((media_match = media_regex.exec(css)) !== null) {
      const media_condition = media_match[1].trim();
      const media_content = media_match[2];

      // Find rules inside this media query
      const inner_rule_regex = /([^{}]+)\{([^{}]+)\}/g;
      let inner_match;

      while ((inner_match = inner_rule_regex.exec(media_content)) !== null) {
        const selector = inner_match[1].trim();
        const raw_props = inner_match[2].trim();

        if (class_pattern.test(selector)) {
          const properties =
            raw_props
              .split(";")
              .map((p) => p.trim())
              .filter((p) => p)
              .join(";\n") + ";";
          // For media query rules, the original_full needs to include context
          // but for replacement we need just the inner rule
          rules.push({
            selector,
            properties,
            original_full: inner_match[0],
            media_query: `@media ${media_condition}`,
          });
        }
      }
    }

    return rules;
  }

  function hide_tooltip() {
    if (tooltip_save_timeout) {
      clearTimeout(tooltip_save_timeout);
      tooltip_save_timeout = null;
    }
    if (tooltip_editor_view) {
      tooltip_editor_view.destroy();
      tooltip_editor_view = null;
    }
    tooltip_visible = false;
    tooltip_editable = false;
  }

  function debounced_tooltip_save() {
    if (tooltip_save_timeout) clearTimeout(tooltip_save_timeout);
    tooltip_save_timeout = setTimeout(() => {
      save_tooltip_styles_silent();
    }, 500);
  }

  function save_tooltip_styles_silent() {
    if (!editorView || !tooltip_rules.length || !tooltip_editor_view) return;

    let doc = editorView.state.doc.toString();
    const edited_text = tooltip_editor_view.state.doc.toString();

    // Parse full CSS rules from editor (selector { props })
    const rule_regex = /([^{}]+)\{([^{}]+)\}/g;
    const edited_rules: Array<{ selector: string; props: string }> = [];
    let match;
    while ((match = rule_regex.exec(edited_text)) !== null) {
      edited_rules.push({
        selector: match[1].trim(),
        props: match[2].trim(),
      });
    }

    // Replace each original rule with edited version
    for (let i = 0; i < tooltip_rules.length; i++) {
      const rule = tooltip_rules[i];
      const edited = edited_rules[i];
      if (!edited) continue;

      // Format properties: one per line, indented
      const props_formatted = edited.props
        .split(/[;\n]+/)
        .map((p: string) => p.trim())
        .filter((p: string) => p)
        .map((p: string) => (p.endsWith(";") ? p : p + ";"))
        .join("\n    ");

      // Add newline before if the original didn't have one (to separate from previous rule)
      const rule_index = doc.indexOf(rule.original_full);
      const char_before = rule_index > 0 ? doc[rule_index - 1] : "\n";
      const needs_newline = char_before !== "\n";

      const new_rule = `${needs_newline ? "\n  " : ""}${edited.selector} {\n    ${props_formatted}\n  }`;
      doc = doc.replace(rule.original_full, new_rule);
      // Update for next save (store without the prefix newline)
      tooltip_rules[i] = {
        ...rule,
        selector: edited.selector,
        original_full: `${edited.selector} {\n    ${props_formatted}\n  }`,
      };
    }

    // Update the main editor (updateListener will call debounced_onChange)
    editorView.dispatch({
      changes: {
        from: 0,
        to: editorView.state.doc.length,
        insert: doc,
      },
    });
  }

  function show_class_tooltip(event: MouseEvent, view: any) {
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) return;

    const doc = view.state.doc.toString();
    const word_info = get_word_at_pos(doc, pos);

    if (!word_info) return;
    if (!is_in_class_attr(doc, pos)) return;

    // Clean up previous tooltip if any
    if (tooltip_editor_view) {
      tooltip_editor_view.destroy();
      tooltip_editor_view = null;
    }
    if (tooltip_save_timeout) {
      clearTimeout(tooltip_save_timeout);
      tooltip_save_timeout = null;
    }

    const rules = extract_styles_for_class(doc, word_info.word);
    tooltip_class = word_info.word;
    tooltip_rules = rules;
    tooltip_editable = rules.length > 0;

    // Position tooltip near click, clamped to viewport
    const editor_rect = editorElement.getBoundingClientRect();
    const tooltip_width = 320;
    const tooltip_height = 280;

    // Calculate position relative to editor
    let x = event.clientX - editor_rect.left + 10;
    let y = event.clientY - editor_rect.top + 10;

    // Check if tooltip would go off-screen and flip/adjust
    if (event.clientX + tooltip_width + 20 > window.innerWidth) {
      x = event.clientX - editor_rect.left - tooltip_width - 10;
    }
    if (event.clientY + tooltip_height + 20 > window.innerHeight) {
      y = event.clientY - editor_rect.top - tooltip_height - 10;
    }

    // Ensure not negative
    tooltip_x = Math.max(10, x);
    tooltip_y = Math.max(10, y);
    tooltip_visible = true;

    // Create mini CodeMirror after DOM updates
    if (tooltip_editable) {
      requestAnimationFrame(() => {
        create_tooltip_editor();
      });
    }
  }

  async function create_tooltip_editor() {
    if (!tooltip_editor_element || !EditorView || !EditorState) return;

    // Build full CSS rules for proper syntax highlighting
    const full_css = tooltip_rules
      .map((r) => {
        // Indent each property line
        const indented_props = r.properties
          .split("\n")
          .map((line) => (line.trim() ? `  ${line.trim()}` : line))
          .join("\n");
        if (r.media_query) {
          return `/* ${r.media_query} */\n${r.selector} {\n${indented_props}\n}`;
        }
        return `${r.selector} {\n${indented_props}\n}`;
      })
      .join("\n\n");

    const [codemirror, themeModule, cssHighlight, view, state] =
      await Promise.all([
        import("codemirror"),
        import("./CodeMirror/theme"),
        import("@codemirror/lang-css"),
        import("@codemirror/view"),
        import("@codemirror/state"),
      ]);

    const themedEditor = themeModule.create_themed_editor();
    tooltip_theme_compartment = new state.Compartment();

    // Create decorations to gray out selector lines and closing braces, indent properties
    const selector_line_decoration = view.Decoration.line({
      class: "cm-selector-line",
    });
    const brace_line_decoration = view.Decoration.line({
      class: "cm-brace-line",
    });
    const property_line_decoration = view.Decoration.line({
      class: "cm-property-line",
    });
    const media_query_decoration = view.Decoration.line({
      class: "cm-media-query-line",
    });

    function create_wrapper_decorations(v: any) {
      const decorations: any[] = [];
      const doc = v.state.doc;
      let in_rule = false;

      for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i);
        const text = line.text.trim();

        // Media query comment line
        if (text.startsWith("/*") && text.includes("@media")) {
          decorations.push(media_query_decoration.range(line.from));
        }
        // Selector line (contains { but not just {)
        else if (text.includes("{") && !text.match(/^\{$/)) {
          decorations.push(selector_line_decoration.range(line.from));
          in_rule = true;
        }
        // Closing brace line
        else if (text === "}") {
          decorations.push(brace_line_decoration.range(line.from));
          in_rule = false;
        }
        // Property lines (inside rule, not empty)
        else if (in_rule && text) {
          decorations.push(property_line_decoration.range(line.from));
        }
      }

      return view.Decoration.set(decorations);
    }

    const wrapper_highlight = view.ViewPlugin.fromClass(
      class {
        decorations: any;
        constructor(v: any) {
          this.decorations = create_wrapper_decorations(v);
        }
        update(update: any) {
          if (update.docChanged) {
            this.decorations = create_wrapper_decorations(update.view);
          }
        }
      },
      { decorations: (v: any) => v.decorations },
    );

    tooltip_editor_view = new EditorView({
      state: EditorState.create({
        doc: full_css,
        extensions: [
          codemirror.basicSetup,
          cssHighlight.css(),
          tooltip_theme_compartment.of(themedEditor),
          wrapper_highlight,
          EditorView.theme({
            "&": { fontSize: is_mobile ? "16px" : "12px" },
            ".cm-scroller": {
              overflow: "auto",
              fontFamily: "JetBrains Mono, monospace",
            },
            ".cm-content": { padding: "8px" },
            ".cm-gutters": { display: "none" },
            ".cm-lineNumbers": { display: "none" },
            ".cm-activeLine": { background: "transparent" },
            ".cm-selector-line": { opacity: "0.5" },
            ".cm-brace-line": { opacity: "0.5" },
            ".cm-media-query-line": {
              opacity: "0.5",
              fontStyle: "italic",
            },
          }),
          EditorView.updateListener.of((update: any) => {
            if (update.docChanged) {
              debounced_tooltip_save();
            }
          }),
        ],
      }),
      parent: tooltip_editor_element,
    });
  }

  function save_tooltip_styles() {
    // Flush any pending save
    if (tooltip_save_timeout) {
      clearTimeout(tooltip_save_timeout);
      tooltip_save_timeout = null;
    }
    save_tooltip_styles_silent();
    hide_tooltip();
  }

  // Capture scroll position from wrapper element
  function capture_scroll() {
    if (!wrapperElement || !cache_key) return;
    scroll_cache.set(cache_key, wrapperElement.scrollTop);
  }

  // Capture folded ranges
  function capture_folds(foldedRanges: any) {
    if (!editorView || !cache_key || !foldedRanges) return;
    const folds: Array<{ from: number; to: number }> = [];
    try {
      const ranges = foldedRanges(editorView.state);
      const iter = ranges.iter();
      while (iter.value) {
        folds.push({ from: iter.from, to: iter.to });
        iter.next();
      }
    } catch (e) {
      // Folding may not be available
    }
    folds_cache.set(cache_key, folds);
  }

  // Restore folded ranges
  function restore_folds(foldEffect: any) {
    if (!editorView || !cache_key || !foldEffect) return;
    const folds = folds_cache.get(cache_key);
    if (!folds || folds.length === 0) return;
    try {
      const doc_length = editorView.state.doc.length;
      const effects = folds
        .filter((r) => r.from < doc_length && r.to <= doc_length)
        .map((r) => foldEffect.of({ from: r.from, to: r.to }));
      if (effects.length > 0) {
        editorView.dispatch({ effects });
      }
    } catch (e) {
      // Ignore fold restore errors
    }
  }

  onMount(async () => {
    // Dynamic imports to avoid SSR issues
    const [
      codemirror,
      state,
      view,
      commands,
      themeModule,
      extModule,
      prettierModule,
      prettierSvelteModule,
      prettierPostcssModule,
      prettierBabelModule,
      prettierEstreeModule,
      languageModule,
    ] = await Promise.all([
      import("codemirror"),
      import("@codemirror/state"),
      import("@codemirror/view"),
      import("@codemirror/commands"),
      import("./CodeMirror/theme"),
      import("./CodeMirror/extensions"),
      import("prettier"),
      import("prettier-plugin-svelte/browser"),
      import("prettier/plugins/postcss"),
      import("prettier/plugins/babel"),
      import("prettier/plugins/estree"),
      import("@codemirror/language"),
    ]);

    const { indentUnit, indentService, getIndentUnit } = languageModule;
    const { countColumn } = state;

    // Fallback indent service that provides smart indentation when language doesn't
    const fallbackIndent = indentService.of((context, pos) => {
      const prevLine = context.lineAt(pos, -1);
      if (!prevLine) return 0;

      const match = prevLine.text.match(/^(\s*)/);
      const leadingWS = match ? match[1] : "";
      // Use countColumn to properly handle tabs (converts to column position)
      const tabSize = context.state.tabSize;
      const baseIndent = countColumn(leadingWS, tabSize);
      const trimmed = prevLine.text.trim();

      // Increase indent after lines ending with opening braces/brackets or HTML tags
      if (
        trimmed.endsWith("{") ||
        trimmed.endsWith("(") ||
        trimmed.endsWith("[") ||
        (trimmed.startsWith("<") &&
          !trimmed.startsWith("</") &&
          !trimmed.endsWith("/>"))
      ) {
        return baseIndent + getIndentUnit(context.state);
      }

      return baseIndent;
    });

    EditorView = codemirror.EditorView;
    EditorState = state.EditorState;
    Compartment = state.Compartment;
    foldedRanges = languageModule.foldedRanges;
    foldEffect = languageModule.foldEffect;
    extensionsModule = extModule;
    theme_compartment = new Compartment();
    language_compartment = new Compartment();
    emmet_compartment = new Compartment();

    const languageExtension = extModule.getLanguage(language);
    const emmetExtensions = extModule.getEmmetExtensions(language);
    const themedEditor = themeModule.create_themed_editor();

    const detectModKey = EditorView.domEventHandlers({
      keydown(event: any, view: any) {
        if (event.metaKey || event.ctrlKey) {
          requestAnimationFrame(() => {
            mod_key_held = true;
          });
          return false;
        }
        return false;
      },
      keyup(event: any, view: any) {
        if (!event.metaKey && !event.ctrlKey) {
          requestAnimationFrame(() => {
            mod_key_held = false;
          });
          return false;
        }
        return false;
      },
      focus(event: any, view: any) {
        requestAnimationFrame(() => {
          is_focused = true;
        });
        return false;
      },
      blur(event: any, view: any) {
        requestAnimationFrame(() => {
          is_focused = false;
        });
        return false;
      },
      contextmenu(event: any, view: any) {
        // Check if we're on a class name before preventing default
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos !== null) {
          const doc = view.state.doc.toString();
          const word_info = get_word_at_pos(doc, pos);
          if (word_info && is_in_class_attr(doc, pos)) {
            event.preventDefault();
            show_class_tooltip(event, view);
            return true;
          }
        }
        return false;
      },
      click(event: any, view: any) {
        hide_tooltip();
        return false;
      },
    });

    async function format_code(
      code: string,
      position: number,
    ): Promise<{ formatted: string; cursorOffset: number } | undefined> {
      try {
        const result = await prettierModule.default.formatWithCursor(code, {
          parser: "svelte",
          bracketSameLine: true,
          useTabs: true,
          cursorOffset: position,
          plugins: [
            prettierSvelteModule,
            prettierPostcssModule,
            prettierBabelModule,
            prettierEstreeModule,
          ],
        });
        return result;
      } catch (e) {
        console.warn(e);
        return undefined;
      }
    }

    const initialState = EditorState.create({
      doc: value,
      extensions: [
        indentUnit.of("\t"),
        EditorState.tabSize.of(2),
        fallbackIndent,
        language_compartment.of(languageExtension),
        emmet_compartment.of(emmetExtensions),
        theme_compartment.of(themedEditor),
        view.keymap.of([
          ...commands.standardKeymap,
          commands.indentWithTab,
          {
            key: "Escape",
            run: () => {
              editorView.contentDOM.blur();
              return true;
            },
          },
          {
            key: "mod-s",
            run: () => {
              dispatch("save");
              return true;
            },
          },
          {
            key: "mod-Enter",
            run: () => {
              const view = editorView;
              if (!view) return false;
              const value = view.state.doc.toString();
              const position = view.state.selection.main.head as number;
              format_code(value, position).then((res) => {
                if (!res || !view) return;
                const { formatted, cursorOffset } = res;
                view.dispatch({
                  changes: [
                    {
                      from: 0,
                      to: view.state.doc.length,
                      insert: formatted,
                    },
                  ],
                  selection: {
                    anchor: cursorOffset,
                  },
                });
              });
              return true;
            },
          },
          // Tab switching shortcuts
          {
            key: "mod-1",
            run: () => {
              window.dispatchEvent(
                new KeyboardEvent("keydown", {
                  key: "1",
                  metaKey: true,
                  ctrlKey: true,
                  bubbles: true,
                }),
              );
              return true;
            },
          },
          {
            key: "mod-2",
            run: () => {
              window.dispatchEvent(
                new KeyboardEvent("keydown", {
                  key: "2",
                  metaKey: true,
                  ctrlKey: true,
                  bubbles: true,
                }),
              );
              return true;
            },
          },
          {
            key: "mod-3",
            run: () => {
              window.dispatchEvent(
                new KeyboardEvent("keydown", {
                  key: "3",
                  metaKey: true,
                  ctrlKey: true,
                  bubbles: true,
                }),
              );
              return true;
            },
          },
          {
            key: "mod-4",
            run: () => {
              window.dispatchEvent(
                new KeyboardEvent("keydown", {
                  key: "4",
                  metaKey: true,
                  ctrlKey: true,
                  bubbles: true,
                }),
              );
              return true;
            },
          },
          {
            key: "mod-5",
            run: () => {
              window.dispatchEvent(
                new KeyboardEvent("keydown", {
                  key: "5",
                  metaKey: true,
                  ctrlKey: true,
                  bubbles: true,
                }),
              );
              return true;
            },
          },
          {
            key: "mod-6",
            run: () => {
              window.dispatchEvent(
                new KeyboardEvent("keydown", {
                  key: "6",
                  metaKey: true,
                  ctrlKey: true,
                  bubbles: true,
                }),
              );
              return true;
            },
          },
          {
            key: "mod-7",
            run: () => {
              window.dispatchEvent(
                new KeyboardEvent("keydown", {
                  key: "7",
                  metaKey: true,
                  ctrlKey: true,
                  bubbles: true,
                }),
              );
              return true;
            },
          },
        ]),
        detectModKey,
        EditorView.updateListener.of((update: any) => {
          if (update.docChanged) {
            const newValue = update.state.doc.toString();
            // Track that this value came from the editor itself
            last_synced_value = newValue;
            debounced_onChange(newValue);
          }
        }),
        codemirror.basicSetup,
        EditorView.theme({
          "&": {
            height: "100%",
            // Use 16px on mobile to prevent iOS auto-zoom on focus
            fontSize: is_mobile ? "16px" : "14px",
          },
          ".cm-scroller": {
            overflow: "auto",
            fontFamily:
              'JetBrains Mono, Monaco, Menlo, "Ubuntu Mono", Consolas, source-code-pro, monospace',
          },
          // Prevent iOS zoom on input focus
          ".cm-content": {
            caretColor: "auto",
          },
        }),
        // Disable editable on mobile initially to prevent auto-focus
        ...(is_mobile && disable_mobile_focus
          ? [EditorView.editable.of(true)]
          : []),
      ],
    });

    editorView = new EditorView({
      state: initialState,
      parent: editorElement,
    });

    // On mobile, blur the editor immediately after creation to prevent auto-focus
    if (is_mobile && disable_mobile_focus) {
      requestAnimationFrame(() => {
        editorView?.contentDOM?.blur();
      });
    }

    // Mark editor as ready to trigger value sync
    editor_ready = true;

    // Restore scroll position and folds from cache
    if (cache_key && wrapperElement) {
      const cached = scroll_cache.get(cache_key);
      if (cached !== undefined) {
        requestAnimationFrame(() => {
          wrapperElement.scrollTop = cached;
        });
      }
      wrapperElement.addEventListener("scroll", capture_scroll);

      // Restore folds
      requestAnimationFrame(() => {
        restore_folds(foldEffect);
      });
    }
  });

  onDestroy(() => {
    debounced_onChange.cancel();
    if (cache_key && wrapperElement) {
      wrapperElement.removeEventListener("scroll", capture_scroll);
    }
    if (editorView && cache_key) {
      // Capture folds before destroying
      capture_folds(foldedRanges);
    }
    if (editorView) {
      editorView.destroy();
    }
  });

  // Track when editor is ready
  let editor_ready = $state(false);
  // Track the last value we synced to the editor to avoid loops
  let last_synced_value = $state("");

  // Sync value when editor becomes ready or value changes externally
  watch(
    () => [editor_ready, value] as const,
    ([ready, newValue]) => {
      if (ready && editorView) {
        const editorContent = editorView.state.doc.toString();
        // Only update if value changed externally (not from editor itself)
        if (newValue !== editorContent && newValue !== last_synced_value) {
          console.log(
            "[CodeMirror] Syncing external value change, length:",
            newValue.length,
          );
          last_synced_value = newValue;
          editorView.dispatch({
            changes: {
              from: 0,
              to: editorView.state.doc.length,
              insert: newValue,
            },
          });
        }
      }
    },
  );

  // React to language changes
  watch(
    () => language,
    () => {
      if (editorView && language_compartment && extensionsModule) {
        const newLangExtension = extensionsModule.getLanguage(language);
        const newEmmetExtensions =
          extensionsModule.getEmmetExtensions(language);

        editorView.dispatch({
          effects: [
            language_compartment.reconfigure(newLangExtension),
            emmet_compartment.reconfigure(newEmmetExtensions),
          ],
        });
      }
    },
  );

  // React to theme changes
  watch(
    () => $current_builder_theme,
    () => {
      (async () => {
        const themeModule = await import("./CodeMirror/theme");
        const themedEditor = themeModule.create_themed_editor();

        // Update main editor
        if (editorView && theme_compartment) {
          editorView.dispatch({
            effects: theme_compartment.reconfigure(themedEditor),
          });
        }

        // Update tooltip editor if open
        if (tooltip_editor_view && tooltip_theme_compartment) {
          tooltip_editor_view.dispatch({
            effects: tooltip_theme_compartment.reconfigure(themedEditor),
          });
        }
      })();
    },
  );
</script>

<div class="codemirror-container" bind:this={containerElement}>
  <div class="editor-wrapper" bind:this={wrapperElement}>
    <div bind:this={editorElement}></div>
    {#if mod_key_held && is_focused}
      <div class="format-hint">
        <span>&#8984;</span>
        <span>↵</span>
        <span>Format</span>
      </div>
    {/if}
    {#if tooltip_visible}
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
      <div
        class="class-tooltip"
        style="left: {tooltip_x}px; top: {tooltip_y}px;"
        in:fade={{ duration: 100 }}
        onclick={(e) => e.stopPropagation()}
      >
        <div class="tooltip-header">
          <span class="tooltip-title">Edit Styles</span>
          <button class="tooltip-btn cancel" onclick={hide_tooltip}>×</button>
        </div>
        {#if tooltip_editable}
          <div
            class="tooltip-editor-container"
            bind:this={tooltip_editor_element}
          ></div>
        {:else}
          <div class="tooltip-empty">No styles found for .{tooltip_class}</div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .codemirror-container {
    width: 100%;
    height: 100%;
    overflow-y: scroll;
    overscroll-behavior-x: contain;
    font-family: "JetBrains Mono", "Fira Code", monospace !important;
    /* Prevent double-tap zoom on mobile */
    touch-action: manipulation;
  }

  /* Prevent iOS zoom on input focus by ensuring minimum font size */
  @media (max-width: 768px) {
    .codemirror-container :global(.cm-content) {
      font-size: 16px !important;
    }
  }

  .editor-wrapper {
    position: relative;
    height: 100%;
    overflow: auto;
  }

  .format-hint {
    position: absolute;
    top: 1rem;
    right: 3.5rem;
    background: var(--builder-bg-secondary);
    border: 1px solid var(--builder-border);
    padding: 0.5rem 0.75rem;
    border-radius: 4px;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.75rem;
    color: var(--builder-text-secondary);
    pointer-events: none;
    z-index: 10;
  }

  :global(.cm-editor) {
    height: 100%;
  }

  .class-tooltip {
    position: absolute;
    background: var(--builder-bg-primary);
    border: 1px solid var(--builder-border);
    border-radius: 6px;
    padding: 0;
    z-index: 100;
    min-width: 300px;
    max-width: 450px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }

  .tooltip-header {
    background: var(--builder-bg-secondary);
    padding: 0.375rem 0.75rem;
    border-bottom: 1px solid var(--builder-border);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .tooltip-title {
    font-size: 0.7rem;
    font-weight: 500;
    color: var(--builder-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .tooltip-btn {
    padding: 0.125rem 0.375rem;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    background: transparent;
    color: var(--builder-text-secondary);
    font-size: 1rem;
    line-height: 1;
  }

  .tooltip-btn:hover {
    color: var(--builder-text-primary);
  }

  .tooltip-editor-container {
    max-height: 250px;
    overflow: auto;
  }

  .tooltip-editor-container :global(.cm-editor) {
    height: 100%;
    background: var(--builder-bg-primary);
  }

  .tooltip-editor-container :global(.cm-focused) {
    outline: none;
  }

  .tooltip-empty {
    padding: 1rem;
    color: var(--builder-text-secondary);
    font-size: 0.75rem;
    text-align: center;
  }
</style>
