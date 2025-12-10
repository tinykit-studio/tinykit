/**
 * Custom Fields Type Definitions
 *
 * Defines the interface for pluggable custom field components
 * used in the Config tab and accessible by app code.
 */

export type SymbolType = 'field' | 'element' | 'plugin';

export interface CustomFieldManifest {
  // Identity
  id: string;
  name: string;
  type: SymbolType;
  version: string;
  author?: string;
  description: string;
  component: string;
  icon?: string;

  // Data schema - defines the structure of stored values
  schema: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
    [key: string]: any;
  };

  // Component props - configurable options for the field
  props?: Record<string, {
    type: string;
    default?: any;
    enum?: any[];
    description?: string;
  }>;

  // Dependencies
  dependencies?: {
    npm?: string[];
    external?: string[]; // CDN URLs for CSS/JS
  };

  // Capabilities
  capabilities?: {
    external_data?: boolean;    // Fetches from APIs
    file_upload?: boolean;       // Handles file uploads
    requires_env?: string[];     // Required env variables
    server_logic?: boolean;      // Has backend component
  };

  // Marketplace metadata
  marketplace?: {
    category: string;
    tags: string[];
    price: 'free' | 'paid';
    license?: string;
  };
}

export interface SymbolRegistryEntry {
  id: string;
  name: string;
  type: SymbolType;
  path: string;          // Relative to workspace/components
  component: string;     // Component filename
  manifest: CustomFieldManifest;
}

export interface SymbolsRegistry {
  version: string;
  updated: string;       // ISO timestamp
  symbols: {
    fields: SymbolRegistryEntry[];
    elements: SymbolRegistryEntry[];
    plugins: SymbolRegistryEntry[];
  };
}

export interface CustomFieldInstance {
  type: 'custom';
  customType: string;    // Reference to symbol ID
  value: any;            // Actual data (conforms to manifest.schema)
  config?: Record<string, any>; // Component configuration (manifest.props)
}

// Standard field instance (existing)
export interface StandardFieldInstance {
  type: 'text' | 'textarea' | 'number' | 'boolean' | 'json';
  value: any;
}

// Union type for all field instances
export type FieldInstance = StandardFieldInstance | CustomFieldInstance;

// Config structure with support for custom fields
export type DataConfig = Record<string, FieldInstance>;

// Component interface - what custom field components must implement
export interface CustomFieldComponentProps {
  // Standard props provided by the system
  value: any;
  disabled?: boolean;
  config?: Record<string, any>;

  // Event handlers
  onChange?: (value: any) => void;

  // Additional custom props defined in manifest.props
  [key: string]: any;
}

// AI Tool parameter types
export interface CreateCustomFieldParams {
  id: string;
  name: string;
  description: string;
  componentCode: string;
  manifest: Partial<CustomFieldManifest>;
}

export interface UseCustomFieldParams {
  fieldName: string;
  customType: string;
  defaultValue?: any;
  config?: Record<string, any>;
}
