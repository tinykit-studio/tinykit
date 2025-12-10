/**
 * Symbols Registry Manager
 *
 * Manages the registry of custom fields, elements, and plugins.
 * Scans workspace/components/ and maintains .symbols-registry.json
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import type {
  SymbolsRegistry,
  SymbolRegistryEntry,
  CustomFieldManifest,
  SymbolType
} from './types/custom-fields';

const WORKSPACE_DIR = join(process.cwd(), 'workspace');
const COMPONENTS_DIR = join(WORKSPACE_DIR, 'components');
const REGISTRY_FILE = join(WORKSPACE_DIR, '.symbols-registry.json');

/**
 * Initialize empty registry
 */
function createEmptyRegistry(): SymbolsRegistry {
  return {
    version: '1.0',
    updated: new Date().toISOString(),
    symbols: {
      fields: [],
      elements: [],
      plugins: []
    }
  };
}

/**
 * Load symbols registry from disk
 */
export function loadRegistry(): SymbolsRegistry {
  try {
    if (!existsSync(REGISTRY_FILE)) {
      const registry = createEmptyRegistry();
      saveRegistry(registry);
      return registry;
    }

    const content = readFileSync(REGISTRY_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Failed to load symbols registry:', error);
    return createEmptyRegistry();
  }
}

/**
 * Save symbols registry to disk
 */
export function saveRegistry(registry: SymbolsRegistry): void {
  try {
    registry.updated = new Date().toISOString();
    writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to save symbols registry:', error);
    throw error;
  }
}

/**
 * Scan a component directory for manifest.json
 */
function scanComponentDir(
  symbolType: SymbolType,
  componentPath: string,
  componentName: string
): SymbolRegistryEntry | null {
  const manifestPath = join(componentPath, 'manifest.json');

  if (!existsSync(manifestPath)) {
    return null;
  }

  try {
    const manifestContent = readFileSync(manifestPath, 'utf-8');
    const manifest: CustomFieldManifest = JSON.parse(manifestContent);

    // Validate manifest has required fields
    if (!manifest.id || !manifest.name || !manifest.component) {
      console.warn(`Invalid manifest in ${componentPath}`);
      return null;
    }

    // Verify component file exists
    const componentFile = join(componentPath, manifest.component);
    if (!existsSync(componentFile)) {
      console.warn(`Component file not found: ${componentFile}`);
      return null;
    }

    return {
      id: manifest.id,
      name: manifest.name,
      type: symbolType,
      path: join('components', symbolType + 's', componentName),
      component: manifest.component,
      manifest
    };
  } catch (error) {
    console.error(`Failed to parse manifest in ${componentPath}:`, error);
    return null;
  }
}

/**
 * Scan workspace/components directory for all symbols
 */
export function scanComponents(): SymbolsRegistry {
  const registry = createEmptyRegistry();

  const symbolTypes: SymbolType[] = ['field', 'element', 'plugin'];

  for (const symbolType of symbolTypes) {
    const typeDir = join(COMPONENTS_DIR, symbolType + 's');

    if (!existsSync(typeDir)) {
      continue;
    }

    const entries = readdirSync(typeDir);

    for (const entry of entries) {
      const componentPath = join(typeDir, entry);

      // Only process directories
      if (!statSync(componentPath).isDirectory()) {
        continue;
      }

      const registryEntry = scanComponentDir(symbolType, componentPath, entry);

      if (registryEntry) {
        registry.symbols[symbolType + 's' as keyof typeof registry.symbols].push(registryEntry);
      }
    }
  }

  return registry;
}

/**
 * Refresh the registry by scanning components directory
 */
export function refreshRegistry(): SymbolsRegistry {
  const registry = scanComponents();
  saveRegistry(registry);
  return registry;
}

/**
 * Get a specific symbol by ID
 */
export function getSymbol(id: string): SymbolRegistryEntry | null {
  const registry = loadRegistry();

  for (const symbolList of Object.values(registry.symbols)) {
    const found = symbolList.find(s => s.id === id);
    if (found) return found;
  }

  return null;
}

/**
 * Get all symbols of a specific type
 */
export function getSymbolsByType(type: SymbolType): SymbolRegistryEntry[] {
  const registry = loadRegistry();
  return registry.symbols[type + 's' as keyof typeof registry.symbols] || [];
}

/**
 * Add a symbol to the registry
 */
export function addSymbol(entry: SymbolRegistryEntry): void {
  const registry = loadRegistry();
  const symbolList = registry.symbols[entry.type + 's' as keyof typeof registry.symbols];

  // Remove existing entry with same ID if present
  const existingIndex = symbolList.findIndex(s => s.id === entry.id);
  if (existingIndex >= 0) {
    symbolList.splice(existingIndex, 1);
  }

  symbolList.push(entry);
  saveRegistry(registry);
}

/**
 * Remove a symbol from the registry
 */
export function removeSymbol(id: string): boolean {
  const registry = loadRegistry();
  let removed = false;

  for (const key of Object.keys(registry.symbols)) {
    const symbolList = registry.symbols[key as keyof typeof registry.symbols];
    const index = symbolList.findIndex(s => s.id === id);

    if (index >= 0) {
      symbolList.splice(index, 1);
      removed = true;
      break;
    }
  }

  if (removed) {
    saveRegistry(registry);
  }

  return removed;
}

/**
 * Get all custom fields (convenience method)
 */
export function getCustomFields(): SymbolRegistryEntry[] {
  return getSymbolsByType('field');
}
