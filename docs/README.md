# Documentation

This folder contains architecture decisions, design documents, and guides for tinykit development.

## Structure

```
/docs/
├── README.md                           # This file
└── architecture/                       # Architecture & design decisions
    └── modular-components.md          # Modular component system (future)
```

## Architecture Documents

### [Modular Components](./architecture/modular-components.md)
Future-facing design for component marketplace, visual builder, and plugin system.
- **Status:** Planning only
- **Priority:** Low (conventions now, implementation later)
- **Goal:** Enable non-developers to compose UIs and share components

## Document Types

### Architecture Decision Records (ADRs)
Located in `/docs/architecture/`. Documents that capture important architectural decisions.

**Format:**
- What problem are we solving?
- What options did we consider?
- What did we choose and why?
- What are the tradeoffs?

### Guides (Future)
User-facing guides for building with tinykit.

### API Documentation (Future)
Generated API docs for developers.

## Contributing Docs

When adding architecture documents:
1. Use clear, concise language
2. Include code examples
3. Document tradeoffs and alternatives
4. Add status tags (Planning, In Progress, Implemented, Deprecated)
5. Keep examples up-to-date with codebase

## Related Root Documents

- [README.md](../README.md) - Project overview and quick start
- [ROADMAP.md](../ROADMAP.md) - Feature roadmap
- [SPEC.md](../SPEC.md) - Technical specifications
